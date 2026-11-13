// telegram-bot.mjs — Bot de comando remoto no Telegram (Chefe de Gabinete + Status + Simulação)
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInboxReport } from "./chefe-gabinete.mjs";
import { loadStatus, saveStatus, getEvolutionState, getAnthropicUsage, callClaude, notifyTelegram, logActivity, sleep } from "./lib.mjs";
import { auditSite } from "../prospeccao/site-audit.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function handleCommand(cmdRaw) {
  const cmd = cmdRaw.trim().toLowerCase().split(/\s+/)[0];

  if (cmd === "/start" || cmd === "/ajuda" || cmd === "/help") {
    return [
      "🤖 Comandos do WiNS Hub:",
      "/inbox — Chefe de Gabinete (handoffs, funil e RH dos bots)",
      "/status — Saúde ao vivo (WhatsApp, Painel, Claude e fila)",
      "/simular — Simula os próximos disparos (dry-run)",
      "/auditar — Audita até 5 sites ainda não analisados",
    ].join("\n");
  }

  if (cmd === "/inbox" || cmd === "/resumo") {
    const rep = await buildInboxReport();
    return rep.replace(/\*/g, "");
  }

  if (cmd === "/status") {
    const evo = await getEvolutionState();
    const claude = getAnthropicUsage();
    const db = loadStatus();
    const naFila = Object.values(db.leads || {}).filter((l) => l.state === "na_fila").length;
    return [
      "📡 Status WiNS Hub",
      `• Evolution WhatsApp: ${evo === "open" ? "Conectado (open)" : evo}`,
      `• Leads na fila: ${naFila}`,
      `• Claude hoje: ${claude.today.calls} reqs · US$ ${Number(claude.today.costUsd || 0).toFixed(3)}`,
      `• Painel: https://winshubcomercial.com.br`,
    ].join("\n");
  }

  if (cmd === "/simular") {
    const { stdout } = await execFileAsync(process.execPath, [resolve(__dirname, "worker-disparo.mjs"), "--dry-run", "--force-horario"], { cwd: __dirname });
    return `🧪 Simulação:\n${stdout.trim().slice(-1500) || "Nenhum lead na fila."}`;
  }

  if (cmd === "/auditar") {
    const db = loadStatus();
    const targets = Object.entries(db.leads || {})
      .filter(([, l]) => l.temSite && l.site && !/instagram\.com|facebook\.com/i.test(l.site) && !l.siteAudit)
      .slice(0, 5);
    if (!targets.length) return "✅ Todos os leads com site já foram auditados.";
    const lines = [];
    for (const [, l] of targets) {
      const a = await auditSite(l.site, l.nome);
      l.siteAudit = a;
      if (!l.instagram && a.instagram) { l.instagram = a.instagram; l.instagramUrl = a.instagramUrl; }
      lines.push(`• ${l.nome}: ${a.score}/100 (Seg ${a.securityScore} · Qual ${a.qualityScore})`);
    }
    saveStatus(db);
    logActivity("Telegram", `🔍 Auditou ${targets.length} sites via comando /auditar`);
    return `🔍 Sites auditados:\n${lines.join("\n")}`;
  }

  return "Comando não reconhecido. Use /ajuda para ver os comandos.";
}

const TG_HISTORY_PATH = resolve(__dirname, "tg-history.json");
const tgHistory = (() => {
  try {
    if (existsSync(TG_HISTORY_PATH)) {
      const arr = JSON.parse(readFileSync(TG_HISTORY_PATH, "utf8"));
      return Array.isArray(arr) ? arr.slice(-12) : [];
    }
  } catch {}
  return [];
})();

function saveTgHistory() {
  try { writeFileSync(TG_HISTORY_PATH, JSON.stringify(tgHistory.slice(-12), null, 2)); } catch {}
}

