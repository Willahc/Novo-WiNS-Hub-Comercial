// crm.mjs — APIs e controle do Mini-CRM + Start/Stop do worker-disparo
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import {
  loadStatus, saveStatus, patchStatus, normalizePhone, getConversation, qualificarLead, callClaude,
  DAILY_LOG_PATH, STATUS_PATH, CONVERSAS_DIR,
  logActivity, readActivity, getEvolutionState, getAnthropicUsage,
} from "./lib.mjs";
import { slugify, detectNiche } from "../entrega/previas/templates.mjs";
import { auditSite, runLighthouse } from "../prospeccao/site-audit.mjs";
import { verifySmtp, sendMail, sendLeadEmail, runDueEmailCadence } from "./email.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECCAO_DIR = resolve(__dirname, "..", "prospeccao");
const WEBDATA_DIR = resolve(__dirname, "..", "..", "webdata");
const CEP_GEO_CACHE_PATH = resolve(__dirname, "..", "..", "data", "cep-geo-cache.json");
let cepGeoCache = null;

function getCepGeoCache() {
  if (cepGeoCache) return cepGeoCache;
  try {
    cepGeoCache = existsSync(CEP_GEO_CACHE_PATH) ? JSON.parse(readFileSync(CEP_GEO_CACHE_PATH, "utf8")) : {};
  } catch {
    cepGeoCache = {};
  }
  return cepGeoCache;
}

async function enrichItemsWithCepGeo(items) {
  const cache = getCepGeoCache();
  const pendingCeps = [];
  const seen = new Set();
  for (const it of items) {
    const cep = String(it.cep || "").replace(/\D/g, "");
    if (cep.length !== 8) continue;
    if (cache[cep]) {
      it.latitude = cache[cep].lat;
      it.longitude = cache[cep].lon;
    } else if (!seen.has(cep) && pendingCeps.length < 30) {
      seen.add(cep);
      pendingCeps.push(cep);
    }
  }
  if (!pendingCeps.length) return;

  let dirty = false;
  const workers = Array.from({ length: Math.min(6, pendingCeps.length) }, async () => {
    while (pendingCeps.length) {
      const cep = pendingCeps.shift();
      if (!cep) break;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1600);
        const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) continue;
        const j = await r.json();
        const coords = j?.location?.coordinates;
        const lat = Number(coords?.latitude);
        const lon = Number(coords?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
          cache[cep] = { lat, lon };
          dirty = true;
        }
      } catch {}
    }
  });
  await Promise.all(workers);
  if (dirty) {
    try { writeFileSync(CEP_GEO_CACHE_PATH, JSON.stringify(cache)); } catch {}
  }
  for (const it of items) {
    const cep = String(it.cep || "").replace(/\D/g, "");
    if (cep.length === 8 && cache[cep]) {
      it.latitude = cache[cep].lat;
      it.longitude = cache[cep].lon;
    }
  }
}
const CRM_HTML_PATH = resolve(__dirname, "crm.html");

