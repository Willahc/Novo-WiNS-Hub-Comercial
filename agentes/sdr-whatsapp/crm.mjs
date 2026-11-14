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
import { verifySmtp, sendMail, sendLeadEmail, runDueEmailCadence } from "./email.mjs";

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
    let dbDirty = false;
    const rawLeads = Object.entries(db.leads || {});
    const counts = {
      total: 0,
      mapeado: 0,
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
    const seenPhones = new Set();
    const seenNames = new Set();

    const leads = rawLeads.map(([key, l]) => {
      const normPhone = normalizePhone(l.telefone);
      const msgs = normPhone ? getConversation(normPhone) : [];
      if (msgs.some((m) => m.role === "user") && ["na_fila", "enviado", "visualizado"].includes(l.state)) {
        l.state = "respondeu";
        db.leads[key].state = "respondeu";
        dbDirty = true;
      }
      const st = l.state || "na_fila";
      counts.total++;
      if (st in counts) counts[st]++;
      if (normPhone) seenPhones.add(normPhone.slice(-8));
      seenNames.add(`${String(l.nome || "").toLowerCase().trim()}|${String(l.cidade || "").toLowerCase().trim()}`);

      const nicho = l.nicho || "Outro";
      if (!byNiche[nicho]) {
        byNiche[nicho] = { nicho, total: 0, na_fila: 0, enviados: 0, respostas: 0, fechados: 0 };
      }
      byNiche[nicho].total++;
      if (st === "na_fila") byNiche[nicho].na_fila++;
      if (["enviado", "visualizado", "respondeu", "proposto", "fechado"].includes(st)) byNiche[nicho].enviados++;
      if (["respondeu", "proposto", "fechado"].includes(st)) byNiche[nicho].respostas++;
      if (st === "fechado") byNiche[nicho].fechados++;

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
        email: l.email || "",
        instagram: igHandle,
        instagramUrl: igUrl,
        state: st,
        score: l.score || 0,
        avaliacoes: l.avaliacoes || 0,
        temSite: !!l.temSite,
        site: l.site || "",
        siteAudit: l.siteAudit || null,
        emailCadence: l.emailCadence || null,
        emitido: l.emitido || "",
        handoff: !!l.handoff,
        msgCount: msgs.length,
        lastMsgAt: msgs.length ? msgs[msgs.length - 1].at : null,
        previewUrl: `${previewBase}/${slug}`,
      };
    });

    if (dbDirty) saveStatus(db);

    const arch = loadArchiveRows();
    let scrapIdx = 1;
    for (const row of arch.rows || []) {
      const normPhone = normalizePhone(row.phone);
      const p8 = normPhone ? normPhone.slice(-8) : "";
      const nameKey = `${String(row.title || "").toLowerCase().trim()}|${String(row.city || "").toLowerCase().trim()}`;
      if ((p8 && seenPhones.has(p8)) || seenNames.has(nameKey)) continue;
      if (p8) seenPhones.add(p8);
      seenNames.add(nameKey);

      const emailFirst = String(row.emails || "").split(/[;,]/)[0].trim();
      const siteRaw = String(row.website || "").trim();
      const igMatch = siteRaw.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
      const igHandle = igMatch && !/^(p|reel|reels|stories|explore|accounts|tv)$/i.test(igMatch[1]) ? `@${igMatch[1]}` : "";
      const igUrl = igHandle ? `https://www.instagram.com/${igHandle.replace(/^@/, "")}/` : "";
      const isSocial = /instagram\.com|facebook\.com|linktr\.ee|wa\.me/i.test(siteRaw);
      const temSite = !!siteRaw && !isSocial;

      counts.total++;
      counts.mapeado++;
      const nicho = row.category || "Outro";
      if (!byNiche[nicho]) byNiche[nicho] = { nicho, total: 0, na_fila: 0, enviados: 0, respostas: 0, fechados: 0 };
      byNiche[nicho].total++;

      leads.push({
        key: `scraped:${slugify(row.title)}:${scrapIdx++}`,
        id: null,
        nome: row.title,
        nicho,
        nichoGrupo: detectNiche(nicho),
        cidade: row.city || "",
        telefone: normPhone,
        email: emailFirst,
        instagram: igHandle,
        instagramUrl: igUrl,
        state: "mapeado",
        score: 0,
        avaliacoes: row.reviews || 0,
        temSite,
        site: temSite ? siteRaw : "",
        siteAudit: null,
        emailCadence: null,
        emitido: "",
        handoff: false,
        msgCount: 0,
        lastMsgAt: null,
        previewUrl: "",
        source: row.source || "Scrap",
      });
    }

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
      if (!body.key) {
        sendJson(res, 400, { error: "Chave ausente" });
        return true;
      }
      if (!db.leads?.[body.key] && String(body.key).startsWith("scraped:") && body.lead) {
        const maxId = Object.values(db.leads || {}).reduce((m, l) => Math.max(m, Number(l.id) || 0), 1000);
        const newKey = slugify(body.lead.nome || body.key);
        db.leads = db.leads || {};
        db.leads[newKey] = {
          id: maxId + 1,
          nome: body.lead.nome || "",
          nicho: body.lead.nicho || "Outro",
          cidade: body.lead.cidade || "",
          telefone: body.lead.telefone || "",
          email: body.lead.email || "",
          canal: "whatsapp",
          temSite: !!body.lead.temSite,
          site: body.lead.site || "",
          avaliacoes: body.lead.avaliacoes || 0,
          score: 0,
          state: body.state || "na_fila",
        };
        saveStatus(db);
        pushLog(`[CRM] Lead "${db.leads[newKey].nome}" movido para ${body.state}`);
        sendJson(res, 200, { ok: true, key: newKey });
        return true;
      }
      if (!db.leads?.[body.key]) {
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

function startWorkerDispatch({ keys = [], dryRun = false, forceHorario = true } = {}) {
  if (workerState.running) return { ok: false, error: "Agente de disparo já está rodando." };
  const args = [resolve(__dirname, "worker-disparo.mjs")];
  if (forceHorario) args.push("--force-horario");
  if (dryRun) args.push("--dry-run");
  if (keys.length) args.push(`--keys=${keys.join(",")}`);

  workerState.logs = [];
  workerState.running = true;
  workerState.startedAt = new Date().toISOString();
  workerState.lastExitCode = null;
  pushLog(`▶ Iniciando disparo (${dryRun ? "SIMULAÇÃO" : "REAL"}${keys.length ? ` · ${keys.length} selecionado(s)` : ""})...`);

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
  return { ok: true, running: true };
}

  if (req.method === "POST" && path === "/api/crm/start") {
    const body = await readJsonBody(req).catch(() => ({}));
    const keys = Array.isArray(body.keys) ? body.keys.filter(Boolean) : [];
    const started = startWorkerDispatch({
      keys,
      dryRun: !!body.dryRun,
      forceHorario: body.forceHorario !== false,
    });
    if (!started.ok) {
      sendJson(res, 409, { error: started.error });
      return true;
    }
    sendJson(res, 200, started);
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

  if (req.method === "POST" && path === "/api/crm/assistant") {
    try {
      const body = await readJsonBody(req);
      const message = String(body.message || "").trim();
      if (!message) { sendJson(res, 400, { error: "Mensagem vazia" }); return true; }
      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

      const db = loadStatus();
      const allEntries = Object.entries(db.leads || {});
      const counts = { na_fila: 0, enviado: 0, respondeu: 0, proposto: 0, fechado: 0, descartado: 0 };
      for (const [, l] of allEntries) counts[l.state] = (counts[l.state] || 0) + 1;
      const filaList = allEntries
        .filter(([, l]) => l.state === "na_fila")
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
        .slice(0, 15)
        .map(([, l]) => `#${l.id} ${l.nome} (${l.nicho}, ${l.cidade}, ${l.temSite ? "com site" : "sem site"}${l.instagram ? ", " + l.instagram : ""})`)
        .join("\n");

      const jobsList = await fetch("http://127.0.0.1:8080/api/v1/jobs")
        .then((r) => r.ok ? r.json() : [])
        .then((arr) => (arr || []).slice(0, 8).map((j) => `- ${j.Name} [${j.Status}]`).join("\n"))
        .catch(() => "");

      const nowMs = Date.now();
      const withEmailCount = allEntries.filter(([, l]) => l.email && String(l.email).includes("@")).length;
      const dueFollowupsCount = allEntries.filter(([, l]) => l.email && l.emailCadence && l.emailCadence.step >= 1 && l.emailCadence.step < 3 && l.emailCadence.nextDueAt && nowMs >= l.emailCadence.nextDueAt).length;

      const sys = `Você é o Assistente Interno do WiNS Hub Comercial (copiloto de prospecção do William).
Responda em português, curto e direto, e quando o usuário pedir para executar uma tarefa real, retorne a ação correspondente em JSON válido (sem markdown).

ESTADO AO VIVO:
- Worker de disparo rodando agora: ${workerState.running ? "SIM" : "NÃO"}
- CRM: na_fila=${counts.na_fila}, enviado=${counts.enviado}, respondeu=${counts.respondeu}, proposto=${counts.proposto}, fechado=${counts.fechado}, descartado=${counts.descartado}
- E-mail: ${withEmailCount} leads com e-mail, ${dueFollowupsCount} follow-ups D+3/D+7 vencidos
- Buscas no Painel:\n${jobsList || "(nenhuma)"}
- Próximos leads na fila (top 15):\n${filaList || "(fila vazia)"}

AÇÕES DISPONÍVEIS:
1. {"type":"search_maps","query":"termo de busca","location":"bairro/cidade","maxResults":60} — cria uma nova busca no Google Maps (use maxResults 20, 60 ou 120; padrão 60).
2. {"type":"audit_batch","limit":5} — audita até N sites de leads no CRM que ainda não foram auditados.
3. {"type":"start_dispatch","limit":5,"ids":[1039,1040],"dryRun":false} — inicia disparo real no WhatsApp para os IDs citados ou os primeiros "limit" da fila (use dryRun:true só se o usuário pedir simulação/teste).
4. {"type":"stop_dispatch"} — para o disparo em andamento.
5. {"type":"send_email","limit":5,"ids":[1039],"dryRun":false} — envia cold e-mail personalizado (via contato@winshubcomercial.com.br) para os IDs citados ou os primeiros "limit" leads com e-mail.
6. {"type":"run_email_cadence","limit":10,"dryRun":false} — envia os follow-ups de e-mail D+3 e D+7 que estão vencidos.
7. {"type":"switch_view","view":"map"|"board"|"crm"} — abre uma aba da ferramenta (board = Painel + Dashboard).
8. null — apenas responder pergunta sem executar ação.

Formato obrigatório:
{"reply":"resposta curta para o William","action":null ou objeto}`;

      const msgs = [
        ...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: message },
      ];
      const raw = await callClaude({ system: sys, messages: msgs, maxTokens: 420 });
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      const parsed = JSON.parse(raw.slice(s, e + 1));
      let reply = String(parsed.reply || "Feito.");
      const act = parsed.action || null;
      let executed = null;

      if (act?.type === "search_maps" && act.query) {
        const locStr = String(act.location || "São Paulo, SP").trim();
        let lat = "-23.5505", lon = "-46.6333";
        try {
          const geo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(locStr)}`, {
            headers: { "User-Agent": "WinsHubAssistant/1.0" },
          }).then((r) => r.json());
          if (Array.isArray(geo) && geo[0]) { lat = String(geo[0].lat); lon = String(geo[0].lon); }
        } catch {}
        const jobRes = await fetch("http://127.0.0.1:8080/api/v1/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${act.query} · ${locStr}`,
            keywords: [`${act.query} em ${locStr}`],
            lang: "pt",
            zoom: 12,
            lat,
            lon,
            radius: 10000,
            depth: Math.max(1, Math.round((Number(act.maxResults) || 60) / 10)),
            email: true,
            max_time: 1800,
          }),
        });
        if (jobRes.ok) {
          const jd = await jobRes.json();
          executed = { type: "search_maps", jobId: jd.id || jd.ID };
          pushLog(`[Assistente] Nova busca criada: ${act.query} · ${locStr}`);
        } else {
          reply += " (Não consegui iniciar a busca no motor agora.)";
        }
      } else if (act?.type === "audit_batch") {
        const lim = Math.min(10, Math.max(1, Number(act.limit) || 5));
        const targets = Object.entries(db.leads || {})
          .filter(([, l]) => l.temSite && l.site && !/instagram\.com|facebook\.com/i.test(l.site) && !l.siteAudit)
          .slice(0, lim);
        for (const [, l] of targets) {
          const resAudit = await auditSite(l.site, l.nome);
          l.siteAudit = resAudit;
          if (!l.instagram && resAudit.instagram) {
            l.instagram = resAudit.instagram;
            l.instagramUrl = resAudit.instagramUrl;
          }
        }
        saveStatus(db);
        executed = { type: "audit_batch", count: targets.length };
        pushLog(`[Assistente] ${targets.length} sites auditados.`);
      } else if (act?.type === "start_dispatch") {
        let keys = [];
        if (Array.isArray(act.ids) && act.ids.length) {
          const want = new Set(act.ids.map(Number));
          keys = allEntries.filter(([, l]) => want.has(l.id) && l.state === "na_fila").map(([k]) => k);
        } else {
          const lim = Math.min(18, Math.max(1, Number(act.limit) || 5));
          keys = allEntries.filter(([, l]) => l.state === "na_fila").slice(0, lim).map(([k]) => k);
        }
        if (!keys.length) {
          reply = "Não encontrei leads na fila para disparar.";
        } else {
          const started = startWorkerDispatch({ keys, dryRun: !!act.dryRun, forceHorario: true });
          if (!started.ok) reply = started.error;
          else executed = { type: "start_dispatch", count: keys.length };
        }
      } else if (act?.type === "stop_dispatch") {
        if (workerState.running && workerState.proc) {
          workerState.proc.kill("SIGTERM");
          executed = { type: "stop_dispatch" };
        }
      } else if (act?.type === "send_email") {
        const want = Array.isArray(act.ids) && act.ids.length ? new Set(act.ids.map(Number)) : null;
        const lim = Math.min(20, Math.max(1, Number(act.limit) || 5));
        const targets = allEntries
          .filter(([, l]) => l.email && String(l.email).includes("@") && (want ? want.has(l.id) : (!l.emailCadence && l.state !== "fechado" && l.state !== "descartado")))
          .slice(0, want ? want.size : lim);
        if (!targets.length) {
          reply = "Não encontrei leads com e-mail válido disponíveis para envio.";
        } else {
          let sentCount = 0;
          for (const [k, l] of targets) {
            try {
              const r = await sendLeadEmail(db, k, l, { step: 1, dryRun: !!act.dryRun });
              if (r.ok) sentCount++;
            } catch {}
          }
          if (!act.dryRun && sentCount) saveStatus(db);
          pushLog(`✉️ Assistente enviou ${sentCount}/${targets.length} e-mail(s)`);
          reply = `${act.dryRun ? "Simulação concluída" : "Envio concluído"}: ${sentCount} de ${targets.length} e-mail(s) processado(s).`;
          executed = { type: "send_email", count: sentCount };
        }
      } else if (act?.type === "run_email_cadence") {
        const lim = Math.min(30, Math.max(1, Number(act.limit) || 10));
        const results = await runDueEmailCadence(db, { limit: lim, dryRun: !!act.dryRun });
        const okCount = results.filter((r) => r.ok).length;
        if (!act.dryRun && okCount) saveStatus(db);
        pushLog(`✉️ Cadência de e-mail: ${okCount}/${results.length} follow-up(s)`);
        reply = results.length ? `Cadência executada: ${okCount} follow-up(s) enviado(s).` : "Nenhum follow-up de e-mail vencido no momento.";
        executed = { type: "run_email_cadence", count: okCount };
      } else if (act?.type === "switch_view") {
        executed = { type: "switch_view", view: act.view };
      }

      sendJson(res, 200, { ok: true, reply, executed });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/email/test") {
    try {
      const body = await readJsonBody(req);
      const to = String(body.to || process.env.SMTP_USER || "contato@winshubcomercial.com.br").trim();
      await verifySmtp();
      const r = await sendMail({
        to,
        subject: "Teste SMTP · WiNS Hub Comercial",
        text: "Olá William!\n\nEste é um teste de envio real da conta contato@winshubcomercial.com.br pela WiNS Hub Comercial.\n\nTudo configurado e funcionando.",
      });
      sendJson(res, 200, { ok: true, to, messageId: r.messageId });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/email/send") {
    try {
      const body = await readJsonBody(req);
      const db = loadStatus();
      const want = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids.map(Number)) : null;
      const lim = Math.min(30, Math.max(1, Number(body.limit) || 5));
      const targets = Object.entries(db.leads || {})
        .filter(([, l]) => l.email && String(l.email).includes("@") && (want ? want.has(l.id) : (!l.emailCadence && l.state !== "fechado" && l.state !== "descartado")))
        .slice(0, want ? want.size : lim);
      const results = [];
      for (const [k, l] of targets) {
        try {
          results.push(await sendLeadEmail(db, k, l, { step: body.step ? Number(body.step) : undefined, dryRun: !!body.dryRun }));
        } catch (e) {
          results.push({ ok: false, id: l.id, nome: l.nome, error: e.message });
        }
      }
      if (!body.dryRun && results.some((r) => r.ok)) saveStatus(db);
      sendJson(res, 200, { ok: true, sent: results.filter((r) => r.ok).length, results });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/email/cadence") {
    try {
      const body = await readJsonBody(req);
      const db = loadStatus();
      const results = await runDueEmailCadence(db, { limit: Number(body.limit) || 10, dryRun: !!body.dryRun });
      if (!body.dryRun && results.some((r) => r.ok)) saveStatus(db);
      sendJson(res, 200, { ok: true, sent: results.filter((r) => r.ok).length, results });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
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

