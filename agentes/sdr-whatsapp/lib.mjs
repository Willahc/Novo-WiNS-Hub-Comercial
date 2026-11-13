// lib.mjs — Utilitários compartilhados do agente na VPS (Node 18+, zero dependências)
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify, renderPreviewHtml } from "../entrega/previas/templates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = __dirname;
export const STATUS_PATH = resolve(__dirname, "..", "prospeccao", "status.json");
export const CONVERSAS_DIR = resolve(__dirname, "conversas");
export const DAILY_LOG_PATH = resolve(__dirname, "disparos-hoje.json");
export const ACTIVITY_LOG_PATH = resolve(__dirname, "..", "prospeccao", "activity.log");
export const ANTHROPIC_USAGE_PATH = resolve(__dirname, "..", "prospeccao", "anthropic-usage.json");

export function logActivity(agent, msg) {
  try {
    const stamp = new Date().toLocaleTimeString("pt-BR", { timeZone: process.env.TZ || "America/Sao_Paulo" });
    const lines = String(msg || "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return;
    const block = lines.map((l) => `[${stamp}] [${agent}] ${l}`).join("\n") + "\n";
    appendFileSync(ACTIVITY_LOG_PATH, block, "utf8");
  } catch {}
}

export function readActivity(limit = 80) {
  if (!existsSync(ACTIVITY_LOG_PATH)) return [];
  try {
    const lines = readFileSync(ACTIVITY_LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

export async function getEvolutionState() {
  const url = process.env.EVOLUTION_API_URL || "http://127.0.0.1:8081";
  const key = process.env.EVOLUTION_API_KEY || "";
  const inst = process.env.EVOLUTION_INSTANCE || "wins-comercial";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/instance/connectionState/${inst}`, {
      signal: ctrl.signal,
      headers: key ? { apikey: key } : {},
    });
    clearTimeout(t);
    if (!res.ok) return "offline";
    const d = await res.json();
    return d?.instance?.state || d?.state || "unknown";
  } catch {
    clearTimeout(t);
    return "offline";
  }
}

export function loadEnv() {
  const envPath = resolve(__dirname, ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function loadStatus() {
  if (!existsSync(STATUS_PATH)) {
    return { leads: {}, aprendizado: { nichos: {}, canais: {}, site: {} } };
  }
  const raw = JSON.parse(readFileSync(STATUS_PATH, "utf8"));
  if (raw && typeof raw === "object" && "leads" in raw) return raw;
  return { leads: raw || {}, aprendizado: { nichos: {}, canais: {}, site: {} } };
}

export function saveStatus(db) {
  writeFileSync(STATUS_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function findLeadByPhone(db, phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  for (const [key, lead] of Object.entries(db.leads || {})) {
    const leadPhone = normalizePhone(lead.telefone);
    if (!leadPhone) continue;
    // Compara últimos 8 dígitos também para lidar com 9º dígito no WhatsApp
    if (leadPhone === target || leadPhone.slice(-8) === target.slice(-8)) {
      return { key, lead };
    }
  }
  return null;
}

export function getConversation(phone) {
  mkdirSync(CONVERSAS_DIR, { recursive: true });
  const file = resolve(CONVERSAS_DIR, `${normalizePhone(phone)}.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8"));
}

export function appendConversation(phone, role, content) {
  mkdirSync(CONVERSAS_DIR, { recursive: true });
  const norm = normalizePhone(phone);
  const file = resolve(CONVERSAS_DIR, `${norm}.json`);
  const history = getConversation(norm);
  history.push({ role, content, at: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(history, null, 2), "utf8");
  return history;
}

export async function sendWhatsAppText(phone, text) {
  const baseUrl = (process.env.EVOLUTION_URL || "http://127.0.0.1:8081").replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || "wins-comercial";
  if (!apiKey) throw new Error("EVOLUTION_API_KEY não configurada no .env");

  const number = normalizePhone(phone);
  const res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      number,
      text,
      delay: 1200,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution API erro ${res.status}: ${body}`);
  }
  return res.json();
}

export async function sendWhatsAppMedia(phone, filePath, caption = "") {
  const baseUrl = (process.env.EVOLUTION_URL || "http://127.0.0.1:8081").replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || "wins-comercial";
  if (!apiKey) throw new Error("EVOLUTION_API_KEY não configurada no .env");

  const number = normalizePhone(phone);
  const media = readFileSync(filePath).toString("base64");
  const res = await fetch(`${baseUrl}/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      number,
      mediatype: "image",
      mimetype: "image/png",
      caption,
      media,
      fileName: "previa-site.png",
      delay: 1200,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution API sendMedia erro ${res.status}: ${body}`);
  }
  return res.json();
}

export function capturePreviewPng(lead) {
  const slug = slugify(lead?.nome || lead?.key || "previa") || "previa";
  const dir = resolve(__dirname, "..", "entrega", "previas", "geradas", slug);
  mkdirSync(dir, { recursive: true });
  const htmlPath = resolve(dir, "index.html");
  if (!existsSync(htmlPath)) {
    writeFileSync(htmlPath, renderPreviewHtml(lead), "utf8");
  }
  const pngPath = resolve(dir, "preview.png");
  if (existsSync(pngPath) && statSync(pngPath).size > 1000) {
    return pngPath;
  }

  const container = process.env.CHROME_CONTAINER || "deploy-winshub-1";
  const chromeBin = process.env.CHROME_BIN || "/opt/browsers/chromium-1228/chrome-linux64/chrome";
  const tmpHtml = `/tmp/previa-${slug}.html`;
  const tmpPng = `/tmp/previa-${slug}.png`;
  try {
    execFileSync("docker", ["cp", htmlPath, `${container}:${tmpHtml}`], { stdio: "ignore", timeout: 10000 });
    execFileSync(
      "docker",
      [
        "exec",
        container,
        chromeBin,
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--window-size=1280,800",
        "--virtual-time-budget=2500",
        `--screenshot=${tmpPng}`,
        `file://${tmpHtml}`,
      ],
      { stdio: "ignore", timeout: 25000 }
    );
    execFileSync("docker", ["cp", `${container}:${tmpPng}`, pngPath], { stdio: "ignore", timeout: 10000 });
    execFileSync("docker", ["exec", container, "rm", "-f", tmpHtml, tmpPng], { stdio: "ignore", timeout: 5000 });
    return existsSync(pngPath) && statSync(pngPath).size > 1000 ? pngPath : null;
  } catch {
    try {
      execFileSync("docker", ["exec", container, "rm", "-f", tmpHtml, tmpPng], { stdio: "ignore", timeout: 5000 });
    } catch {}
    return null;
  }
}

export async function checkWhatsApp(phone) {
  const baseUrl = (process.env.EVOLUTION_URL || "http://127.0.0.1:8081").replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || "wins-comercial";
  const number = normalizePhone(phone);
  if (!apiKey || !number) return { exists: true, number };

  const res = await fetch(`${baseUrl}/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ numbers: [number] }),
  });
  if (!res.ok) return { exists: true, number };
  const arr = await res.json().catch(() => []);
  const hit = Array.isArray(arr) ? arr[0] : null;
  return hit ? { exists: !!hit.exists, number: hit.number || number } : { exists: true, number };
}

export function qualificarLead(lead) {
  const site = String(lead?.site || "").trim();
  const isSocialOnly = /instagram\.com|facebook\.com|linktr\.ee|wa\.me|tiktok\.com/i.test(site);
  const avaliacoes = Number(lead?.avaliacoes || 0);

  if (!lead?.temSite || !site) {
    return {
      oferta: "Site Profissional + Google",
      sinal: "Empresa bem avaliada no Google Maps, mas sem site próprio.",
      usarPrevia: true,
      fatos: [
        `Empresa: ${lead?.nome || ""}`,
        `Nicho: ${lead?.nicho || ""}`,
        `Cidade: ${lead?.cidade || ""}`,
        avaliacoes > 0 ? `Avaliações no Google Maps: ${avaliacoes}` : null,
        "Site: Não possui site próprio",
      ].filter(Boolean),
    };
  }

  if (isSocialOnly) {
    return {
      oferta: "Site + Vídeos Curtos com IA",
      sinal: "Usa apenas rede social como link, perdendo buscas no Google.",
      usarPrevia: true,
      fatos: [
        `Empresa: ${lead.nome}`,
        `Nicho: ${lead.nicho}`,
        `Cidade: ${lead.cidade}`,
        avaliacoes > 0 ? `Avaliações no Google Maps: ${avaliacoes}` : null,
        `Presença atual: Apenas rede social (${site})`,
      ].filter(Boolean),
    };
  }

  const a = lead?.siteAudit;
  const lh = lead?.lighthouse;
  const auditFatos = [
    a ? `Nota técnica do site: ${a.score}/100 (Segurança ${a.securityScore}/100)` : null,
    lh?.perf != null ? `Google Lighthouse: Performance ${lh.perf}/100 · SEO ${lh.seo ?? "-"}/100` : null,
    a?.stack?.length ? `Tecnologia detectada: ${a.stack.join(", ")}` : null,
    a ? `Pixels/Rastreamento: ${a.pixels?.length ? a.pixels.join(", ") : "Nenhum pixel de anúncio detectado"}` : null,
    a?.empresaInfo?.socios?.length ? `Sócios (CNPJ): ${a.empresaInfo.socios.join(", ")}` : null,
  ].filter(Boolean);

  const highVolume = avaliacoes >= 50;
  const weakSite = a && a.score < 65;
  const isB2B = /\b(b2b|ag[eê]ncia|contabilidade|contador|consultoria|energia\s*solar|distribuidora|fornecedor|gr[aá]fica|software|tecnologia|imobili[aá]ria|engenharia|log[ií]stica|marketing|atacado)\b/i.test(`${lead?.nicho || ""} ${lead?.nome || ""}`);

  let oferta = "Google/Meta Ads + Vídeos Curtos com IA";
  let sinal = "Já possui site próprio; oportunidade de escalar clientes com anúncios e vídeos curtos (e organizar o WhatsApp).";

  if (isB2B && !weakSite) {
    oferta = "Máquina de Prospecção (Google Maps) + CRM Autônomo com IA";
    sinal = "Empresa B2B com site ativo; alto potencial para implantar prospecção automática no Google Maps + CRM Autônomo com SDR de IA no WhatsApp para gerar reuniões diárias.";
    auditFatos.push("Oferta B2B High-Ticket: Extrator de empresas (Google Maps) + CRM Autônomo + SDR com IA no WhatsApp + avisos de interesse no Telegram");
  } else if (highVolume && !weakSite) {
    oferta = "Central WhatsApp Multi-Atendente + Agendamento & Automação";
    sinal = `Empresa consolidada (${avaliacoes} avaliações no Google) e site ativo; dor principal costuma ser demora no WhatsApp, agendamentos manuais e falta de pós-venda/NPS automático.`;
    auditFatos.push("Oferta recorrente indicada: Central WhatsApp Multi-Atendente (Chatwoot/Evolution) + Bot de Triagem + Agendamento/Lembrete & NPS automático");
  } else if (weakSite) {
    oferta = "Redesign de Site Profissional + Central WhatsApp";
    sinal = `Site atual com nota técnica baixa (${a.score}/100); oportunidade de refazer com foco em conversão e integrar atendimento organizado no WhatsApp.`;
  }

  return {
    oferta,
    sinal,
    usarPrevia: false,
    fatos: [
      `Empresa: ${lead.nome}`,
      `Nicho: ${lead.nicho}`,
      `Cidade: ${lead.cidade}`,
      avaliacoes > 0 ? `Avaliações no Google Maps: ${avaliacoes}` : null,
      `Site atual: ${site}`,
      ...auditFatos,
    ].filter(Boolean),
  };
}

function estimateClaudeCostUsd(model, inTok, outTok) {
  const m = String(model || "").toLowerCase();
  const [inRate, outRate] = m.includes("haiku") ? [0.8, 4.0] : m.includes("opus") ? [15.0, 75.0] : [3.0, 15.0];
  return (inTok / 1e6) * inRate + (outTok / 1e6) * outRate;
}

export function getAnthropicUsage() {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const empty = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const def = { data: hoje, today: { ...empty }, total: { ...empty }, model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514", lastCallAt: null, lastError: "" };
  if (!existsSync(ANTHROPIC_USAGE_PATH)) return def;
  try {
    const raw = JSON.parse(readFileSync(ANTHROPIC_USAGE_PATH, "utf8"));
    return {
      ...def,
      ...raw,
      today: raw.data === hoje ? { ...empty, ...raw.today } : { ...empty },
      total: { ...empty, ...raw.total },
    };
  } catch {
    return def;
  }
}

function recordAnthropicUsage({ model, inputTokens = 0, outputTokens = 0, error = "" }) {
  try {
    const hoje = new Date().toLocaleDateString("pt-BR");
    const u = getAnthropicUsage();
    u.data = hoje;
    u.model = model || u.model;
    u.lastCallAt = new Date().toISOString();
    u.lastError = error || "";
    if (!error) {
      const cost = estimateClaudeCostUsd(u.model, inputTokens, outputTokens);
      u.today.calls += 1;
      u.today.inputTokens += inputTokens;
      u.today.outputTokens += outputTokens;
      u.today.costUsd = Number((u.today.costUsd + cost).toFixed(6));
      u.total.calls += 1;
      u.total.inputTokens += inputTokens;
      u.total.outputTokens += outputTokens;
      u.total.costUsd = Number((u.total.costUsd + cost).toFixed(6));
      logActivity("Claude", `🧠 ${inputTokens} in / ${outputTokens} out (~US$ ${cost.toFixed(4)})`);
    } else {
      logActivity("Claude", `⚠️ Erro API: ${error.slice(0, 100)}`);
    }
    writeFileSync(ANTHROPIC_USAGE_PATH, JSON.stringify(u, null, 2), "utf8");
  } catch {}
}

export async function callClaude({ system, messages, maxTokens = 450 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada no .env");
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    recordAnthropicUsage({ model, error: `HTTP ${res.status}: ${body}` });
    throw new Error(`Claude API erro ${res.status}: ${body}`);
  }
  const data = await res.json();
  recordAnthropicUsage({
    model: data.model || model,
    inputTokens: Number(data.usage?.input_tokens || 0),
    outputTokens: Number(data.usage?.output_tokens || 0),
  });
  return data.content?.map((c) => c.text || "").join("") || "";
}

export async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM não configurado] Alerta:", text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.error("Falha ao enviar alerta Telegram:", await res.text());
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