const workerState = {
  proc: null,
  running: false,
  startedAt: null,
  lastExitCode: null,
  logs: [],
  lastSimulatedKeys: [],
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

function sendJsonGz(req, res, status, data) {
  const json = JSON.stringify(data);
  const ae = String(req?.headers?.["accept-encoding"] || "");
  if (json.length > 4096 && ae.includes("gzip")) {
    const gz = gzipSync(json);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Vary": "Accept-Encoding",
    });
    res.end(gz);
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
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

let liveJobsCache = { at: 0, rows: [] };

async function loadLiveJobRows() {
  if (Date.now() - liveJobsCache.at < 60000) return liveJobsCache.rows;
  try {
    const jobsRes = await fetch("http://127.0.0.1:8080/api/v1/jobs");
    if (!jobsRes.ok) return liveJobsCache.rows;
    const jobs = await jobsRes.json();
    const batches = await Promise.all(
      (jobs || []).slice(0, 25).map(async (j) => {
        try {
          const pr = await fetch(`http://127.0.0.1:8080/api/v1/jobs/${encodeURIComponent(j.ID)}/places`);
          if (!pr.ok) return [];
          const places = await pr.json();
          const items = [];
          for (const p of places || []) {
            if (!p.title) continue;
            items.push({
              title: p.title,
              category: p.category || "",
              city: p.city || p.borough || "",
              phone: p.phone || "",
              website: p.website || "",
              emails: p.emails || "",
              tech: p.tech || "",
              rating: Number(p.review_rating || p.rating) || 0,
              reviews: Number(p.review_count || p.reviews) || 0,
              link: p.link || "",
              source: j.Name || "Busca Maps",
            });
          }
          return items;
        } catch {
          return [];
        }
      })
    );
    const out = batches.flat();
    liveJobsCache = { at: Date.now(), rows: out };
    return out;
  } catch {
    return liveJobsCache.rows;
  }
}

function computeProspectScore({ temSite, telefone, email, avaliacoes = 0, notaGoogle = 0, siteAudit = null }) {
  let score = 0;
  if (!temSite) score += 35;
  else if (siteAudit && typeof siteAudit.score === "number" && siteAudit.score < 70) score += 25;
  else score += 10;

  if (telefone) score += 25;
  if (email) score += 15;

  const rev = Number(avaliacoes) || 0;
  if (rev >= 50) score += 15;
  else if (rev >= 15) score += 10;
  else if (rev >= 5) score += 5;

  const rat = Number(notaGoogle) || 0;
  if (rat >= 4.5) score += 10;
  else if (rat >= 4.0) score += 5;

  score = Math.min(100, Math.max(0, score));

  let oportunidade = "Sem contato";
  let canalIdeal = "none";
  if (!temSite && telefone) {
    oportunidade = "WhatsApp + Sem site";
    canalIdeal = "whatsapp";
  } else if (!temSite && !telefone && email) {
    oportunidade = "E-mail + Sem site";
    canalIdeal = "email";
  } else if (temSite && telefone) {
    oportunidade = siteAudit && siteAudit.score < 70 ? `WhatsApp + Site ${siteAudit.score}/100` : "WhatsApp + Site";
    canalIdeal = "whatsapp";
  } else if (temSite && !telefone && email) {
    oportunidade = "E-mail + Site";
    canalIdeal = "email";
  }

  return { score, oportunidade, canalIdeal };
}

function materializeLeads(db, rawLeads, targetState = "na_fila") {
  db.leads = db.leads || {};
  let maxId = Object.values(db.leads).reduce((m, l) => Math.max(m, Number(l.id) || 0), 1000);
  const keys = [];
  for (const item of rawLeads || []) {
    if (!item || !item.key) continue;
    if (db.leads[item.key]) {
      if (targetState && ["mapeado", "na_fila"].includes(db.leads[item.key].state || "na_fila")) {
        db.leads[item.key].state = targetState;
      }
      keys.push(item.key);
      continue;
    }
    const newKey = slugify(item.nome || item.key);
    if (db.leads[newKey]) {
      if (targetState && ["mapeado", "na_fila"].includes(db.leads[newKey].state || "na_fila")) {
        db.leads[newKey].state = targetState;
      }
      keys.push(newKey);
      continue;
    }
    maxId++;
    db.leads[newKey] = {
      id: maxId,
      nome: item.nome || "",
      nicho: item.nicho || "Outro",
      cidade: item.cidade || "",
      telefone: item.telefone || "",
      email: item.email || "",
      canal: item.telefone ? "whatsapp" : "email",
      temSite: !!item.temSite,
      site: item.site || "",
      avaliacoes: Number(item.avaliacoes) || 0,
      notaGoogle: Number(item.notaGoogle) || 0,
      score: Number(item.score) || 0,
      state: targetState || "na_fila",
    };
    keys.push(newKey);
  }
  return keys;
}

let overviewBaseCache = { key: "", data: null };

function getOverviewCacheKey() {
  let stSig = "0";
  try { const s = statSync(STATUS_PATH); stSig = `${s.mtimeMs}:${s.size}`; } catch {}
  let convSig = "0";
  try { const c = statSync(CONVERSAS_DIR); convSig = `${c.mtimeMs}`; } catch {}
  return `${stSig}|${convSig}|${liveJobsCache.at}|${archiveCache.key}`;
}

function leadTechList(l) {
  const set = new Set();
  const addAll = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      const s = String(x || "").trim();
      if (s) set.add(s);
    }
  };
  addAll(l.tech);
  addAll(l.siteAudit?.stack);
  addAll(l.siteAudit?.pixels);
  return [...set];
}

function isPendingLead(l) {
  return (!l.state || l.state === "mapeado") && !l.emailCadence;
}

