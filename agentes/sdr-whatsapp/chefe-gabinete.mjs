#!/usr/bin/env node
// chefe-gabinete.mjs — Resumo executivo (/inbox) + RH dos Bots (desempenho por nicho e variante)
import { readFileSync, existsSync } from "node:fs";
import {
  loadEnv, loadStatus, getAnthropicUsage, getEvolutionState,
  getConversation, normalizePhone, notifyTelegram, DAILY_LOG_PATH,
} from "./lib.mjs";

loadEnv();

function getDaily() {
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

export async function buildInboxReport() {
  const db = loadStatus();
  const leads = Object.values(db.leads || {});
  const counts = { na_fila: 0, enviado: 0, respondeu: 0, proposto: 0, fechado: 0, descartado: 0 };
  const byNiche = {};
  const byVar = { A: { env: 0, resp: 0 }, B: { env: 0, resp: 0 } };

  for (const l of leads) {
    const st = l.state || "na_fila";
    if (st in counts) counts[st]++;
    const nicho = l.nicho || "Outro";
    if (!byNiche[nicho]) byNiche[nicho] = { env: 0, resp: 0, fech: 0 };
    if (["enviado", "visualizado", "respondeu", "proposto", "fechado"].includes(st)) {
      byNiche[nicho].env++;
      if (l.variante === "A" || l.variante === "B") byVar[l.variante].env++;
    }
    if (["respondeu", "proposto", "fechado"].includes(st)) {
      byNiche[nicho].resp++;
      if (l.variante === "A" || l.variante === "B") byVar[l.variante].resp++;
    }
    if (st === "fechado") byNiche[nicho].fech++;
  }

  const pendentes = leads
    .filter((l) => l.state === "proposto" || l.state === "respondeu")
    .slice(0, 8);

  const daily = getDaily();
  const claude = getAnthropicUsage();
  const evo = await getEvolutionState();

  const lines = [
    `📋 *Chefe de Gabinete — WiNS Hub*`,
    `WhatsApp: *${evo === "open" ? "Conectado" : evo}* · Disparos hoje: *${daily.count}/${daily.max}*`,
    `Funil: ${counts.na_fila} na fila · ${counts.enviado} enviados · ${counts.respondeu} resp · *${counts.proposto} handoffs* · ${counts.fechado} fechados`,
    `Claude hoje: *${claude.today.calls}* reqs · ${claude.today.inputTokens + claude.today.outputTokens} tok · *US$ ${Number(claude.today.costUsd || 0).toFixed(3)}*`,
  ];

  if (pendentes.length) {
    lines.push("", `🔥 *Aguardando sua ação (${pendentes.length}):*`);
    for (const l of pendentes) {
      const tel = normalizePhone(l.telefone);
      const msgs = tel ? getConversation(tel) : [];
      const last = msgs.length ? msgs[msgs.length - 1].content.slice(0, 60).replace(/\s+/g, " ") : "";
      lines.push(`• *${l.nome}* (${l.state}) — https://wa.me/${tel}${last ? `\n  _"${last}..."_` : ""}`);
    }
  } else {
    lines.push("", `✅ Nenhum handoff pendente no momento.`);
  }

  const topNiches = Object.entries(byNiche)
    .filter(([, v]) => v.env > 0)
    .sort((a, b) => (b[1].resp / b[1].env) - (a[1].resp / a[1].env))
    .slice(0, 4);

  if (topNiches.length) {
    lines.push("", `📊 *RH dos Bots (Taxa por nicho):*`);
    for (const [n, v] of topNiches) {
      const pct = Math.round((v.resp / v.env) * 100);
      lines.push(`• ${n}: ${v.resp}/${v.env} resp (${pct}%)${v.fech ? ` · ${v.fech} fech.` : ""}`);
    }
    const pctA = byVar.A.env ? Math.round((byVar.A.resp / byVar.A.env) * 100) : 0;
    const pctB = byVar.B.env ? Math.round((byVar.B.resp / byVar.B.env) * 100) : 0;
    lines.push(`• Copy A: ${pctA}% (${byVar.A.resp}/${byVar.A.env}) vs Copy B: ${pctB}% (${byVar.B.resp}/${byVar.B.env})`);
  }

  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("chefe-gabinete.mjs")) {
  const report = await buildInboxReport();
  if (process.argv.includes("--send")) {
    await notifyTelegram(report.replace(/\*/g, ""));
    console.log("Relatório enviado ao Telegram.");
  } else {
    console.log(report);
  }
}

