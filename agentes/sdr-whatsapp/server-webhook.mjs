#!/usr/bin/env node
// server-webhook.mjs — Recebe respostas do WhatsApp (Evolution API), conversa com Claude até o "Ok!" e faz handoff no Telegram

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEnv, loadStatus, saveStatus, patchStatus, findLeadByPhone, normalizePhone, qualificarLead,
  getConversation, appendConversation, sendWhatsAppText, fetchWhatsAppMediaBase64, transcribeAudioBase64,
  callClaude, notifyTelegram, logActivity,
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
  const isAudio = Boolean(msg?.audioMessage || msg?.pttMessage || data?.messageType === "audioMessage");
  const text =
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    "";

  if (!phone || (!text.trim() && !isAudio)) return null;
  return {
    messageId: String(data?.key?.id || ""),
    phone,
    text: text.trim(),
    isAudio,
    rawKey: isAudio ? data?.key : null,
    rawMessage: isAudio ? msg : null,
    pushName: data?.pushName || "",
  };
}

// Deduplicação por messageId + debounce/fila por telefone para evitar respostas duplicadas
const seenMessageIds = new Map();
const pendingByPhone = new Map();
const processingPhones = new Set();
const DEBOUNCE_MS = 3500;

function isDuplicateMessageId(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  if (seenMessageIds.size > 500) {
    for (const [id, ts] of seenMessageIds) {
      if (now - ts > 10 * 60 * 1000) seenMessageIds.delete(id);
    }
  }
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.set(messageId, now);
  return false;
}

function enqueueIncoming(incoming) {
  if (isDuplicateMessageId(incoming.messageId)) {
    console.log(`[DEDUP] Mensagem duplicada ${incoming.messageId} de ${incoming.phone} ignorada.`);
    return;
  }
  const phone = incoming.phone;
  const slot = pendingByPhone.get(phone) || { texts: [], audios: [], pushName: incoming.pushName, timer: null };
  if (incoming.text) slot.texts.push(incoming.text);
  if (incoming.isAudio) slot.audios.push({ rawKey: incoming.rawKey, rawMessage: incoming.rawMessage });
  if (incoming.pushName) slot.pushName = incoming.pushName;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => flushPhoneQueue(phone), DEBOUNCE_MS);
  pendingByPhone.set(phone, slot);
}

