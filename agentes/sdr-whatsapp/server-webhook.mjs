#!/usr/bin/env node
// server-webhook.mjs — Recebe respostas do WhatsApp (Evolution API), conversa com Claude até o "Ok!" e faz handoff no Telegram

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEnv, loadStatus, saveStatus, findLeadByPhone, normalizePhone, qualificarLead,
  getConversation, appendConversation, sendWhatsAppText, callClaude, notifyTelegram, logActivity,
} from "./lib.mjs";
import { renderPreviewHtml, slugify, detectNiche } from "../entrega/previas/templates.mjs";
import { handleCrmRequest } from "./crm.mjs";
import { handleAuthRequest } from "./auth.mjs";
import { startTelegramBot } from "./telegram-bot.mjs";
import { checkInboxReplies, runDueEmailCadence } from "./email.mjs";

loadEnv();

const PORT = parseInt(process.env.WEBHOOK_PORT || "3005", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const SYSTEM_PROMPT = `Você é William, da WiNS Hub Comercial (agência digital em São Paulo especializada em:
1. Criação de sites rápidos e profissionais (focados em gerar contato no WhatsApp e aparecer no Google)
2. Gestão de anúncios (Google Ads e Meta Ads para negócios locais)
3. Vídeos curtos com IA para redes sociais e anúncios)

NUNCA invente outro nome ou use placeholders como [Nome] ou [Agência]. Seu nome é SEMPRE William e a empresa é SEMPRE WiNS Hub Comercial.

Seu ÚNICO objetivo na conversa é qualificar o interesse e levar o cliente até o "Ok!" (ele aceitar ver valores/proposta ou conversar para fechar).

REGRAS CRÍTICAS:
- NUNCA passe preços fechados, pacotes ou chave Pix. Quando o cliente perguntar valor ou disser "ok / quero saber mais / pode mandar", faça o HANDOFF imediatamente para o responsável humano entrar e fechar.
- Seja natural, curto e educado (mensagens de 1 a 3 frases, estilo WhatsApp real, sem textão).
- Só responda sobre o que o lead perguntar.
- Se o cliente pedir para não mandar mais mensagem ou disser claramente que não tem interesse, faça DESCARTAR com uma despedida educada de 1 linha.

Responda EXCLUSIVAMENTE em JSON válido, sem markdown ao redor:
{
  "acao": "responder" | "handoff" | "descartar",
  "interesse": true | false,
  "motivo_interesse": "explicação curta do porquê demonstrou interesse ou precisa do humano (vazio se interesse=false)",
  "resposta": "mensagem curta para enviar no WhatsApp",
  "resumo_handoff": "resumo do que o cliente quer (site, ads, vídeo) e por que deu Ok (preencher só se acao=handoff)"
}

Critério para "interesse":
- true: cliente perguntou preço/como funciona/prazos, comentou positivamente a prévia, pediu para conversar, ou fez pergunta que precisa de atenção humana.
- false: apenas saudação automática ("Olá, como posso ajudar?"), resposta vaga/fria ou recusa.`;

function extractIncoming(payload) {
  // Suporta payload padrão da Evolution API v2 (evento messages.upsert)
  const event = payload?.event;
  if (event && event !== "messages.upsert") return null;

  const data = payload?.data;
  if (!data || data?.key?.fromMe) return null;

  const jid = data?.key?.remoteJid || "";
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return null;

  const phone = normalizePhone(jid.split("@")[0]);
  const msg = data?.message;
  const text =
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    "";

  if (!phone || !text.trim()) return null;
  return { phone, text: text.trim(), pushName: data?.pushName || "" };
}

async function handleIncoming(incoming) {
  const db = loadStatus();
  const match = findLeadByPhone(db, incoming.phone);

  // REGRA DE OURO: Só responde números que estão na nossa base de prospecção (status.json).
  // Conversas pessoais ou clientes antigos no mesmo WhatsApp Business são 100% ignorados pela IA.
  if (!match) {
    console.log(`[IGNORADO] Mensagem de ${incoming.phone} não está em status.json.`);
    return;
  }

  const { key, lead } = match;
  if (lead.handoff || ["proposto", "fechado", "descartado"].includes(lead.state)) {
    console.log(`[PAUSADO] ${lead.nome} (${incoming.phone}) está em estado '${lead.state}' — humano no controle.`);
    return;
  }

  if (["na_fila", "enviado", "visualizado"].includes(lead.state)) {
    db.leads[key].state = "respondeu";
    saveStatus(db);
  }

  const emailMatch = String(incoming.text || "").match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    const capturedEmail = emailMatch[0].toLowerCase();
    if (db.leads[key].email !== capturedEmail) {
      db.leads[key].email = capturedEmail;
      saveStatus(db);
      logActivity("SDR", `✉️ E-mail capturado no WhatsApp (${lead.nome}): ${capturedEmail}`);
    }
  }

  const history = appendConversation(incoming.phone, "user", incoming.text);
  logActivity("SDR", `📩 ${lead.nome}: "${incoming.text.slice(0, 70).replace(/\s+/g, " ")}"`);
  const claudeMessages = history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const qual = qualificarLead(lead);
  const contextSystem = `${SYSTEM_PROMPT}\n\nFATOS VERIFICADOS DO LEAD (NUNCA invente além disto):\n${qual.fatos.map((f) => `- ${f}`).join("\n")}\n- Oferta principal recomendada: ${qual.oferta} (${qual.sinal})`;

  const rawReply = await callClaude({
    system: contextSystem,
    messages: claudeMessages,
    maxTokens: 350,
  });

  let parsed;
  try {
    const start = rawReply.indexOf("{");
    const end = rawReply.lastIndexOf("}");
    parsed = JSON.parse(rawReply.slice(start, end + 1));
  } catch {
    parsed = { acao: "responder", interesse: false, motivo_interesse: "", resposta: rawReply.trim(), resumo_handoff: "" };
  }

  if (parsed.resposta) {
    await sendWhatsAppText(incoming.phone, parsed.resposta);
    appendConversation(incoming.phone, "assistant", parsed.resposta);
    logActivity("SDR", `🤖 Respondeu ${lead.nome}: "${parsed.resposta.slice(0, 70).replace(/\s+/g, " ")}"`);
  }

  if (parsed.acao === "handoff") {
    db.leads[key].state = "proposto";
    db.leads[key].handoff = true;
    saveStatus(db);
    logActivity("SDR", `🔥 HANDOFF (Ok!) — ${lead.nome} (${incoming.phone})`);

    const waLink = `https://wa.me/${incoming.phone}`;
    const alerta =
      `🔥 LEAD DEU "OK!" — HORA DE FECHAR!\n\n` +
      `🏢 Empresa: ${lead.nome}\n` +
      `🏷️ Nicho: ${lead.nicho} (${lead.cidade})\n` +
      `🌐 Site: ${lead.temSite ? lead.site : "Sem site"}\n` +
      `📝 Resumo: ${parsed.resumo_handoff || incoming.text}\n\n` +
      `👉 Abrir conversa: ${waLink}`;
    await notifyTelegram(alerta);
    console.log(`[HANDOFF] ${lead.nome} transferido para o humano.`);
  } else if (parsed.acao === "descartar") {
    db.leads[key].semInteresseWa = true;
    db.leads[key].state = "respondeu";
    saveStatus(db);
    console.log(`[SEM INTERESSE WA] ${lead.nome} (mantido em respondeu).`);
  } else {
    if (parsed.interesse === true && !db.leads[key].notificadoInteresse) {
      db.leads[key].notificadoInteresse = true;
      saveStatus(db);
      logActivity("SDR", `🔔 Interesse detectado — ${lead.nome} (${incoming.phone})`);
      const waLink = `https://wa.me/${incoming.phone}`;
      const alerta =
        `🔔 LEAD DEMONSTROU INTERESSE — SUA VEZ!\n\n` +
        `🏢 Empresa: ${lead.nome}\n` +
        `🏷️ Nicho: ${lead.nicho} (${lead.cidade})\n` +
        `💬 Cliente disse: "${incoming.text.slice(0, 220)}"\n` +
        `🧠 Motivo: ${parsed.motivo_interesse || "Demonstrou interesse / pediu detalhes"}\n` +
        `🤖 IA respondeu: "${(parsed.resposta || "").slice(0, 220)}"\n\n` +
        `👉 Abrir WhatsApp: ${waLink}`;
      await notifyTelegram(alerta);
    }
    console.log(`[RESPONDIDO] ${lead.nome}: ${parsed.resposta}`);
  }
}