function buildAgentContext() {
  const db = loadStatus();
  const leads = Object.entries(db.leads || {}).map(([key, l]) => ({
    key,
    id: l.id,
    nome: l.nome,
    nicho: l.nicho,
    cidade: l.cidade,
    nota: l.nota || 0,
    avaliacoes: l.avaliacoes || 0,
    score: l.score || 0,
    state: l.state || "na_fila",
    temSite: !!l.temSite,
    site: l.site || "",
    instagram: l.instagram || "",
    siteScore: l.siteAudit?.score ?? null,
    temCelular: /^55\d{2}9\d{8}$/.test(String(l.telefone || "").replace(/\D/g, "")) || /^\d{2}9\d{8}$/.test(String(l.telefone || "").replace(/\D/g, "")),
  }));

  const naFila = leads
    .filter((l) => l.state === "na_fila")
    .sort((a, b) => (b.score - a.score) || (b.avaliacoes - a.avaliacoes))
    .slice(0, 30);

  const ativos = leads.filter((l) => ["respondeu", "proposto"].includes(l.state)).slice(0, 10);

  return JSON.stringify({
    totalLeads: leads.length,
    naFilaCount: leads.filter((l) => l.state === "na_fila").length,
    ativos,
    top30NaFila: naFila,
  });
}

