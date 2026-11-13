// telegram-bot.mjs — Bot de comando remoto no Telegram (Chefe de Gabinete + Status + Simulação)
import { execFile, spawn } from "node:child_process";
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

const tgHistory = [];

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
- Se o usuário pedir para DISPARAR / PROSPECTAR / ENVIAR WhatsApp REAL para os leads escolhidos: inclua [[ACAO:disparar:ID1,ID2,...]] no final. Só use [[ACAO:disparar:...]] quando o usuário pedir explicitamente para enviar/disparar/prospectar.

DADOS ATUAIS DO CRM:
${ctx}`;

  tgHistory.push({ role: "user", content: text });
  while (tgHistory.length > 8) tgHistory.shift();

  logActivity("Telegram-IA", `💬 Pergunta: "${text.slice(0, 70).replace(/\s+/g, " ")}"`);
  let reply = await callClaude({ system, messages: tgHistory, maxTokens: 800 });

  const resolveKeysByIds = (idCsv) => {
    const wanted = new Set(String(idCsv || "").split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n) && n > 0));
    const db = loadStatus();
    return Object.entries(db.leads || {})
      .filter(([, l]) => wanted.has(Number(l.id)))
      .map(([k, l]) => ({ key: k, nome: l.nome }));
  };

  if (reply.includes("[[ACAO:auditar]]")) {
    reply = reply.replace("[[ACAO:auditar]]", "").trim() + "\n\n" + await handleCommand("/auditar");
  }

  const simMatch = reply.match(/\[\[ACAO:simular(?::([0-9,\s]+))?\]\]/);
  if (simMatch) {
    reply = reply.replace(simMatch[0], "").trim();
    const matched = simMatch[1] ? resolveKeysByIds(simMatch[1]) : [];
    const args = [resolve(__dirname, "worker-disparo.mjs"), "--dry-run", "--force-horario"];
    if (matched.length) args.push(`--keys=${matched.map((m) => m.key).join(",")}`);
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: __dirname });
    reply += `\n\n🧪 Simulação (${matched.length || "fila"}):\n${stdout.trim().slice(-1200) || "Nenhum lead elegível."}`;
  }

  const dispMatch = reply.match(/\[\[ACAO:disparar:([0-9,\s]+)\]\]/);
  if (dispMatch) {
    reply = reply.replace(dispMatch[0], "").trim();
    const matched = resolveKeysByIds(dispMatch[1]);
    if (!matched.length) {
      reply += "\n\n⚠️ Não encontrei esses IDs no status.json.";
    } else {
      const keys = matched.map((m) => m.key);
      logActivity("Telegram-IA", `🚀 Disparando em lote para ${matched.length} lead(s): ${matched.map((m) => m.nome).join(", ")}`);
      const child = spawn(process.execPath, [resolve(__dirname, "worker-disparo.mjs"), "--force-horario", `--keys=${keys.join(",")}`], {
        cwd: __dirname,
        env: process.env,
      });
      let out = "";
      child.stdout.on("data", (d) => { const s = d.toString("utf8"); out += s; logActivity("Disparador", s); });
      child.stderr.on("data", (d) => { const s = d.toString("utf8"); out += s; logActivity("Disparador", s); });
      child.on("close", (code) => {
        notifyTelegram(`✅ Lote do Telegram finalizado (código ${code}):\n${out.trim().slice(-1200)}`).catch(() => {});
      });
      reply += `\n\n🚀 Disparo REAL iniciado em segundo plano para ${matched.length} lead(s):\n• ${matched.map((m) => m.nome).join("\n• ")}\n\nTe aviso aqui quando o lote terminar!`;
    }
  }

  tgHistory.push({ role: "assistant", content: reply });
  while (tgHistory.length > 8) tgHistory.shift();
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

