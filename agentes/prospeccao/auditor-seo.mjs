#!/usr/bin/env node
// auditor-seo.mjs — auditoria técnica de SEO local de UM site, de graça.
//
// Alternativa 100% GRATUITA ao open-seo (que exige chave DataForSEO paga,
// top-up mínimo de US$ 50). Foco: números reais pra munição de pitch
// ("seu site carrega X, tem Y problemas, Z palavras-chave vazias").
//
// Uso:
//   node auditor-seo.mjs <url> [palavras-chave separadas por vírgula] [-o out.md]
//
// O que mede (tudo por fetch, sem browser):
//   HTTPS · peso do HTML+assets · nº de requests · imagens (quantas, KB,
//   lazy/loading, formato) · title/description (tamanho) · headings ·
//   viewport (mobile) · lang · favicon · og:* · robots.txt · sitemap.xml ·
//   JSON-LD (LocalBusiness) · detecção de WhatsApp/formulário · presença
//   das palavras-chave no texto.
// Saída: markdown pronto pro pitch.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const urlIdx = 0;
const url = args[urlIdx];
if (!url || !/^https?:\/\//i.test(url)) {
  console.error("uso: node auditor-seo.mjs <url> [keywords,virgula] [-o out.md]");
  process.exit(1);
}
const keywords = (args.find((a, i) => i > urlIdx && !a.startsWith("-o")) || "")
  .split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
const outIdx = args.indexOf("-o");
const OUT = outIdx !== -1 ? args[outIdx + 1] : null;

const fmtKB = (b) => b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
const host = url.replace(/^https?:\/\/[^/]+/i, "") || "/";

// ── 1. HTML principal ────────────────────────────────────────────────────────
const t0 = Date.now();
const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
const html = await res.text();
const carregouEm = Date.now() - t0;