async function handleNaturalChat(text) {
  const ctx = buildAgentContext();
  const system = `Você é o Agente Gestor do WiNS Hub Comercial falando com o dono pelo Telegram.
Responda em português, de forma direta, prática e sem enrolação, usando APENAS os dados reais do JSON abaixo.
Nunca invente leads, notas ou números. Ao recomendar leads para prospectar, priorize quem tem celular (temCelular: true), boa nota/avaliações e sem site (temSite: false) ou site com nota baixa (siteScore < 70).
Sempre inclua o ID numérico de cada lead listado.
AÇÕES QUE VOCÊ PODE EXECUTAR:
- Se o usuário pedir para auditar sites: inclua [[ACAO:auditar]] no final.
- Se o usuário pedir para SIMULAR disparo (para os recomendados ou específicos): inclua [[ACAO:simular:ID1,ID2,...]] (ou [[ACAO:simular]] para toda a fila).
- Se o usuário pedir para DISPARAR / PROSPECTAR / ENVIAR WhatsApp REAL para os leads escolhidos: inclua UMA ÚNICA tag [[ACAO:disparar:ID1,ID2,...]] no final com TODOS os IDs numéricos separados por vírgula (ex: [[ACAO:disparar:3,4,5,6,7,8,10,11,12,13]]). NUNCA coloque uma tag por lead e NUNCA envie apenas 1 ID se o usuário pediu vários. Só use [[ACAO:disparar:...]] quando o usuário pedir explicitamente para enviar/disparar/prospectar.

DADOS ATUAIS DO CRM:
${ctx}`;

  tgHistory.push({ role: "user", content: text });
  while (tgHistory.length > 12) tgHistory.shift();
  saveTgHistory();

  logActivity("Telegram-IA", `💬 Pergunta: "${text.slice(0, 70).replace(/\s+/g, " ")}"`);
  let reply = await callClaude({ system, messages: tgHistory, maxTokens: 900 });

  const resolveKeysByIds = (idCsv) => {
    const wanted = new Set(
      String(idCsv || "")
        .split(/[\s,;]+/)
        .map((s) => Number(s.replace(/\D/g, "")))
        .filter((n) => !Number.isNaN(n) && n > 0)
    );
    const db = loadStatus();
    return Object.entries(db.leads || {})
      .filter(([, l]) => wanted.has(Number(l.id)))
      .map(([k, l]) => ({ key: k, nome: l.nome, state: l.state || "na_fila" }));
  };

  if (reply.includes("[[ACAO:auditar]]")) {
    reply = reply.replace(/\[\[ACAO:auditar\]\]/g, "").trim() + "\n\n" + await handleCommand("/auditar");
  }

  const simMatches = [...reply.matchAll(/\[\[ACAO:simular(?::([^\]]+))?\]\]/g)];
  if (simMatches.length) {
    const allIds = simMatches.map((m) => m[1] || "").filter(Boolean).join(",");
    for (const m of simMatches) reply = reply.replace(m[0], "").trim();
    const matched = allIds ? resolveKeysByIds(allIds) : [];
    const args = [resolve(__dirname, "worker-disparo.mjs"), "--dry-run", "--force-horario"];
    if (matched.length) args.push(`--keys=${matched.map((m) => m.key).join(",")}`);
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: __dirname });
    reply += `\n\n🧪 Simulação (${matched.length || "fila"}):\n${stdout.trim().slice(-1200) || "Nenhum lead elegível."}`;
  }

  const dispMatches = [...reply.matchAll(/\[\[ACAO:disparar(?::([^\]]+))?\]\]/g)];
  if (dispMatches.length) {
    const allIds = dispMatches.map((m) => m[1] || "").filter(Boolean).join(",");
    for (const m of dispMatches) reply = reply.replace(m[0], "").trim();
    let matched = allIds ? resolveKeysByIds(allIds) : [];
    if (!matched.length) {
      const db = loadStatus();
      matched = Object.entries(db.leads || {})
        .filter(([, l]) => (l.state || "na_fila") === "na_fila")
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
        .slice(0, 10)
        .map(([k, l]) => ({ key: k, nome: l.nome, state: l.state || "na_fila" }));
    }
    const elegiveis = matched.filter((m) => m.state === "na_fila");
    const ignorados = matched.filter((m) => m.state !== "na_fila");
    if (!elegiveis.length) {
      reply += `\n\n⚠️ Nenhum dos ${matched.length} lead(s) informados está 'na_fila' agora.`;
    } else {
      const keys = elegiveis.map((m) => m.key);
      logActivity("Telegram-IA", `🚀 Disparando em lote para ${elegiveis.length} lead(s): ${elegiveis.map((m) => m.nome).join(", ")}`);
      const child = spawn(process.execPath, [resolve(__dirname, "worker-disparo.mjs"), "--force-horario", `--keys=${keys.join(",")}`], {
        cwd: __dirname,
        env: process.env,
        detached: true,
      });
      let out = "";
      child.stdout.on("data", (d) => { const s = d.toString("utf8"); out += s; logActivity("Disparador", s); });
      child.stderr.on("data", (d) => { const s = d.toString("utf8"); out += s; logActivity("Disparador", s); });
      child.on("close", (code) => {
        notifyTelegram(`✅ Lote do Telegram finalizado (código ${code}):\n${out.trim().slice(-1200)}`).catch(() => {});
      });
      reply += `\n\n🚀 Disparo REAL iniciado em segundo plano para ${elegiveis.length} lead(s):\n• ${elegiveis.map((m) => m.nome).join("\n• ")}`;
      if (ignorados.length) {
        reply += `\n\n⏭️ Já fora da fila (${ignorados.length}): ${ignorados.map((m) => `${m.nome} (${m.state})`).join(", ")}`;
      }
      reply += `\n\nTe aviso aqui quando o lote terminar!`;
    }
  }

  tgHistory.push({ role: "assistant", content: reply });
  while (tgHistory.length > 12) tgHistory.shift();
  saveTgHistory();
  return reply;
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChat = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !allowedChat) return;

  let offset = 0;
  (async () => {
    while (true) {
      try {
        const res = await tgCall(token, "getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
        for (const upd of res?.result || []) {
          offset = upd.update_id + 1;
          const msg = upd.message;
          if (!msg?.text || String(msg.chat?.id) !== allowedChat) continue;
          const reply = msg.text.startsWith("/")
            ? await handleCommand(msg.text).catch((e) => `Erro: ${e.message}`)
            : await handleNaturalChat(msg.text).catch((e) => `Erro IA: ${e.message}`);
          await tgCall(token, "sendMessage", { chat_id: allowedChat, text: reply.slice(0, 4000), disable_web_page_preview: true });
        }
      } catch {
        await sleep(5000);
      }
    }
  })();
  console.log("📱 Bot de comandos Telegram ativo (restrito ao TELEGRAM_CHAT_ID).");
}

