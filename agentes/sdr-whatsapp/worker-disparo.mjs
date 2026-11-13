#!/usr/bin/env node
// worker-disparo.mjs — Disparo cadenciado da fila (WhatsApp Business via Evolution API)
// Uso:
//   node worker-disparo.mjs            (envia até MAX_POR_DIA leads em horário comercial)
//   node worker-disparo.mjs --dry-run  (simula sem enviar mensagens nem alterar status)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  loadEnv, loadStatus, saveStatus, normalizePhone, checkWhatsApp, qualificarLead,
  appendConversation, sendWhatsAppText, sendWhatsAppMedia, capturePreviewPng, callClaude,
  DAILY_LOG_PATH, sleep, randomBetween,
} from "./lib.mjs";
import { slugify } from "../entrega/previas/templates.mjs";

loadEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_HORARIO = process.argv.includes("--force-horario");
const keysArg = process.argv.find((a) => a.startsWith("--keys="));
const ONLY_KEYS = keysArg ? new Set(keysArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean)) : null;
const MAX_POR_DIA = parseInt(process.env.MAX_DISPAROS_DIA || "18", 10);
const DELAY_MIN_SEC = parseInt(process.env.DELAY_MIN_SEG || "180", 10); // 3 min
const DELAY_MAX_SEC = parseInt(process.env.DELAY_MAX_SEG || "420", 10); // 7 min
const USE_CLAUDE_ABERTURA = (process.env.USE_CLAUDE_ABERTURA || "true") === "true";
const PREVIEW_BASE_URL = (process.env.PREVIEW_BASE_URL || "").replace(/\/$/, "");

function previewUrlFor(lead) {
  if (!PREVIEW_BASE_URL) return "";
  return `${PREVIEW_BASE_URL}/${lead.id}-${slugify(lead.nome)}`;
}

function emHorarioComercial() {
  const tz = process.env.TZ || "America/Sao_Paulo";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const dia = now.getDay(); // 0=dom, 6=sab
  const hora = now.getHours();
  return dia >= 1 && dia <= 5 && hora >= 9 && hora < 18;
}

function getDisparosHoje() {
  const hoje = new Date().toLocaleDateString("pt-BR");
  if (!existsSync(DAILY_LOG_PATH)) return { data: hoje, count: 0 };
  const log = JSON.parse(readFileSync(DAILY_LOG_PATH, "utf8"));
  if (log.data !== hoje) return { data: hoje, count: 0 };
  return log;
}

function saveDisparosHoje(log) {
  writeFileSync(DAILY_LOG_PATH, JSON.stringify(log, null, 2), "utf8");
}

async function gerarMensagemAbertura(lead) {
  const qual = qualificarLead(lead);
  const previewUrl = qual.usarPrevia ? previewUrlFor(lead) : "";
  const fallbackMsg = previewUrl
    ? `${lead.msg}\n\nJá deixei a prévia no ar aqui para você dar uma olhada: ${previewUrl}`
    : lead.msg;

  if (!USE_CLAUDE_ABERTURA || !process.env.ANTHROPIC_API_KEY) {
    return fallbackMsg;
  }

  const system = `Você é William, consultor comercial da WiNS (agência digital em São Paulo especializada em Sites, Google/Meta Ads e Vídeos Curtos com IA).
Redija uma mensagem de abertura para WhatsApp curta, humana e direta (máximo 4 linhas).

REGRAS OBRIGATÓRIAS:
- SEMPRE se apresente logo na primeira frase como William (ex.: "Olá! Tudo bem? Me chamo William e trabalho com criação de sites e presença digital na WiNS."). NUNCA use colchetes ou placeholders como [Nome] ou [Agência].
- Use APENAS os fatos verificados abaixo. NUNCA invente dados, métricas ou diga que o site está fora do ar.
- Cite pelo menos 1 fato concreto do negócio (ex.: número de avaliações no Google ou cidade).
- Foque na oferta recomendada: ${qual.oferta} (${qual.sinal}).
- ${previewUrl ? `Inclua EXATAMENTE este link da prévia personalizada na mensagem: ${previewUrl}` : 'Termine com uma pergunta leve de sim/não (ex: "Faz sentido conversar?" ou "Posso te mostrar como funciona?").'}
- Sem emojis em excesso (no máximo 1 ou nenhum).`;

  const prompt = `FATOS VERIFICADOS DO LEAD:
${qual.fatos.map((f) => `- ${f}`).join("\n")}
${previewUrl ? `- Link da prévia pronta: ${previewUrl}\n` : ""}- Rascunho base de referência:
${lead.msg}`;

  const texto = await callClaude({
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 280,
  });
  return texto.trim() || fallbackMsg;
}

function diasDesde(dataBr) {
  if (!dataBr) return 0;
  const [d, m, y] = String(dataBr).split("/").map(Number);
  if (!d || !m || !y) return 0;
  return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000);
}

