// crm.mjs — APIs e controle do Mini-CRM + Start/Stop do worker-disparo
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadStatus, saveStatus, normalizePhone, getConversation, DAILY_LOG_PATH,
} from "./lib.mjs";
import { slugify, detectNiche } from "../entrega/previas/templates.mjs";

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

      return {
        key,
        id: l.id,
        nome: l.nome,
        nicho,
        nichoGrupo: detectNiche(nicho),
        cidade: l.cidade,
        telefone: normPhone,
        state: st,
        score: l.score || 0,
        avaliacoes: l.avaliacoes || 0,
        temSite: !!l.temSite,
        site: l.site || "",
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
      return (b.score || 0) - (a.score || 0);
    });

    sendJson(res, 200, {
      counts,
      daily: getDailyStats(),
      byNiche: Object.values(byNiche).sort((a, b) => b.total - a.total),
      worker: {
        running: workerState.running,
        startedAt: workerState.startedAt,
        lastExitCode: workerState.lastExitCode,
        logs: workerState.logs,
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

    workerState.logs = [];
    workerState.running = true;
    workerState.startedAt = new Date().toISOString();
    workerState.lastExitCode = null;
    pushLog(`▶ Iniciando disparo (${body.dryRun ? "SIMULAÇÃO" : "REAL"})...`);

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
      if (body.csvContent && body.filename) {
        const safeName = String(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        const dest = resolve(WEBDATA_DIR, safeName.endsWith(".csv") ? safeName : `${safeName}.csv`);
        writeFileSync(dest, body.csvContent, "utf8");
        pushLog(`📥 CSV salvo em webdata/${safeName}`);
      }
      const leadsOut = resolve(PROSPECCAO_DIR, "leads.json");
      const conv = await execFileAsync(process.execPath, [resolve(PROSPECCAO_DIR, "converter-leads.mjs"), "-o", leadsOut], { cwd: PROSPECCAO_DIR });
      pushLog(conv.stdout);
      const fila = await execFileAsync(process.execPath, [resolve(PROSPECCAO_DIR, "gerar-fila.mjs"), leadsOut, "--limit", String(limit), "--canal", "whatsapp"], { cwd: PROSPECCAO_DIR });
      pushLog(fila.stdout);
      sendJson(res, 200, { ok: true, output: `${conv.stdout}\n${fila.stdout}` });
    } catch (e) {
      pushLog(`❌ Erro ao importar CSV: ${e.message}`);
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  sendJson(res, 404, { error: "Rota CRM não encontrada" });
  return true;
}