async function buildOverviewBase() {
  const arch = loadArchiveRows();
  const liveRows = await loadLiveJobRows();
  const cKey = getOverviewCacheKey();
  if (overviewBaseCache.key === cKey && overviewBaseCache.data) {
    return overviewBaseCache.data;
  }

  const db = loadStatus();
  let dbDirty = false;
  const rawLeads = Object.entries(db.leads || {});
  const counts = {
    total: 0,
    pending: 0,
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
    if ((!st || st === "mapeado") && !l.emailCadence) counts.pending++;
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

    const emailStr = l.email || "";
    const scored = computeProspectScore({
      temSite: !!l.temSite,
      telefone: normPhone,
      email: emailStr,
      avaliacoes: l.avaliacoes || 0,
      notaGoogle: l.notaGoogle || 0,
      siteAudit: l.siteAudit || null,
    });

    const item = {
      key,
      id: l.id,
      nome: l.nome,
      nicho,
      nichoGrupo: detectNiche(nicho),
      cidade: l.cidade,
      telefone: normPhone,
      email: emailStr,
      instagram: igHandle,
      instagramUrl: igUrl,
      state: st,
      score: scored.score,
      oportunidade: scored.oportunidade,
      canalIdeal: scored.canalIdeal,
      avaliacoes: l.avaliacoes || 0,
      notaGoogle: l.notaGoogle || 0,
      temSite: !!l.temSite,
      site: l.site || "",
      tech: Array.isArray(l.tech) ? l.tech : [],
      siteAudit: l.siteAudit || null,
      lighthouse: l.lighthouse || null,
      emailCadence: l.emailCadence || null,
      foraDoMaps: !!l.foraDoMaps,
      optanteMei: !!l.optanteMei,
      cnpj: l.cnpj || "",
      endereco: l.endereco || "",
      emitido: l.emitido || "",
      handoff: !!l.handoff,
      msgCount: msgs.length,
      lastMsgAt: msgs.length ? msgs[msgs.length - 1].at : null,
      previewViews: l.previewViews || 0,
      previewUrl: `${previewBase}/${slug}`,
    };
    item.tech = leadTechList(item);
    return item;
  });

  if (dbDirty) saveStatus(db);

  let scrapIdx = 1;
  for (const row of [...liveRows, ...(arch.rows || [])]) {
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
    counts.pending++;
    const nicho = row.category || "Outro";
    if (!byNiche[nicho]) byNiche[nicho] = { nicho, total: 0, na_fila: 0, enviados: 0, respostas: 0, fechados: 0 };
    byNiche[nicho].total++;

    const scored = computeProspectScore({
      temSite,
      telefone: normPhone,
      email: emailFirst,
      avaliacoes: row.reviews || 0,
      notaGoogle: row.rating || 0,
      siteAudit: null,
    });

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
      score: scored.score,
      oportunidade: scored.oportunidade,
      canalIdeal: scored.canalIdeal,
      avaliacoes: row.reviews || 0,
      notaGoogle: row.rating || 0,
      temSite,
      site: temSite ? siteRaw : "",
      tech: row.tech ? String(row.tech).split(",").map((s) => s.trim()).filter(Boolean) : [],
      siteAudit: null,
      lighthouse: null,
      emailCadence: null,
      emitido: "",
      handoff: false,
      msgCount: 0,
      lastMsgAt: null,
      previewViews: 0,
      previewUrl: "",
      source: row.source || "Scrap",
    });
  }

  leads.sort((a, b) => {
    const ta = a.lastMsgAt ? Date.parse(a.lastMsgAt) : 0;
    const tb = b.lastMsgAt ? Date.parse(b.lastMsgAt) : 0;
    if (tb !== ta) return tb - ta;
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (b.avaliacoes || 0) - (a.avaliacoes || 0);
  });

  const auditedCount = rawLeads.filter(([, l]) => !!l.siteAudit).length;
  const data = {
    counts,
    byNiche: Object.values(byNiche).sort((a, b) => b.total - a.total),
    auditedCount,
    leads,
  };
  overviewBaseCache = { key: getOverviewCacheKey(), data };
  return data;
}

