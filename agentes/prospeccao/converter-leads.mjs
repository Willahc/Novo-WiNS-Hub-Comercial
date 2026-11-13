#!/usr/bin/env node
// converter-leads.mjs — CSV do WiNS Hub → leads.json do gerar-fila.mjs
//
// FECHA A JUNÇÃO DO FUNIL: lê o CSV que o scraper grava (ou que você
// baixou pela interface "Baixar planilha") e devolve o JSON no formato
// que o gerar-fila.mjs entende (cid, web_site, emails[], complete_address).
//
// Uso:
//   node converter-leads.mjs                     (varre ..\..\webdata\*.csv)
//   node converter-leads.mjs arquivos ou pastas  (aceita vários)
//   node converter-leads.mjs meu.csv -o saida.json
//
// Entende os DOIS formatos:
//   1. CSV branco do job (headers em inglês: input_id, link, title, ... website ...)
//   2. Planilha da interface (headers pt-BR: Empresa;Categoria;Telefone;... notas com vírgula)
// Sem dependências. Node 18+.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBDATA = resolve(__dirname, "..", "..", "webdata");

// ── argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outIdx = args.indexOf("-o");
const OUT = outIdx !== -1 ? args[outIdx + 1] : null;
const inputs = args.filter((a, i) => a !== "-o" && i !== outIdx + 1 && !a.startsWith("-"));

function coletarCsvs(lista) {
  const achados = [];
  for (const alvo of lista) {
    if (!existsSync(alvo)) { console.error(`⚠️  não achei: ${alvo}`); continue; }
    if (statSync(alvo).isDirectory()) {
      for (const f of readdirSync(alvo)) {
        if (f.toLowerCase().endsWith(".csv")) achados.push(join(alvo, f));
      }
    } else if (alvo.toLowerCase().endsWith(".csv")) achados.push(resolve(alvo));
  }
  return achados;
}

const csvFiles = inputs.length ? coletarCsvs(inputs) : coletarCsvs([WEBDATA]);
if (!csvFiles.length) {
  console.error(
    "uso: node converter-leads.mjs [arquivo.csv|pasta...]" +
    "\n  sem argumento: varre " + WEBDATA
  );
  process.exit(1);
}

// ── parser CSV genérico (aspas, vírgula/; e BOM) ─────────────────────────────
function parseCsv(text, delim) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const norm = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function sniffDelim(linha) {
  const tremas = (linha.match(/;/g) || []).length;
  const virgulas = (linha.match(/,/g) || []).length;
  return tremas > virgulas ? ";" : ",";
}

const cidDoLink = (link) => {
  const m = String(link || "").match(/[!&?/]cid=(\d+)/);
  return m ? m[1] : "";
};

const numDe = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const emailsDe = (v) =>
  String(v || "")
    .split(/[,;\s]+/)
    .filter((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));

// ── por arquivo: detectar formato, mapear e acumular ─────────────────────────
const leads = new Map(); // chave → lead

for (const arq of csvFiles) {
  const text = readFileSync(arq, "utf8").replace(/^\uFEFF/, "").trim();
  if (!text) { console.error(`⚠️  ${basename(arq)} vazio — pulando`); continue; }

  const delim = sniffDelim(text.split(/\r?\n/, 2)[0]);
  const [head, ...rows] = parseCsv(text, delim);
  const idx = {};
  head.forEach((h, i) => { idx[norm(h)] = i; });
  const g = (row, k) => (k in idx ? (row[idx[k]] ?? "").trim() : "");

  const ehUI = ("empresa" in idx && "site" in idx);
  const modo = ehUI ? "ui" : "bruto";

  const cidadeFallback = (row) => {
    const c = modo === "ui" ? g(row, "cidade") : "";
    if (c) return c;
    const raw = g(row, "complete_address");
    try { return JSON.parse(raw).city || ""; } catch {
      const parts = g(row, "address").split(",");
      return (parts[parts.length - 2] || parts[0] || "").trim();
    }
  };

  let ok = 0, pulados = 0;
  for (const row of rows) {
    // linhas de job fracassado/parcial não viram leads
    if (modo === "bruto") {
      const st = g(row, "status");
      if (st && !/^success/i.test(st)) { pulados++; continue; }
    }
    const title = modo === "ui" ? g(row, "empresa") : g(row, "title");
    if (!title) { pulados++; continue; }

    const link = modo === "ui" ? g(row, "google maps") : g(row, "link");
    const site = (modo === "ui" ? g(row, "site") : g(row, "website") || g(row, "web_site") || "") || "";
    const instagram = g(row, "instagram") || "";
    const cat = modo === "ui" ? g(row, "categoria") : g(row, "category");

    const lead = {
      cid: (modo === "bruto" ? g(row, "cid") || g(row, "data_id") : cidDoLink(link)) ||
           slugify(title + "-" + cidadeFallback(row)),
      place_id: modo === "bruto" ? g(row, "place_id") || g(row, "data_id") : "",
      title,
      category: cat.split(/\s*[,;]\s*/)[0] || "negócio",
      categories: cat.split(/\s*[,;]\s*/).filter(Boolean),
      address: modo === "ui" ? g(row, "endereco") : g(row, "address"),
      complete_address: {
        borough: modo === "ui" ? g(row, "bairro") : "",
        city: cidadeFallback(row),
      },
      phone: modo === "ui" ? g(row, "whatsapp") || g(row, "telefone") : g(row, "phone"),
      web_site: site,
      instagram,
      review_count: parseInt(g(row, modo === "ui" ? "avaliacoes" : "review_count"), 10) || 0,
      review_rating: numDe(g(row, modo === "ui" ? "nota" : "review_rating")),
      emails: emailsDe(modo === "ui" ? g(row, "e-mail") : g(row, "emails")),
      link,
    };

    const chave = String(lead.cid) || slugify(title);
    if (!leads.has(chave)) { leads.set(chave, lead); ok++; }
    else pulados++;
  }
  console.log(`📄 ${basename(arq)} [${modo}] — ${ok} novos${pulados ? ` · ${pulados} descartados/dupes` : ""}`);
}

// ── saída ────────────────────────────────────────────────────────────────────
const saida = OUT || (inputs.length && statSync(inputs[0]).isFile()
  ? resolve(dirname(inputs[0]), "leads.json")
  : resolve(inputs[0] || __dirname, "leads.json"));

writeFileSync(saida, JSON.stringify([...leads.values()], null, 2) + "\n", "utf8");

const total = leads.size;
const comSite = [...leads.values()].filter((l) => l.web_site).length;
const comTel = [...leads.values()].filter((l) => String(l.phone).replace(/\D/g, "").length >= 10).length;
console.log(`\n✅ ${total} leads → ${saida}`);
console.log(`   🔴 sem site: ${total - comSite} · 🟡 com site: ${comSite} · 📞 com telefone: ${comTel}`);
console.log(`\n▶️  próximo passo:`);
console.log(`   node agencia-ia\\prospeccao\\gerar-fila.mjs ${saida.replace(process.cwd() + "\\", "")} --limit 20`);