async function flushPhoneQueue(phone) {
  if (processingPhones.has(phone)) {
    const slot = pendingByPhone.get(phone);
    if (slot) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => flushPhoneQueue(phone), 1500);
    }
    return;
  }
  const slot = pendingByPhone.get(phone);
  if (!slot || (!slot.texts.length && !slot.audios.length)) return;
  pendingByPhone.delete(phone);

  const parts = [...slot.texts];
  let hasUntranscribedAudio = false;
  for (const aud of slot.audios) {
    try {
      const media = await fetchWhatsAppMediaBase64(aud.rawKey, aud.rawMessage);
      const transcript = media ? await transcribeAudioBase64(media.base64, media.mimetype) : null;
      if (transcript) {
        parts.push(`[Áudio transcrito]: ${transcript}`);
        logActivity("SDR", `🎤 Áudio transcrito (${phone}): "${transcript.slice(0, 70)}"`);
      } else {
        hasUntranscribedAudio = true;
      }
    } catch {
      hasUntranscribedAudio = true;
    }
  }

  const combinedText = parts.join("\n").trim();
  processingPhones.add(phone);
  try {
    await handleIncoming({ phone, text: combinedText, hasUntranscribedAudio, pushName: slot.pushName });
  } catch (err) {
    console.error(`Erro processando fila do telefone ${phone}:`, err);
  } finally {
    processingPhones.delete(phone);
    if (pendingByPhone.has(phone)) {
      const next = pendingByPhone.get(phone);
      if (next.timer) clearTimeout(next.timer);
      next.timer = setTimeout(() => flushPhoneQueue(phone), 1000);
    }
  }
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

  // Se recebeu apenas áudio sem chave de transcrição configurada, alerta no Telegram e responde educadamente
  if (!incoming.text && incoming.hasUntranscribedAudio) {
    patchStatus((fresh) => {
      if (!fresh.leads?.[key]) return false;
      if (["na_fila", "enviado", "visualizado"].includes(fresh.leads[key].state)) {
        fresh.leads[key].state = "respondeu";
      }
    });
    appendConversation(incoming.phone, "user", "[Áudio recebido no WhatsApp]");
    logActivity("SDR", `🎤 Áudio recebido de ${lead.nome} (${incoming.phone}) — alerta enviado ao Telegram.`);
    const waLink = `https://wa.me/${incoming.phone}`;
    await notifyTelegram(
      `🎤 *LEAD ENVIOU ÁUDIO NO WHATSAPP!*\n\n` +
      `🏢 Empresa: ${lead.nome}\n` +
      `🏷️ Nicho: ${lead.nicho} (${lead.cidade})\n` +
      `👉 Ouvir no WhatsApp: ${waLink}\n` +
      `_(Dica: adicione GROQ_API_KEY, OPENAI_API_KEY ou GEMINI_API_KEY no .env para transcrição automática)_`
    ).catch(() => {});
    const audioReply = "Oi! Recebi seu áudio — como estou em atendimento agora, vou ouvir assim que sair. Se preferir resumir em 1 linha por texto, já te respondo na hora!";
    await sendWhatsAppText(incoming.phone, audioReply);
    appendConversation(incoming.phone, "assistant", audioReply);
    return;
  }

  const emailMatch = String(incoming.text || "").match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const capturedEmail = emailMatch ? emailMatch[0].toLowerCase() : "";
  const needsStateChange = ["na_fila", "enviado", "visualizado"].includes(lead.state);
  if (needsStateChange || (capturedEmail && lead.email !== capturedEmail)) {
    patchStatus((fresh) => {
      if (!fresh.leads?.[key]) return false;
      if (["na_fila", "enviado", "visualizado"].includes(fresh.leads[key].state)) {
        fresh.leads[key].state = "respondeu";
      }
      if (capturedEmail && fresh.leads[key].email !== capturedEmail) {
        fresh.leads[key].email = capturedEmail;
        logActivity("SDR", `✉️ E-mail capturado no WhatsApp (${lead.nome}): ${capturedEmail}`);
      }
    });
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
    cacheSystem: true,
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
    patchStatus((fresh) => {
      if (!fresh.leads?.[key]) return false;
      fresh.leads[key].state = "proposto";
      fresh.leads[key].handoff = true;
    });
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
    patchStatus((fresh) => {
      if (!fresh.leads?.[key]) return false;
      fresh.leads[key].semInteresseWa = true;
      fresh.leads[key].state = "respondeu";
    });
    console.log(`[SEM INTERESSE WA] ${lead.nome} (mantido em respondeu).`);
  } else {
    let shouldNotify = false;
    if (parsed.interesse === true) {
      patchStatus((fresh) => {
        if (!fresh.leads?.[key] || fresh.leads[key].notificadoInteresse) return false;
        fresh.leads[key].notificadoInteresse = true;
        shouldNotify = true;
      });
    }
    if (shouldNotify) {
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
  try {
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
      const rawToken = req.url.slice("/previa/".length).split("?")[0];
      let token = rawToken;
      try { token = decodeURIComponent(rawToken); } catch {}
      token = token.replace(/\/$/, "");
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
        let views = 1;
        patchStatus((fresh) => {
          if (!fresh.leads?.[leadKey]) return false;
          views = (fresh.leads[leadKey].previewViews || 0) + 1;
          fresh.leads[leadKey].previewViews = views;
          fresh.leads[leadKey].previewLastViewedAt = nowIso;
        });
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

    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true }));

      try {
        const payload = JSON.parse(body || "{}");
        const incoming = extractIncoming(payload);
        if (incoming) enqueueIncoming(incoming);
      } catch (err) {
        console.error("Erro processando webhook:", err);
      }
    });
  } catch (err) {
    console.error("Erro HTTP não tratado em server-webhook:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    }
  }
});

async function runEmailMaintenance() {
  try {
    const db = loadStatus();
    const replies = await checkInboxReplies(db).catch(() => []);
    if (replies.length) {
      patchStatus((fresh) => {
        for (const r of replies) {
          const src = db.leads?.[r.key];
          if (src && fresh.leads?.[r.key]) {
            fresh.leads[r.key].emailRepliedAt = src.emailRepliedAt;
            fresh.leads[r.key].respondedVia = src.respondedVia;
            if (fresh.leads[r.key].state !== "fechado" && fresh.leads[r.key].state !== "descartado") {
              fresh.leads[r.key].state = "respondeu";
            }
            if (fresh.leads[r.key].emailCadence) fresh.leads[r.key].emailCadence.nextDueAt = null;
          }
        }
      });
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
      const dbCad = loadStatus();
      const sent = await runDueEmailCadence(dbCad, { limit: 10, dryRun: false }).catch(() => []);
      const okItems = sent.filter((x) => x.ok);
      if (okItems.length) {
        const okIds = new Set(okItems.map((x) => x.id));
        patchStatus((fresh) => {
          for (const [k, l] of Object.entries(dbCad.leads || {})) {
            if (okIds.has(l.id) && fresh.leads?.[k]) {
              fresh.leads[k].emailCadence = l.emailCadence;
              if (l.siteAudit && !fresh.leads[k].siteAudit) fresh.leads[k].siteAudit = l.siteAudit;
              if (!fresh.leads[k].state || fresh.leads[k].state === "mapeado" || fresh.leads[k].state === "na_fila") {
                fresh.leads[k].state = "enviado";
              }
            }
          }
        });
        logActivity("Email-Cadence", `✉️ Follow-up automático D+3/D+7 enviado para ${okItems.length} lead(s).`);
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

