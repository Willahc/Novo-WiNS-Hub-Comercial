#!/usr/bin/env node
// monitor-silencioso.mjs — Rotina silenciosa de saúde (só alerta no Telegram se algo cair)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, getEvolutionState, getAnthropicUsage, notifyTelegram, logActivity } from "./lib.mjs";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, "..", "prospeccao", "monitor-state.json");

function loadMonitorState() {
  if (!existsSync(STATE_PATH)) return { downSince: null, lastAlertAt: 0, lastIssues: [] };
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { downSince: null, lastAlertAt: 0, lastIssues: [] };
  }
}

async function checkHttp(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch {
    clearTimeout(t);
    return false;
  }
}

async function main() {
  const issues = [];
  const evo = await getEvolutionState();
  if (evo !== "open") issues.push(`Evolution WhatsApp: ${evo}`);

  const winshubOk = await checkHttp("http://127.0.0.1:8080/");
  if (!winshubOk) issues.push("Painel WiNS Hub (:8080) offline");

  const webhookOk = await checkHttp("http://127.0.0.1:3005/previa/999-maristela-veterinaria");
  if (!webhookOk) issues.push("Webhook SDR (:3005) offline");

  const claude = getAnthropicUsage();
  if (claude.lastError) issues.push(`Claude API erro: ${claude.lastError.slice(0, 80)}`);

  const prev = loadMonitorState();
  const now = Date.now();

  if (issues.length > 0) {
    const shouldAlert = (now - (prev.lastAlertAt || 0)) > 60 * 60 * 1000 || prev.lastIssues.join("|") !== issues.join("|");
    if (shouldAlert) {
      const msg = `🚨 ALERTA SILENCIOSO — WiNS Hub\n\n` + issues.map((i) => `- ${i}`).join("\n");
      await notifyTelegram(msg);
      logActivity("Monitor", `🚨 Alerta enviado: ${issues.join(" | ")}`);
      prev.lastAlertAt = now;
    }
    prev.downSince = prev.downSince || new Date().toISOString();
    prev.lastIssues = issues;
  } else {
    if (prev.downSince) {
      await notifyTelegram("✅ WiNS Hub recuperado: todos os serviços e WhatsApp estão online novamente.");
      logActivity("Monitor", "✅ Todos os serviços recuperados.");
    }
    prev.downSince = null;
    prev.lastIssues = [];
  }

  writeFileSync(STATE_PATH, JSON.stringify(prev, null, 2), "utf8");
}

main().catch((e) => console.error(e));

