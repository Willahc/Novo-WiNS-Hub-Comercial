// crm.mjs — APIs e controle do Mini-CRM + Start/Stop do worker-disparo
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadStatus, saveStatus, normalizePhone, getConversation, qualificarLead, callClaude, DAILY_LOG_PATH,
  logActivity, readActivity, getEvolutionState, getAnthropicUsage,
} from "./lib.mjs";
import { slugify, detectNiche } from "../entrega/previas/templates.mjs";
import { auditSite, runLighthouse } from "../prospeccao/site-audit.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECCAO_DIR = resolve(__dirname, "..", "prospeccao");
const WEBDATA_DIR = resolve(__dirname, "..", "..", "webdata");
const CRM_HTML_PATH = resolve(__dirname, "crm.html");

const workerState = {
  proc: null,
  running: false,
  startedAt: null,
  lastExitCode: null,
  logs: [],
};

function pushLog(line) {
  const stamp = new Date().toLocaleTimeString("pt-BR", { timeZone: process.env.TZ || "America/Sao_Paulo" });
  for (const l of String(line).split(/\r?\n/)) {
    if (!l.trim()) continue;
    workerState.logs.push(`[${stamp}] ${l}`);
    if (workerState.logs.length > 200) workerState.logs.shift();
  }
  logActivity("CRM", line);
}

let evoCache = { state: "unknown", at: 0 };
async function getCachedEvoState() {
  if (Date.now() - evoCache.at > 15000) {
    evoCache = { state: await getEvolutionState(), at: Date.now() };
  }
  return evoCache.state;
}

function checkAuth(req, res) {
  const pass = process.env.CRM_PASS || "";
  if (!pass) return true;
  const user = process.env.CRM_USER || "wins";
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Basic ")) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="WiNS Hub CRM"' });
    res.end("Autenticacao necessaria");
    return false;
  }
  const decoded = Buffer.from(hdr.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const u = idx >= 0 ? decoded.slice(0, idx) : "";
  const p = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (u !== user || p !== pass) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="WiNS Hub CRM"' });
    res.end("Credenciais invalidas");
    return false;
  }
  return true;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function getDailyStats() {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const max = parseInt(process.env.MAX_DISPAROS_DIA || "18", 10);
  if (!existsSync(DAILY_LOG_PATH)) return { data: hoje, count: 0, max };
  try {
    const d = JSON.parse(readFileSync(DAILY_LOG_PATH, "utf8"));
    return d.data === hoje ? { data: hoje, count: d.count || 0, max } : { data: hoje, count: 0, max };
  } catch {
    return { data: hoje, count: 0, max };
  }
}