const server = http.createServer(async (req, res) => {
  if (await handleAuthRequest(req, res)) return;
  if (await handleCrmRequest(req, res)) return;

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/previas") {
    const db = loadStatus();
    const items = Object.values(db.leads || {})
      .sort((a, b) => (a.id || 0) - (b.id || 0))
      .map((l) => {
        const slug = `${l.id}-${slugify(l.nome)}`;
        return `<li><a href="/previa/${slug}">[${detectNiche(l.nicho)}] #${l.id} ${l.nome}</a> — ${l.nicho} (${l.cidade})</li>`;
      })
      .join("\n");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prévias WiNS Hub</title><style>body{font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 16px;line-height:1.7}a{color:#0f766e;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}</style></head><body><h1>Prévias por Nicho — WiNS Hub Comercial</h1><ul>${items}</ul></body></html>`);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/previa/")) {
    const token = decodeURIComponent(req.url.slice("/previa/".length).split("?")[0]).replace(/\/$/, "");
    const db = loadStatus();
    const idPrefix = parseInt(token, 10);
    const match = Object.entries(db.leads || {}).find(
      ([, l]) => `${l.id}-${slugify(l.nome)}` === token || slugify(l.nome) === token || (!Number.isNaN(idPrefix) && l.id === idPrefix)
    );
    const leadKey = match?.[0];
    const lead = match?.[1];
    if (!lead) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Prévia não encontrada");
      return;
    }

    const ua = String(req.headers["user-agent"] || "");
    const isBot = /whatsapp|facebookexternalhit|telegrambot|googlebot|headlesschrome|curl|wget|python|node/i.test(ua);
    if (!isBot && leadKey) {
      const nowIso = new Date().toISOString();
      const prevAt = lead.previewLastViewedAt ? new Date(lead.previewLastViewedAt).getTime() : 0;
      const views = (lead.previewViews || 0) + 1;
      db.leads[leadKey].previewViews = views;
      db.leads[leadKey].previewLastViewedAt = nowIso;
      saveStatus(db);
      logActivity("PREVIA", `👀 ${lead.nome} (#${lead.id}) abriu a prévia (${views}x)`);
      if (views === 1 || Date.now() - prevAt > 30 * 60 * 1000) {
        notifyTelegram(`👀 *Prévia visualizada!*\n*Empresa:* ${lead.nome} (#${lead.id})\n*Acessos:* ${views}x\n*Tel:* ${lead.telefone || "-"}\n*E-mail:* ${lead.email || "-"}`).catch(() => {});
      }
    }

    const slug = slugify(lead.nome);
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const customFile = path.join(rootDir, "agentes", "entrega", "previas", "geradas", slug, "index.html");
    const html = fs.existsSync(customFile) ? fs.readFileSync(customFile, "utf8") : renderPreviewHtml(lead);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method !== "POST" || !req.url?.startsWith("/webhook/whatsapp")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (WEBHOOK_SECRET && req.headers["x-webhook-secret"] !== WEBHOOK_SECRET) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });

  req.on("end", async () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));

    try {
      const payload = JSON.parse(body || "{}");
      const incoming = extractIncoming(payload);
      if (incoming) await handleIncoming(incoming);
    } catch (err) {
      console.error("Erro processando webhook:", err);
    }
  });
});

