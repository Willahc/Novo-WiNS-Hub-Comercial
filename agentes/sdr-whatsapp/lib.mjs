// lib.mjs — Utilitários compartilhados do agente na VPS (Node 18+, zero dependências)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = __dirname;
export const STATUS_PATH = resolve(__dirname, "..", "prospeccao", "status.json");
export const CONVERSAS_DIR = resolve(__dirname, "conversas");
export const DAILY_LOG_PATH = resolve(__dirname, "disparos-hoje.json");

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

  return {
    oferta: "Google/Meta Ads + Vídeos Curtos com IA",
    sinal: "Já possui site próprio; oportunidade de escalar clientes com anúncios e vídeos curtos.",
    usarPrevia: false,
    fatos: [
      `Empresa: ${lead.nome}`,
      `Nicho: ${lead.nicho}`,
      `Cidade: ${lead.cidade}`,
      avaliacoes > 0 ? `Avaliações no Google Maps: ${avaliacoes}` : null,
      `Site atual: ${site}`,
    ].filter(Boolean),
  };
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
    throw new Error(`Claude API erro ${res.status}: ${body}`);
  }
  const data = await res.json();
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