const lower = html.toLowerCase();
const matches = (re) => (html.match(re) || []);
const meta = (nome) => {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${nome}["'][^>]*>`, "i"));
  return m ? (m[0].match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
};

const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "";
const description = meta("description");
const viewport = !!lower.match(/name=["']viewport["']/i);
const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || "";
const favicon = !!lower.match(/rel=["'][^"']*icon[^"']*["']/i);
const ogtitle = !!lower.match(/property=["']og:title["']/i);
const ogimage = !!lower.match(/property=["']og:image["']/i);
const jsonld = (lower.match(/application\/ld\+json/g) || []).length;
const localbusiness = /["@']?@?type["']?\s*:\s*["']?localbusiness/i.test(html) || /localbusiness/i.test(lower);

const h1s = matches(/<h1[\s>]/gi).length;
const h2s = matches(/<h2[\s>]/gi).length;
const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(t => t[0]);
const imgsSemAlt = imgs.filter(t => !/alt=["'][^"']+["']/i.test(t)).length;
const imgsLazy = imgs.filter(t => /loading=["']lazy["']/i.test(t)).length;
const scriptSrc = matches(/<script[^>]+src=["'][^"']+["']/gi).length;
const cssLinks = matches(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi).length;
const temWhatsApp = /wa\.me|api\.whatsapp|whatsapp/i.test(lower);
const temForm = /<form\b/i.test(lower);
const tokensTexto = lower
  .replace(/<script[\s\S]*?<\/script>/g, " ")
  .replace(/<[^>]+>/g, " ");
const kws = keywords.map((k) => ({
  kw: k,
  title: title.toLowerCase().includes(k),
  desc: description.toLowerCase().includes(k),
  texto: tokensTexto.includes(k),
}));

// robots.txt + sitemap.xml
const origem = url.match(/^https?:\/\/[^/]+/i)[0];
let robots = "", sitemap = 0;
try { robots = await (await fetch(origem + "/robots.txt", { headers: { "User-Agent": "Mozilla/5.0" } })).text(); } catch {}
try { sitemap = (await (await fetch(origem + "/sitemap.xml", { headers: { "User-Agent": "Mozilla/5.0" } })).status) === 200; } catch {}

// ── 2. peso dos assets referenciados (até 20 por tipo) ───────────────────────
const assetUrls = [
  ...html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi),
  ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
  ...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi),
].map(m => m[1]);
const absolutos = assetUrls.map(u => {
  try { return new URL(u, url).href; } catch { return null; }
}).filter(Boolean).slice(0, 40);

let bytesAssets = 0, errosAssets = 0, jpgPngPesados = 0;
const tA0 = Date.now();
for (const u of absolutos.slice(0, 25)) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
    const buf = await r.arrayBuffer();
    bytesAssets += buf.byteLength;
    if (/\.(jpe?g|png)(\?|$)/i.test(u)) jpgPngPesados++;
  } catch { errosAssets++; }
}
const assetsEm = Date.now() - tA0;

// ── 3. pontuação simples (0–100) ─────────────────────────────────────────────
const notas = [];
const nota = (peso, ok, problema) => { notas.push({ peso, ok, problema }); };
nota(8, res.ok, res.ok ? null : `página responde ${res.status}`);
nota(5, url.startsWith("https://"), url.startsWith("https://") ? null : "roda em HTTP (sem HTTPS)");
nota(8, title.length >= 20 && title.length <= 65, title ? `title com ${title.length} car. (${title.length < 20 ? "curto demais" : title.length > 65 ? "longo demais" : "ok"})` : "sem <title>");
nota(8, description.length >= 50 && description.length <= 165, description ? `description com ${description.length} car. (${description.length < 50 ? "curta demais" : description.length > 165 ? "longa demais" : "ok"})` : "sem meta description");
nota(8, viewport, viewport ? null : "sem meta viewport — site quebra no CELULAR");
nota(5, lang.startsWith("pt"), lang ? `lang="${lang}" ${lang.startsWith("pt") ? "" : "(não pt)"}` : "sem lang no <html>");
nota(5, favicon, favicon ? null : "sem favicon declarado");
nota(4, ogtitle && ogimage, ogtitle && ogimage ? null : "sem Open Graph (compartilhamento no WhatsApp/Instagram fica sem imagem)");
nota(5, sitemap, sitemap ? null : "sem sitemap.xml");
nota(4, robots.includes("sitemap") || robots.trim().length > 0, robots.trim() ? null : "sem robots.txt");
nota(8, h1s === 1, h1s === 1 ? null : `${h1s} tags <h1> (ideal: exatamente 1)`);
nota(6, localbusiness || jsonld > 0, localbusiness || jsonld > 0 ? null : "sem dados estruturados (JSON-LD/LocalBusiness) para o Google");
nota(8, imgsSemAlt === 0, imgsSemAlt === 0 ? null : `${imgsSemAlt}/${imgs.length} imagens sem alt (acessibilidade + SEO de imagem)`);
nota(8, imgsLazy >= imgs.length / 2, imgs.length && imgsLazy >= imgs.length / 2 ? null : `só ${imgsLazy}/${imgs.length} imagens com lazy loading`);
nota(4, temWhatsApp, temWhatsApp ? null : "sem WhatsApp detectado no site");
nota(9, bytesAssets < 3000000 && jpgPngPesados <= 6, `assets somam ${fmtKB(bytesAssets)} em ${Math.min(absolutos.length, 25)} requests (${jpgPngPesados} imagens em JPG/PNG sem otimização)`);
nota(3, carregouEm < 1500, `HTML principal levou ${(carregouEm / 1000).toFixed(1)}s para chegar (os assets somam ${(assetsEm / 1000).toFixed(1)}s extra)`);
nota(6, temForm, temForm ? null : "sem formulário de contato no site");

const totalPesos = notas.reduce((a, n) => a + n.peso, 0);
const ganhos = notas.reduce((a, n) => a + (n.ok ? n.peso : 0), 0);
const score = Math.round(100 * ganhos / totalPesos);
const problemas = notas.filter(n => !n.ok).sort((a, b) => b.peso - a.peso);

// ── 4. relatório markdown ────────────────────────────────────────────────────
const hoje = new Date().toLocaleDateString("pt-BR");
let md = `# Auditoria SEO — ${url}\n\n> Gerada em ${hoje} com \`auditor-seo.mjs\` (gratuito, fetch puro).\n> Nota geral: **${score}/100**\n\n`;

md += `## Números que o dono precisa ver\n\n| Medida | Valor |\n|---|---|\n`;
md += `| HTML chega em | ${(carregouEm / 1000).toFixed(1)} s |\n`;
md += `| Assets (CSS/JS/imagens analisadas) | ${fmtKB(bytesAssets)} · ${jpgPngPesados} em JPG/PNG pesados |\n`;
md += `| Title | ${title ? `"${title.slice(0, 70)}" (${title.length} car.)` : "NÃO EXISTE"} |\n`;
md += `| Meta description | ${description ? `${description.length} car.` : "NÃO EXISTE"} |\n`;
md += `| Mobile (viewport) | ${viewport ? "ok" : "FALTA"} |\n`;
md += `| Open Graph (compartilhar) | ${ogtitle && ogimage ? "ok" : "FALTA"} |\n`;
md += `| Dados estruturados p/ Google | ${localbusiness ? "LocalBusiness ok" : jsonld > 0 ? `${jsonld} JSON-LD (genérico)` : "NENHUM"} |\n`;
md += `| H1 | ${h1s} · H2: ${h2s} |\n`;
md += `| Imagens | ${imgs.length} no total · ${imgsSemAlt} sem alt · ${imgsLazy} com lazy |\n`;
md += `| robots.txt / sitemap.xml | ${robots.trim() ? "ok" : "FALTA"} / ${sitemap ? "ok" : "FALTA"} |\n`;
md += `| WhatsApp no site | ${temWhatsApp ? "detectado" : "NÃO"} · formulário: ${temForm ? "sim" : "NÃO"} |\n\n`;

if (kws.some(k => k.kw)) {
  md += `## Palavras-chave buscadas (onde o cliente procura)\n\n| Palavra | No título | Na description | No texto | |\n|---|---|---|---|---|\n`;
  for (const k of kws) {
    const faltando = [k.title && "título", k.desc && "description", k.texto && "texto"].filter(Boolean);
    const faltaTudo = faltando.length === 0;
    md += `| ${k.kw} | ${k.title ? "✔" : "—" } | ${k.desc ? "✔" : "—" } | ${k.texto ? "✔" : "—" } | ${faltaTudo ? "🔴 ZERO presença" : faltando.length < 3 ? "🟡 parcial" : "✔"} |\n`;
  }
  md += "\n";
}

if (problemas.length) {
  md += `## Problemas (ordem de dor)\n\n`;
  for (const p of problemas) md += `- **${p.problema}** *(peso ${p.peso}/${totalPesos})*\n`;
  md += `\n## O que já está ok\n\n`;
  for (const p of notas.filter(n => n.ok)) md += `- ✔ ${p.problema || "item válido"} (${p.peso} pts)\n`;
}

if (OUT) {
  writeFileSync(OUT, md, "utf8");
  console.log("[OK] relatório: " + OUT);
} else {
  process.stdout.write(md);
}
console.error(`\n>>> nota SEO ${score}/100 · ${problemas.length} problemas · ${notas.length - problemas.length} ok`);
