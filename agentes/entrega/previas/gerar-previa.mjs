#!/usr/bin/env node
// gerar-previa.mjs — Gera prévias HTML estáticas para os leads em status.json
// Uso:
//   node gerar-previa.mjs              (gera para todos os leads de status.json)
//   node gerar-previa.mjs --id 9       (gera apenas para o lead ID 9)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStatus } from "../../sdr-whatsapp/lib.mjs";
import { renderPreviewHtml, slugify, detectNiche } from "./templates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "geradas");

const args = process.argv.slice(2);
const idIdx = args.indexOf("--id");
const targetId = idIdx !== -1 ? Number(args[idIdx + 1]) : null;

const db = loadStatus();
const leads = Object.values(db.leads || {}).filter((l) =>
  targetId ? l.id === targetId : true
);

if (!leads.length) {
  console.log("Nenhum lead encontrado em status.json.");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const lead of leads) {
  const slug = `${lead.id}-${slugify(lead.nome)}`;
  const dir = resolve(OUT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const html = renderPreviewHtml(lead);
  writeFileSync(resolve(dir, "index.html"), html, "utf8");
  console.log(`✅ [${detectNiche(lead.nicho)}] ${lead.nome} → geradas/${slug}/index.html`);
}

console.log(`\n🎉 ${leads.length} prévia(s) gerada(s) em ${OUT_DIR}`);