async function gerarMensagemFollowUp(lead) {
  const qual = qualificarLead(lead);
  const previewUrl = qual.usarPrevia ? previewUrlFor(lead) : "";
  const fallback = previewUrl
    ? `Oi! Passando só pra confirmar se conseguiu ver a prévia que montei pro ${lead.nome}: ${previewUrl}`
    : `Oi! Passando só pra saber se faz sentido conversarmos sobre ${qual.oferta.toLowerCase()} pro ${lead.nome}.`;

  if (!USE_CLAUDE_ABERTURA || !process.env.ANTHROPIC_API_KEY) return fallback;

  const system = `Você é um consultor comercial (SDR) no WhatsApp. Escreva um follow-up curto (máximo 2 linhas), educado e sem pressão, para um lead que recebeu a primeira mensagem há alguns dias e não respondeu.
- Mencione o nome da empresa (${lead.nome}).
- ${previewUrl ? `Inclua este link da prévia: ${previewUrl}` : "Pergunte de forma leve se ele conseguiu ver a mensagem anterior."}`;

  const texto = await callClaude({
    system,
    messages: [{ role: "user", content: `Gere o follow-up para ${lead.nome} (${lead.nicho}, ${lead.cidade}).` }],
    maxTokens: 160,
  });
  return texto.trim() || fallback;
}

async function main() {
  if (!FORCE_HORARIO && !DRY_RUN && !emHorarioComercial()) {
    console.log("⏸️ Fora do horário comercial (seg-sex 9h-18h). Use --force-horario para testar.");
    return;
  }

  const daily = getDisparosHoje();
  const restante = MAX_POR_DIA - daily.count;
  if (restante <= 0) {
    console.log(`🛑 Limite diário atingido (${daily.count}/${MAX_POR_DIA}).`);
    return;
  }

  const db = loadStatus();
  const todos = Object.entries(db.leads || {}).filter(([k]) => !ONLY_KEYS || ONLY_KEYS.has(k));
  const novos = todos
    .filter(([, l]) => l.state === "na_fila" && l.canal === "whatsapp" && normalizePhone(l.telefone))
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
    .map(([key, lead]) => ({ key, lead, tipo: "abertura" }));

  const followups = todos
    .filter(([, l]) => l.state === "enviado" && l.canal === "whatsapp" && (l.followup_count || 0) < 1 && diasDesde(l.emitido) >= 2 && normalizePhone(l.telefone))
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
    .map(([key, lead]) => ({ key, lead, tipo: "followup" }));

  const fila = [...novos, ...followups].slice(0, restante);

  if (fila.length === 0) {
    console.log(ONLY_KEYS
      ? "⚠️ Nenhum dos leads selecionados está com status 'na_fila' (mude o Status na coluna direita para 'na_fila' se quiser reenviar)."
      : "📭 Nenhum lead 'na_fila' ou para follow-up no status.json.");
    return;
  }

  console.log(`🚀 Iniciando lote: ${fila.length} lead(s) (${novos.length} novos, ${followups.length} follow-ups, restante hoje: ${restante}).${DRY_RUN ? " [DRY-RUN]" : ""}`);

  for (let i = 0; i < fila.length; i++) {
    const { key, lead, tipo } = fila[i];
    const phone = normalizePhone(lead.telefone);

    if (!DRY_RUN) {
      const waCheck = await checkWhatsApp(phone).catch(() => ({ exists: true }));
      if (!waCheck.exists) {
        console.log(`⏭️ [${i + 1}/${fila.length}] ${lead.nome} (${phone}) não tem WhatsApp — marcado como descartado.`);
        db.leads[key].state = "descartado";
        db.leads[key].motivo = "sem_whatsapp";
        saveStatus(db);
        continue;
      }
    }

    const texto = tipo === "followup"
      ? await gerarMensagemFollowUp(lead)
      : await gerarMensagemAbertura(lead);
    const usarPreviaImg = tipo === "abertura" && qualificarLead(lead).usarPrevia;

    console.log(`\n[${i + 1}/${fila.length}] [${tipo.toUpperCase()}] ${lead.nome} (${phone})${usarPreviaImg ? " [+IMG PRÉVIA]" : ""}`);
    console.log(`Mensagem:\n${texto}\n`);

    if (!DRY_RUN) {
      try {
        const pngPath = usarPreviaImg ? capturePreviewPng(lead) : null;
        if (pngPath) {
          await sendWhatsAppMedia(phone, pngPath, texto);
        } else {
          await sendWhatsAppText(phone, texto);
        }
        if (tipo === "followup") {
          db.leads[key].followup_count = (db.leads[key].followup_count || 0) + 1;
          db.leads[key].followup_em = new Date().toLocaleDateString("pt-BR");
        } else {
          db.leads[key].state = "enviado";
          db.leads[key].emitido = new Date().toLocaleDateString("pt-BR");
          db.leads[key].msg_enviada = texto;
        }
        saveStatus(db);

        appendConversation(phone, "assistant", texto);
        daily.count++;
        saveDisparosHoje(daily);
        console.log(`✅ Enviado (${daily.count}/${MAX_POR_DIA} hoje).`);
      } catch (err) {
        console.error(`❌ Erro ao enviar para ${lead.nome}:`, err.message);
      }

      if (i < fila.length - 1) {
        const waitSec = randomBetween(DELAY_MIN_SEC, DELAY_MAX_SEC);
        console.log(`⏳ Aguardando ${waitSec}s até o próximo envio...`);
        await sleep(waitSec * 1000);
      }
    }
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