let archiveCache = { key: "", data: null };
function parseSimpleCsv(text) {
  const firstLine = (text.split(/\r?\n/)[0] || "");
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadArchiveRows() {
  if (!existsSync(WEBDATA_DIR)) return { files: [], rows: [] };
  const csvFiles = readdirSync(WEBDATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv") && !f.startsWith("wins-hub-"))
    .sort();
  const cacheKey = csvFiles.join("|");
  if (archiveCache.key === cacheKey && archiveCache.data) return archiveCache.data;

  const files = [];
  const rows = [];
  for (const fname of csvFiles) {
    try {
      const txt = readFileSync(resolve(WEBDATA_DIR, fname), "utf8").replace(/^\uFEFF/, "");
      const parsed = parseSimpleCsv(txt);
      if (parsed.length < 2) continue;
      const hdr = parsed[0].map((h) => h.trim().toLowerCase());
      const col = (name) => hdr.indexOf(name);
      const iTitle = col("title"), iCat = col("category"), iAddr = col("address"),
        iWeb = col("website"), iPhone = col("phone"), iRev = col("review_count"),
        iRat = col("review_rating"), iLink = col("link"), iEmails = col("emails"),
        iCompAddr = col("complete_address");
      if (iTitle === -1) continue;

      const fileRows = [];
      const catCounts = {};
      for (let r = 1; r < parsed.length; r++) {
        const line = parsed[r];
        const title = (line[iTitle] || "").trim();
        if (!title) continue;
        const cat = iCat !== -1 ? (line[iCat] || "").trim() : "";
        if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
        let city = "";
        if (iCompAddr !== -1 && line[iCompAddr]) {
          try {
            const ca = JSON.parse(line[iCompAddr]);
            city = ca.city || ca.borough || "";
          } catch {}
        }
        if (!city && iAddr !== -1 && line[iAddr]) {
          const parts = line[iAddr].split(",");
          city = (parts[parts.length - 2] || "").replace(/\s*-\s*[A-Z]{2}.*$/, "").trim();
        }
        fileRows.push({
          title,
          category: cat,
          city,
          phone: iPhone !== -1 ? (line[iPhone] || "").trim() : "",
          website: iWeb !== -1 ? (line[iWeb] || "").trim() : "",
          emails: iEmails !== -1 ? (line[iEmails] || "").trim() : "",
          rating: iRat !== -1 ? (parseFloat(line[iRat]) || 0) : 0,
          reviews: iRev !== -1 ? (parseInt(line[iRev], 10) || 0) : 0,
          link: iLink !== -1 ? (line[iLink] || "").trim() : "",
          jobId: "arch:" + fname,
        });
      }
      const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Arquivo";
      const label = `Histórico: ${topCat} (${fileRows.length})`;
      for (const item of fileRows) {
        item.source = label;
        rows.push(item);
      }
      files.push({ id: "arch:" + fname, name: label, count: fileRows.length });
    } catch {}
  }
  archiveCache = { key: cacheKey, data: { files, rows } };
  return archiveCache.data;
}

export async function handleCrmRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (!path.startsWith("/crm") && !path.startsWith("/api/crm")) return false;
  if (!checkAuth(req, res)) return true;

  if (req.method === "GET" && (path === "/crm" || path === "/crm/")) {
    const html = readFileSync(CRM_HTML_PATH, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }

  if (req.method === "GET" && path === "/api/crm/overview") {
    const db = loadStatus();
    const rawLeads = Object.entries(db.leads || {});
    const counts = {
      total: rawLeads.length,
      na_fila: 0,
      enviado: 0,
      visualizado: 0,
      respondeu: 0,
      proposto: 0,
      fechado: 0,
      descartado: 0,
    };
    const byNiche = {};
    const previewBase = (process.env.PREVIEW_BASE_URL || "/previa").replace(/\/$/, "");

    const leads = rawLeads.map(([key, l]) => {
      const st = l.state || "na_fila";
      if (st in counts) counts[st]++;
      const nicho = l.nicho || "Outro";
      if (!byNiche[nicho]) {
        byNiche[nicho] = { nicho, total: 0, na_fila: 0, enviados: 0, respostas: 0, fechados: 0 };
      }
      byNiche[nicho].total++;
      if (st === "na_fila") byNiche[nicho].na_fila++;
      if (["enviado", "visualizado", "respondeu", "proposto", "fechado"].includes(st)) byNiche[nicho].enviados++;
      if (["respondeu", "proposto", "fechado"].includes(st)) byNiche[nicho].respostas++;
      if (st === "fechado") byNiche[nicho].fechados++;

      const normPhone = normalizePhone(l.telefone);
      const msgs = normPhone ? getConversation(normPhone) : [];
      const slug = `${l.id}-${slugify(l.nome)}`;
      const igMatch = String(l.instagramUrl || l.site || "").match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
      const igHandle = l.instagram || (igMatch && !/^(p|reel|reels|stories|explore|accounts|tv)$/i.test(igMatch[1]) ? `@${igMatch[1]}` : "");
      const igUrl = l.instagramUrl || (igHandle ? `https://www.instagram.com/${igHandle.replace(/^@/, "")}/` : "");

      return {
        key,
        id: l.id,
        nome: l.nome,
        nicho,
        nichoGrupo: detectNiche(nicho),
        cidade: l.cidade,
        telefone: normPhone,
        instagram: igHandle,
        instagramUrl: igUrl,
        state: st,
        score: l.score || 0,
        avaliacoes: l.avaliacoes || 0,
        temSite: !!l.temSite,
        site: l.site || "",
        siteAudit: l.siteAudit || null,
        emitido: l.emitido || "",
        handoff: !!l.handoff,
        msgCount: msgs.length,
        lastMsgAt: msgs.length ? msgs[msgs.length - 1].at : null,
        previewUrl: `${previewBase}/${slug}`,
      };
    });

    leads.sort((a, b) => {
      const ta = a.lastMsgAt ? Date.parse(a.lastMsgAt) : 0;
      const tb = b.lastMsgAt ? Date.parse(b.lastMsgAt) : 0;
      if (tb !== ta) return tb - ta;
      if ((b.id || 0) !== (a.id || 0)) return (b.id || 0) - (a.id || 0);
      return (b.score || 0) - (a.score || 0);
    });

    const persistentLogs = readActivity(80);
    const mergedLogs = persistentLogs.length ? persistentLogs : workerState.logs;
    const auditedCount = rawLeads.filter(([, l]) => !!l.siteAudit).length;
    const evoState = await getCachedEvoState();

    sendJson(res, 200, {
      counts,
      daily: getDailyStats(),
      byNiche: Object.values(byNiche).sort((a, b) => b.total - a.total),
      agents: {
        evolution: evoState,
        webhook: "online",
        workerRunning: workerState.running,
        auditedCount,
        anthropic: getAnthropicUsage(),
      },
      worker: {
        running: workerState.running,
        startedAt: workerState.startedAt,
        lastExitCode: workerState.lastExitCode,
        logs: mergedLogs,
      },
      leads,
    });
    return true;
  }

  if (req.method === "GET" && path === "/api/crm/conversation") {
    const phone = url.searchParams.get("phone") || "";
    const msgs = phone ? getConversation(phone) : [];
    sendJson(res, 200, { phone: normalizePhone(phone), messages: msgs });
    return true;
  }

  if (req.method === "GET" && path === "/api/crm/dashboard-archive") {
    sendJson(res, 200, { ok: true, ...loadArchiveRows() });
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/lead/status") {
    try {
      const body = await readJsonBody(req);
      const db = loadStatus();
      if (!body.key || !db.leads?.[body.key]) {
        sendJson(res, 404, { error: "Lead não encontrado" });
        return true;
      }
      db.leads[body.key].state = body.state;
      if (body.state === "na_fila") db.leads[body.key].handoff = false;
      saveStatus(db);
      pushLog(`[CRM] Status de "${db.leads[body.key].nome}" alterado para ${body.state}`);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/start") {
    if (workerState.running) {
      sendJson(res, 409, { error: "Agente de disparo já está rodando." });
      return true;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const args = [resolve(__dirname, "worker-disparo.mjs")];
    if (body.forceHorario !== false) args.push("--force-horario");
    if (body.dryRun) args.push("--dry-run");
    const keys = Array.isArray(body.keys) ? body.keys.filter(Boolean) : [];
    if (keys.length) args.push(`--keys=${keys.join(",")}`);

    workerState.logs = [];
    workerState.running = true;
    workerState.startedAt = new Date().toISOString();
    workerState.lastExitCode = null;
    pushLog(`▶ Iniciando disparo (${body.dryRun ? "SIMULAÇÃO" : "REAL"}${keys.length ? ` · ${keys.length} selecionado(s)` : ""})...`);

    const child = spawn(process.execPath, args, { cwd: __dirname, env: process.env });
    workerState.proc = child;
    child.stdout.on("data", (d) => pushLog(d.toString("utf8")));
    child.stderr.on("data", (d) => pushLog(`ERR: ${d.toString("utf8")}`));
    child.on("close", (code) => {
      workerState.running = false;
      workerState.proc = null;
      workerState.lastExitCode = code;
      pushLog(`⏹ Disparo finalizado (código ${code}).`);
    });

    sendJson(res, 200, { ok: true, running: true });
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/stop") {
    if (!workerState.running || !workerState.proc) {
      sendJson(res, 200, { ok: true, running: false });
      return true;
    }
    workerState.proc.kill("SIGTERM");
    pushLog("⏹ Solicitação de parada enviada ao agente...");
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/import-csv") {
    try {
      const body = await readJsonBody(req);
      const limit = Math.min(100, Math.max(5, Number(body.limit) || 25));
      mkdirSync(WEBDATA_DIR, { recursive: true });
      let targetCsv = null;
      if (body.csvContent && body.filename) {
        const safeName = String(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        const dest = resolve(WEBDATA_DIR, safeName.endsWith(".csv") ? safeName : `${safeName}.csv`);
        writeFileSync(dest, body.csvContent, "utf8");
        targetCsv = dest;
        pushLog(`📥 CSV salvo em webdata/${safeName}`);
      }
      const leadsOut = resolve(PROSPECCAO_DIR, "leads.json");
      const convArgs = [resolve(PROSPECCAO_DIR, "converter-leads.mjs")];
      if (targetCsv) convArgs.push(targetCsv);
      convArgs.push("-o", leadsOut);
      const conv = await execFileAsync(process.execPath, convArgs, { cwd: PROSPECCAO_DIR });
      pushLog(conv.stdout);
      const fila = await execFileAsync(process.execPath, [resolve(PROSPECCAO_DIR, "gerar-fila.mjs"), leadsOut, "--limit", String(limit), "--canal", "whatsapp", "--relaxed"], { cwd: PROSPECCAO_DIR });
      pushLog(fila.stdout);
      sendJson(res, 200, { ok: true, output: `${conv.stdout}\n${fila.stdout}` });
    } catch (e) {
      pushLog(`❌ Erro ao importar CSV: ${e.message}`);
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/audit") {
    try {
      const body = await readJsonBody(req);
      const db = loadStatus();
      const applyAudit = async (k, lead) => {
        const resAudit = await auditSite(lead.site, lead.nome);
        lead.siteAudit = resAudit;
        if (!lead.instagram && resAudit.instagram) {
          lead.instagram = resAudit.instagram;
          lead.instagramUrl = resAudit.instagramUrl;
        }
        return resAudit;
      };
      if (body.key) {
        const lead = db.leads?.[body.key];
        if (!lead) { sendJson(res, 404, { error: "Lead não encontrado" }); return true; }
        if (!lead.site) { sendJson(res, 400, { error: "Lead não possui site cadastrado" }); return true; }
        const audit = await applyAudit(body.key, lead);
        saveStatus(db);
        pushLog(`[Audit] ${lead.nome}: ${audit.score}/100 (Seg ${audit.securityScore} · Qual ${audit.qualityScore})`);
        sendJson(res, 200, { ok: true, audit });
        return true;
      }
      const targets = Object.entries(db.leads || {})
        .filter(([, l]) => l.temSite && l.site && !/instagram\.com|facebook\.com/i.test(l.site) && !l.siteAudit)
        .slice(0, 15);
      for (let i = 0; i < targets.length; i += 5) {
        await Promise.all(targets.slice(i, i + 5).map(([k, l]) => applyAudit(k, l)));
      }
      saveStatus(db);
      pushLog(`[Audit] ${targets.length} sites auditados em lote.`);
      sendJson(res, 200, { ok: true, auditedCount: targets.length });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/lighthouse") {
    try {
      const body = await readJsonBody(req);
      const db = loadStatus();
      const lead = db.leads?.[body.key];
      if (!lead) { sendJson(res, 404, { error: "Lead não encontrado" }); return true; }
      if (!lead.site) { sendJson(res, 400, { error: "Lead não possui site cadastrado" }); return true; }
      const lighthouse = await runLighthouse(lead.site, lead.nome);
      lead.lighthouse = lighthouse;
      saveStatus(db);
      pushLog(`[Lighthouse] ${lead.nome}: Perf ${lighthouse.perf ?? "-"} · SEO ${lighthouse.seo ?? "-"}`);
      sendJson(res, 200, { ok: true, lighthouse });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/proposta") {
    try {
      const body = await readJsonBody(req);
      const db = loadStatus();
      let targetKey = body.key && db.leads[body.key] ? body.key : null;
      if (!targetKey && body.phone) {
        const want = normalizePhone(body.phone);
        targetKey = Object.keys(db.leads).find((k) => normalizePhone(db.leads[k]?.telefone || "") === want) || null;
      }
      if (!targetKey) {
        sendJson(res, 404, { error: "Lead não encontrado" });
        return true;
      }

      const lead = db.leads[targetKey];
      const qual = qualificarLead(lead);
      const conv = getConversation(lead.telefone || "");
      const historico = conv.slice(-6).map((m) => `${m.role === "assistant" ? "SDR" : "Lead"}: ${m.content}`).join("\n");

      const system =
        "Você é o Closer Sênior da WiNS Hub Comercial. Gere uma proposta comercial enxuta e persuasiva em português (pronta para copiar e enviar no WhatsApp ou apresentar em call de 10 min).\n" +
        "Estrutura obrigatória:\n" +
        "1) Diagnóstico rápido (usando os dados reais do lead)\n" +
        "2) Pacote recomendado (Site Profissional / Google & Meta Ads / Vídeos Curtos com IA / Central de WhatsApp Multi-Atendente + Agendamento / Máquina de Prospecção + CRM Autônomo com IA para B2B) com entregáveis claros\n" +
        "3) Estimativa realista de retorno (custo por lead e meta de agendamentos pro nicho)\n" +
        "4) Ancoragem de investimento (Setup + Mensalidade ou pacote de entrada)\n" +
        "5) 3 respostas curtas para quebrar objeções comuns (\"tá caro\", \"vou pensar\", \"já tenho quem faça\").";

      const userPrompt =
        `Dados do Lead:\n${qual.fatos.join("\n")}\nSinal comercial: ${qual.sinal}\nOferta principal: ${qual.oferta}\n` +
        (historico ? `\nÚltimas mensagens da conversa:\n${historico}` : "");

      let texto = "";
      try {
        texto = await callClaude({
          system,
          messages: [{ role: "user", content: userPrompt }],
          maxTokens: 900,
        });
      } catch {
        texto =
          `*Proposta Comercial — ${lead.nome}*\n\n` +
          `*1. Diagnóstico:* ${qual.sinal}\n` +
          `*2. Pacote Recomendado (${qual.oferta}):*\n` +
          `- Estrutura digital focada em conversão no WhatsApp\n` +
          `- Campanhas locais no Google/Meta Ads segmentadas para ${lead.cidade || "sua região"}\n` +
          `- Vídeos curtos com IA para anúncios e redes sociais\n\n` +
          `*3. Ancoragem:* Setup inicial + gestão mensal com acompanhamento semanal de leads.\n` +
          `*4. Próximo passo:* Call rápida de 10 minutos para ajustar metas e publicar.`;
      }

      db.leads[targetKey].proposta = {
        oferta: qual.oferta,
        texto,
        geradaEm: new Date().toISOString(),
      };
      saveStatus(db);
      sendJson(res, 200, { ok: true, oferta: qual.oferta, proposta: texto });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  sendJson(res, 404, { error: "Rota CRM não encontrada" });
  return true;
}