function filterAndSortLeads(leads, { state = "all", opp = "all", tech = "all", q = "", sort = "", dir = "asc", keys = null } = {}) {
  const qLow = String(q || "").trim().toLowerCase();
  const techLow = String(tech || "all").trim().toLowerCase();
  const keySet = keys && keys.length ? new Set(keys) : null;

  let list = leads.filter((l) => {
    if (keySet && !keySet.has(l.key)) return false;
    if (!keySet) {
      if (state === "all") {
        if (!isPendingLead(l)) return false;
      } else if (state !== "any" && l.state !== state) {
        return false;
      }
      if (opp === "wa_nosite" && !(!l.temSite && l.telefone)) return false;
      if (opp === "email_nosite" && !(!l.temSite && l.email)) return false;
      if (opp === "has_wa" && !l.telefone) return false;
      if (opp === "has_email" && !l.email) return false;
      if (opp === "nosite" && l.temSite) return false;
      if (techLow && techLow !== "all") {
        const tList = (l.tech || []).map((t) => String(t).toLowerCase());
        if (techLow === "no_pixel") {
          const hasTracking = tList.some((t) => t.includes("gtm") || t.includes("tag manager") || t.includes("meta pixel"));
          if (!l.temSite || hasTracking) return false;
        } else if (techLow === "gtm") {
          if (!tList.some((t) => t.includes("gtm") || t.includes("tag manager"))) return false;
        } else {
          if (!tList.some((t) => t.includes(techLow))) return false;
        }
      }
      if (qLow) {
        const hay = `${l.nome || ""} ${l.nicho || ""} ${l.cidade || ""} ${l.email || ""} ${(l.tech || []).join(" ")}`.toLowerCase();
        if (!hay.includes(qLow)) return false;
      }
    }
    return true;
  });

  if (sort) {
    const sdir = dir === "desc" ? -1 : 1;
    const sortVal = (l) => {
      if (sort === "score") return Number(l.score) || 0;
      if (sort === "nome") return String(l.nome || "").toLowerCase();
      if (sort === "nicho") return `${l.nicho || ""} ${l.cidade || ""}`.toLowerCase();
      if (sort === "contatos") return `${l.telefone ? "2_" : (l.email ? "1_" : "0_")}${l.telefone || l.email || ""}`;
      if (sort === "site") return `${l.temSite ? "2_" : "0_"}${String(l.site || "").toLowerCase()}`;
      if (sort === "state" || sort === "status") return String(l.state || "").toLowerCase();
      if (sort === "conversa") return Number(l.msgCount || 0);
      if (sort === "previa") return l.previewUrl ? 1 : 0;
      return "";
    };
    list = [...list].sort((a, b) => {
      const va = sortVal(a);
      const vb = sortVal(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sdir;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * sdir;
    });
  }
  return list;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

  if (req.method === "GET" && path === "/api/crm/export.csv") {
    const base = await buildOverviewBase();
    const keysParam = url.searchParams.get("keys") || "";
    const keys = keysParam ? keysParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const filtered = filterAndSortLeads(base.leads, {
      state: url.searchParams.get("state") || "all",
      opp: url.searchParams.get("opp") || "all",
      tech: url.searchParams.get("tech") || "all",
      q: url.searchParams.get("q") || "",
      sort: url.searchParams.get("sort") || "",
      dir: url.searchParams.get("dir") || "asc",
      keys,
    });
    const header = ["ID", "Empresa", "Nicho", "Cidade", "Telefone", "Email", "Site", "Instagram", "Tech", "Score", "Oportunidade", "Etapa", "Avaliacoes", "Nota", "Previa"];
    const rows = [header.join(",")];
    for (const l of filtered) {
      rows.push([
        l.id ?? "",
        l.nome,
        l.nicho,
        l.cidade,
        l.telefone,
        l.email,
        l.site,
        l.instagram,
        (l.tech || []).join(" | "),
        l.score,
        l.oportunidade,
        l.state,
        l.avaliacoes,
        l.notaGoogle,
        l.previewUrl,
      ].map(csvCell).join(","));
    }
    const csv = "\uFEFF" + rows.join("\r\n");
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="winshub-crm-${stamp}.csv"`,
    });
    res.end(csv);
    return true;
  }

  if (req.method === "GET" && path === "/api/crm/overview") {
    const base = await buildOverviewBase();
    const sp = url.searchParams;
    const hasQuery = sp.has("limit") || sp.has("state") || sp.has("opp") || sp.has("tech") || sp.has("q") || sp.has("sort");
    let outLeads = base.leads;
    let totalFiltered = base.leads.length;
    let hasMore = false;

    if (hasQuery) {
      const filtered = filterAndSortLeads(base.leads, {
        state: sp.get("state") || "all",
        opp: sp.get("opp") || "all",
        tech: sp.get("tech") || "all",
        q: sp.get("q") || "",
        sort: sp.get("sort") || "",
        dir: sp.get("dir") || "asc",
      });
      totalFiltered = filtered.length;
      const offset = Math.max(0, Number(sp.get("offset")) || 0);
      const limit = Math.min(500, Math.max(10, Number(sp.get("limit")) || 80));
      outLeads = filtered.slice(offset, offset + limit);
      hasMore = offset + outLeads.length < totalFiltered;
    }

    const persistentLogs = readActivity(80);
    const mergedLogs = persistentLogs.length ? persistentLogs : workerState.logs;
    const evoState = await getCachedEvoState();

    sendJsonGz(req, res, 200, {
      counts: base.counts,
      daily: getDailyStats(),
      byNiche: base.byNiche,
      totalFiltered,
      hasMore,
      agents: {
        evolution: evoState,
        webhook: "online",
        workerRunning: workerState.running,
        auditedCount: base.auditedCount,
        anthropic: getAnthropicUsage(),
      },
      worker: {
        running: workerState.running,
        startedAt: workerState.startedAt,
        lastExitCode: workerState.lastExitCode,
        logs: mergedLogs,
      },
      leads: outLeads,
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

  if (req.method === "POST" && path === "/api/crm/simulate") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const list = Array.isArray(body.leads) ? body.leads : [];
      const items = list.map((l) => {
        const hasWa = !!normalizePhone(l.telefone);
        const hasEm = !!(l.email && String(l.email).includes("@"));
        const canal = hasWa ? "whatsapp" : hasEm ? "email" : "none";
        const oferta = !l.temSite ? "Site novo + Prévia personalizada" : "Redesign / Raio-X de Conversão";
        return {
          key: l.key,
          nome: l.nome,
          score: l.score || 0,
          oportunidade: l.oportunidade || "",
          canal,
          contato: hasWa ? normalizePhone(l.telefone) : (hasEm ? l.email : "Sem contato"),
          oferta,
        };
      });
      sendJson(res, 200, {
        ok: true,
        total: items.length,
        whatsappReady: items.filter((i) => i.canal === "whatsapp").length,
        emailReady: items.filter((i) => i.canal === "email").length,
        noContact: items.filter((i) => i.canal === "none").length,
        items,
      });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/start") {
    const body = await readJsonBody(req).catch(() => ({}));
    let keys = Array.isArray(body.keys) ? body.keys.filter(Boolean) : [];
    if (Array.isArray(body.leads) && body.leads.length) {
      const db = loadStatus();
      keys = materializeLeads(db, body.leads, "na_fila");
      saveStatus(db);
    }
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
      const topOpportunities = allEntries
        .filter(([, l]) => l.state === "na_fila" || l.state === "mapeado")
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
        .slice(0, 22)
        .map(([, l]) => `#${l.id} [${l.state}|score:${l.score || 0}] ${l.nome} (${l.nicho}, ${l.cidade}, ${l.temSite ? "com site" : "sem site"}${l.telefone ? ", WA" : ""}${l.email ? ", Email" : ""}${l.foraDoMaps ? ", Fora do Maps" : ""})`)
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
- Melhores oportunidades (na_fila + mapeado, top 22 por score):\n${topOpportunities || "(nenhuma)"}

AÇÕES DISPONÍVEIS:
1. {"type":"search_maps","query":"termo de busca","location":"bairro/cidade","maxResults":60} — cria uma nova busca no Google Maps (use maxResults 20, 60 ou 120; padrão 60).
2. {"type":"audit_batch","limit":5} — audita até N sites de leads no CRM que ainda não foram auditados.
3. {"type":"queue_leads","ids":[1039,1040],"limit":18} — move os IDs citados (ou os top "limit" leads mapeados por score) para a fila (na_fila) para revisão/simulação.
4. {"type":"start_dispatch","limit":5,"ids":[1039,1040],"dryRun":false} — inicia disparo (ou simulação com dryRun:true) no WhatsApp para os IDs citados (se estiverem em mapeado, move automaticamente para na_fila) ou os primeiros "limit" da fila.
5. {"type":"stop_dispatch"} — para o disparo em andamento.
6. {"type":"send_email","limit":5,"ids":[1039],"dryRun":false} — envia cold e-mail personalizado (via contato@winshubcomercial.com.br) para os IDs citados ou os primeiros "limit" leads com e-mail.
7. {"type":"run_email_cadence","limit":10,"dryRun":false} — envia os follow-ups de e-mail D+3 e D+7 que estão vencidos.
8. {"type":"switch_view","view":"map"|"dash"|"crm"} — abre uma aba da ferramenta (dash = Dashboard, crm = Central de Prospecção).
9. null — apenas responder pergunta sem executar ação.

Formato obrigatório:
{"reply":"resposta curta para o William","action":null ou objeto}`;

      const msgs = [
        ...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: message },
      ];
      const raw = await callClaude({ system: sys, messages: msgs, maxTokens: 1400, cacheSystem: true });
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      let parsed = null;
      if (s >= 0 && e > s) {
        try {
          parsed = JSON.parse(raw.slice(s, e + 1));
        } catch {}
      }
      if (!parsed) {
        const cleanReply = raw.replace(/^\s*\{\s*"reply"\s*:\s*"/, "").replace(/"\s*,?\s*"action"[\s\S]*$/, "").replace(/\\n/g, "\n").trim();
        parsed = { reply: cleanReply || raw.trim() || "Não consegui formatar a resposta.", action: null };
      }
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
      } else if (act?.type === "queue_leads") {
        let targets = [];
        if (Array.isArray(act.ids) && act.ids.length) {
          const want = new Set(act.ids.map(Number));
          targets = allEntries.filter(([, l]) => want.has(l.id) && (l.state === "mapeado" || l.state === "na_fila"));
        } else {
          const lim = Math.min(30, Math.max(1, Number(act.limit) || 18));
          targets = allEntries
            .filter(([, l]) => l.state === "mapeado" && (l.telefone || l.email))
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
            .slice(0, lim);
        }
        let moved = 0;
        for (const [k, l] of targets) {
          if (l.state !== "na_fila") {
            db.leads[k].state = "na_fila";
            moved++;
          }
        }
        if (moved > 0) saveStatus(db);
        executed = { type: "queue_leads", count: targets.length, moved };
        pushLog(`[Assistente] ${targets.length} leads colocados na fila (${moved} movidos de mapeado → na_fila).`);
        if (targets.length) {
          reply = `${targets.length} leads prontos na fila (${moved} adicionados agora). Pode pedir para simular ou clicar em Simular/Start no CRM!`;
        } else {
          reply = "Não encontrei leads disponíveis com contato para colocar na fila.";
        }
      } else if (act?.type === "start_dispatch") {
        let keys = [];
        let moved = 0;
        if (Array.isArray(act.ids) && act.ids.length) {
          const want = new Set(act.ids.map(Number));
          const matched = allEntries.filter(([, l]) => want.has(l.id) && (l.state === "na_fila" || l.state === "mapeado"));
          for (const [k, l] of matched) {
            if (l.state === "mapeado") {
              db.leads[k].state = "na_fila";
              moved++;
            }
            keys.push(k);
          }
        } else {
          const lim = Math.min(18, Math.max(1, Number(act.limit) || 5));
          if (!act.dryRun && workerState.lastSimulatedKeys.length) {
            // Reutiliza os mesmos leads da última simulação se ainda estiverem na fila.
            const simSet = new Set(workerState.lastSimulatedKeys);
            keys = allEntries.filter(([k, l]) => simSet.has(k) && l.state === "na_fila").slice(0, lim).map(([k]) => k);
          }
          if (!keys.length) {
            keys = allEntries.filter(([, l]) => l.state === "na_fila").slice(0, lim).map(([k]) => k);
          }
          if (!keys.length && act.dryRun) {
            const topMapped = allEntries
              .filter(([, l]) => l.state === "mapeado" && l.telefone)
              .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
              .slice(0, lim);
            for (const [k] of topMapped) {
              db.leads[k].state = "na_fila";
              moved++;
              keys.push(k);
            }
          }
        }
        if (moved > 0) saveStatus(db);
        if (!keys.length) {
          reply = "Não encontrei leads na fila (nem mapeados com WhatsApp) para simular ou disparar.";
        } else {
          const started = startWorkerDispatch({ keys, dryRun: !!act.dryRun, forceHorario: true });
          if (!started.ok) reply = started.error;
          else {
            workerState.lastSimulatedKeys = act.dryRun ? [...keys] : [];
            executed = { type: "start_dispatch", count: keys.length, dryRun: !!act.dryRun };
            if (act.dryRun) {
              reply = `Simulação iniciada para ${keys.length} leads${moved ? ` (${moved} movidos para a fila)` : ""}. Acompanhe o resultado em LOGS AO VIVO!`;
            }
          }
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

  if (req.method === "GET" && path === "/api/crm/cnae-sp/status") {
    try {
      const { stdout } = await execFileAsync("python3", [resolve(PROSPECCAO_DIR, "cnpj-sp-query.py"), "status"], { timeout: 10000 });
      sendJson(res, 200, JSON.parse(stdout));
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/crm/cnae-sp/search") {
    try {
      const body = await readJsonBody(req);
      const cnae = String(body.cnae || "").trim();
      const cidade = String(body.cidade || "São Paulo").trim();
      const meiOnly = body.meiOnly !== false;
      const limit = Math.min(200, Math.max(1, Number(body.limit) || 60));
      const { stdout } = await execFileAsync(
        "python3",
        [resolve(PROSPECCAO_DIR, "cnpj-sp-query.py"), "search", JSON.stringify({ cnae, cidade, meiOnly, limit })],
        { timeout: 20000 }
      );
      const parsed = JSON.parse(stdout);
      if (!parsed.ok) {
        sendJson(res, 400, parsed);
        return true;
      }

      const db = loadStatus();
      db.leads = db.leads || {};
      const mapsPhones = new Set();
      const mapsNames = new Set();
      const liveRows = await loadLiveJobRows();
      const arch = loadArchiveRows();
      for (const r of [...liveRows, ...(arch.rows || [])]) {
        const p = normalizePhone(r.phone);
        if (p) mapsPhones.add(p.slice(-8));
        if (r.title) mapsNames.add(String(r.title).toLowerCase().trim());
      }
      for (const l of Object.values(db.leads)) {
        const p = normalizePhone(l.telefone);
        if (p) mapsPhones.add(p.slice(-8));
        if (l.nome) mapsNames.add(String(l.nome).toLowerCase().trim());
      }

      let maxId = Object.values(db.leads).reduce((m, l) => Math.max(m, Number(l.id) || 0), 1000);
      let imported = 0;
      let foraDoMapsCount = 0;
      const items = (parsed.rows || []).map((row) => {
        const nome = row.nome_fantasia || row.razao_social || `CNPJ ${row.cnpj}`;
        const normPhone = normalizePhone(row.telefone || row.telefone2 || "");
        const p8 = normPhone ? normPhone.slice(-8) : "";
        const inMaps = (p8 && mapsPhones.has(p8)) || mapsNames.has(nome.toLowerCase().trim());
        const foraDoMaps = !inMaps;
        if (foraDoMaps) foraDoMapsCount++;
        const scored = computeProspectScore({
          temSite: false,
          telefone: normPhone,
          email: row.email || "",
          avaliacoes: 0,
          notaGoogle: 0,
        });

        const key = `cnae-${row.cnpj}`;
        if (body.importToCrm !== false && !db.leads[key]) {
          maxId++;
          db.leads[key] = {
            id: maxId,
            nome,
            nicho: `CNAE ${parsed.cnae}`,
            cidade: parsed.municipio || cidade,
            telefone: normPhone,
            email: row.email || "",
            canal: normPhone ? "whatsapp" : "email",
            temSite: false,
            site: "",
            avaliacoes: 0,
            score: scored.score,
            state: "mapeado",
            cnpj: row.cnpj,
            optanteMei: row.optante_mei === "S",
            foraDoMaps,
            endereco: [row.endereco, row.bairro, row.cep].filter(Boolean).join(" · "),
          };
          imported++;
        }
        return {
          key,
          nome,
          cnpj: row.cnpj,
          telefone: normPhone,
          email: row.email || "",
          endereco: row.endereco || "",
          bairro: row.bairro || "",
          cep: row.cep || "",
          cnae: parsed.cnae,
          cidade: parsed.municipio || cidade,
          foraDoMaps,
          optanteMei: row.optante_mei === "S",
          score: scored.score,
        };
      });

      await enrichItemsWithCepGeo(items);

      if (imported > 0) saveStatus(db);
      pushLog(`🏢 CNAE SP (${parsed.cnae} · ${parsed.municipio}): ${items.length} encontrados, ${foraDoMapsCount} fora do Maps, ${imported} adicionados ao CRM`);
      sendJson(res, 200, { ok: true, municipio: parsed.municipio, cnae: parsed.cnae, total: items.length, foraDoMapsCount, imported, items });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
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
      let targets = [];
      if (body.key && db.leads?.[body.key]) {
        if (body.email && String(body.email).includes("@")) {
          db.leads[body.key].email = String(body.email).trim().toLowerCase();
          saveStatus(db);
        }
        const l = db.leads[body.key];
        if (l.email && String(l.email).includes("@")) {
          targets = [[body.key, l]];
        }
      } else if (Array.isArray(body.leads) && body.leads.length) {
        const keys = materializeLeads(db, body.leads, "na_fila");
        targets = keys.map((k) => [k, db.leads[k]]).filter(([, l]) => l && l.email && String(l.email).includes("@"));
      } else {
        const want = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids.map(Number)) : null;
        const lim = Math.min(30, Math.max(1, Number(body.limit) || 5));
        targets = Object.entries(db.leads || {})
          .filter(([, l]) => l.email && String(l.email).includes("@") && (want ? want.has(l.id) : (!l.emailCadence && l.state !== "fechado" && l.state !== "descartado")))
          .slice(0, want ? want.size : lim);
      }
      const results = [];
      for (const [k, l] of targets) {
        try {
          results.push(await sendLeadEmail(db, k, l, { step: body.step ? Number(body.step) : undefined, dryRun: !!body.dryRun }));
        } catch (e) {
          results.push({ ok: false, id: l.id, nome: l.nome, error: e.message });
        }
      }
      if (!body.dryRun && targets.length) {
        const updatedKeys = new Set(targets.map(([k]) => k));
        patchStatus((fresh) => {
          fresh.leads = fresh.leads || {};
          for (const k of updatedKeys) {
            if (!db.leads?.[k]) continue;
            if (!fresh.leads[k]) {
              fresh.leads[k] = db.leads[k];
            } else {
              if (db.leads[k].emailCadence) fresh.leads[k].emailCadence = db.leads[k].emailCadence;
              if (db.leads[k].siteAudit && !fresh.leads[k].siteAudit) fresh.leads[k].siteAudit = db.leads[k].siteAudit;
              if (db.leads[k].emailInvalido) {
                fresh.leads[k].emailInvalido = true;
                fresh.leads[k].motivoEmail = db.leads[k].motivoEmail;
              }
              if (db.leads[k].state === "enviado" && (!fresh.leads[k].state || fresh.leads[k].state === "mapeado" || fresh.leads[k].state === "na_fila")) {
                fresh.leads[k].state = "enviado";
                fresh.leads[k].sentAt = fresh.leads[k].sentAt || db.leads[k].sentAt;
              }
            }
          }
        });
      }
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
      if (!body.dryRun && results.some((r) => r.ok)) {
        const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
        patchStatus((fresh) => {
          for (const [k, l] of Object.entries(db.leads || {})) {
            if (!okIds.has(l.id) || !fresh.leads?.[k]) continue;
            if (l.emailCadence) fresh.leads[k].emailCadence = l.emailCadence;
            if (l.siteAudit && !fresh.leads[k].siteAudit) fresh.leads[k].siteAudit = l.siteAudit;
            if (l.state === "enviado" && (!fresh.leads[k].state || fresh.leads[k].state === "mapeado" || fresh.leads[k].state === "na_fila")) {
              fresh.leads[k].state = "enviado";
              fresh.leads[k].sentAt = fresh.leads[k].sentAt || l.sentAt;
            }
          }
        });
      }
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
        patchStatus((fresh) => {
          if (!fresh.leads?.[body.key]) return false;
          fresh.leads[body.key].siteAudit = audit;
          if (!fresh.leads[body.key].instagram && audit.instagram) {
            fresh.leads[body.key].instagram = audit.instagram;
            fresh.leads[body.key].instagramUrl = audit.instagramUrl;
          }
        });
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
      if (targets.length) {
        patchStatus((fresh) => {
          for (const [k, l] of targets) {
            if (!fresh.leads?.[k]) continue;
            fresh.leads[k].siteAudit = l.siteAudit;
            if (!fresh.leads[k].instagram && l.instagram) {
              fresh.leads[k].instagram = l.instagram;
              fresh.leads[k].instagramUrl = l.instagramUrl;
            }
          }
        });
      }
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
      patchStatus((fresh) => {
        if (!fresh.leads?.[body.key]) return false;
        fresh.leads[body.key].lighthouse = lighthouse;
      });
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