async function runEmailMaintenance() {
  try {
    const db = loadStatus();
    const replies = await checkInboxReplies(db).catch(() => []);
    if (replies.length) {
      saveStatus(db);
      for (const r of replies) {
        logActivity("Email-IMAP", `📩 Resposta detectada de ${r.nome} (${r.email}) — cadência pausada.`);
        await notifyTelegram(`📩 *Resposta por E-mail!*\n*Empresa:* ${r.nome} (#${r.id})\n*E-mail:* ${r.email}\n_Cadência automática pausada._`).catch(() => {});
      }
    }

    const tz = process.env.TZ || "America/Sao_Paulo";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const dia = now.getDay();
    const hora = now.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 9 && hora < 18) {
      const sent = await runDueEmailCadence(db, { limit: 10, dryRun: false }).catch(() => []);
      if (sent.some((x) => x.ok)) {
        saveStatus(db);
        const okCount = sent.filter((x) => x.ok).length;
        logActivity("Email-Cadence", `✉️ Follow-up automático D+3/D+7 enviado para ${okCount} lead(s).`);
      }
    }
  } catch (err) {
    console.error("Erro na manutenção de e-mail:", err.message);
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🤖 Webhook do agente ouvindo em http://0.0.0.0:${PORT}/webhook/whatsapp`);
  startTelegramBot();
  setTimeout(runEmailMaintenance, 30_000);
  setInterval(runEmailMaintenance, 15 * 60 * 1000);
});

