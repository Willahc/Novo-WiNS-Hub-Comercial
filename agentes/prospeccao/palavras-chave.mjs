#!/usr/bin/env node
// palavras-chave.mjs — pesquisa de palavras-chave 100% GRATUITA.
//
// Fonte: Google Suggest (autocomplete público, sem chave, sem cartão).
// É o mesmo mecanismo que Ubersuggest/SEMrush usam por trás — aqui direto.
// Complemento: opcionalmente confere quais termos o site do cliente JÁ tem.
//
// Uso:
//   node palavras-chave.mjs "construtora" [--cidade "mogi guaçu"] [--site URL] [-o out.md]
//   (aceita várias seeds separadas por vírgula)
//
// Saída: markdown com as ideias geradas + frequência, e uma tabela
// "o site do cliente já atende esse termo?" quando --site é passado.

const argv = process.argv.slice(2);
const seeds = (argv.find((a, i) => i === 0) || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const flag = (nome) => {
  const i = argv.indexOf(nome);
  return i !== -1 ? argv[i + 1] : null;
};
const cidade = (flag("--cidade") || "").trim();
const site = flag("--site");
const out = flag("-o");
if (!seeds.length) {
  console.error('uso: node palavras-chave.mjs "seed1,seed2" [--cidade X] [--site URL] [-o out.md]');
  process.exit(1);
}

const SUFIXOS = ["", " preço", " orçamento", " perto de mim", " o que faz", " telefone", " melhores", " quanto custa"];

const UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } };

async function sugestoes(q) {
  const url = "https://suggestqueries.google.com/complete/search?client=firefox&hl=pt-BR&gl=br&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, UA);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

// ── 1. expandir as seeds ─────────────────────────────────────────────────────
const bases = [];
for (const s of seeds) {
  bases.push(s);
  if (cidade) bases.push(`${s} ${cidade}`);
  for (const suf of SUFIXOS.slice(1)) bases.push(cidade ? `${s} ${cidade}${suf}` : `${s}${suf}`);
}

const contagem = new Map();
const t0 = Date.now();
// em lotes de 5 p/ ser educado (mesma ética das demais ferramentas)
for (let i = 0; i < bases.length; i += 5) {
  const lote = bases.slice(i, i + 5);
  const resultados = await Promise.all(lote.map(sugestoes));
  for (const lista of resultados) {
    for (const s of lista) contagem.set(s, (contagem.get(s) || 0) + 1);
  }
}
const ideias = [...contagem.entries()]
  .filter(([k]) => !/\bmogimix\b|\bmogicom\b/.test(k)) // tira empresas concorrentes de autocomplete de nome próprio
  .sort((a, b) => b[1] - a[1]);
const consulta = Date.now() - t0;

// ── 2. classificar: busca real vs. marca vs. informacional vs. outro ────────
// − MARCA: palavra desconhecida ANTES da seed ("k10 construtora mogi guaçu").
//   Words de função (empresa de, sindicato, melhor...) não contam como marca.
// − INFO: "curso, salário, vaga, senai, 2026..." → busca de estudo, não de
//   contratar.
// − LOCAL: contém a cidade. SERVIÇO: contém palavra de serviço. → munição.
// − OUTRO: resto (lista de fundo).
const PRIMEIRAS = seeds.map(s => s.toLowerCase().split(/\s+/)[0]);
const PALAVRAS_INFO = ["curso", "salário", "salario", "vaga", "vagas", "fatec", "senai", "tecnólogo", "tecnologo", "o que faz", "significado", "símbolo", "simbolo", "como", "ingles", "inglês", "ead", "unip"];
const PALAVRAS_FUNCAO = new Set(["empresa", "empresas", "sindicato", "sindicatos", "melhor", "melhores", "quanto", "quais", "onde", "preço", "preco", "orçamento", "orcamento", "valores", "contratar", "contratando", "o", "a", "os", "as", "de", "da", "do", "em", "no", "na", "para", "pelo", "pela"]);
const tokensCidade = cidade.toLowerCase().split(/\s+/).filter(Boolean);
const PALAVRAS_SERVICO = ["manutenção", "construção", "obra", "obras", "reforma", "orçamento", "preço", "telefone", "custa", "custo", "perto", "engenharia", "galpão", "elétrica", "hidráulica", "pintura", "laje", "piso"];
const tipoDe = (kw) => {
  const k = kw.toLowerCase();
  // prefixo antes da 1ª ocorrência da seed: tem palavra de conteúdo? → marca
  const idxSeed = PRIMEIRAS.map(p => k.indexOf(p)).filter(i => i > 0);
  if (idxSeed.length) {
    const prefixo = k.slice(0, Math.min(...idxSeed)).trim()
      .split(/\s+/)
      .map(t => t.replace(/[^a-záàâãéêíóôõúç0-9]/g, ""))
      .filter(t => t && !PALAVRAS_FUNCAO.has(t));
    if (prefixo.length) return "marca";
  }
  if (PALAVRAS_INFO.some(p => k.includes(p))) return "info";
  if (tokensCidade.length && tokensCidade.every(t => k.includes(t))) return "local";
  if (PALAVRAS_SERVICO.some(p => k.includes(p))) return "servico";
  return "outro";
};
const classificadas = ideias.map(([kw, n]) => ({ kw, n, tipo: tipoDe(kw) }));
const buscasReais = classificadas.filter(c => c.tipo === "local" || c.tipo === "servico");
const marcas = classificadas.filter(c => c.tipo === "marca");
const infos = classificadas.filter(c => c.tipo === "info");
const outros = classificadas.filter(c => c.tipo === "outro");

// ── 3. (opcional) presença das buscas reais no site do cliente ──────────────
let textoSite = "";
let urlSite = "";
if (site) {
  urlSite = site;
  try {
    const res = await fetch(site, UA);
    textoSite = (await res.text()).toLowerCase().replace(/<[^>]+>/g, " ");
  } catch {
    console.error("[AVISO] site não respondeu; tabela de presença fica vazia");
  }
}

// ── 4. relatório markdown ────────────────────────────────────────────────────
const hoje = new Date().toLocaleDateString("pt-BR");
let md = `# Pesquisa de palavras-chave (Google Suggest — gratuito)\n\n`;
md += `> Gerada em ${hoje} com \`palavras-chave.mjs\` · seeds: ${seeds.join(", ")}${cidade ? ` · região: ${cidade}` : ""}\n`;
md += `> ${ideias.length} resultados em ${(consulta / 1000).toFixed(1)}s · a ordem aproxima a demanda real da região\n\n`;

const presente = (kw) => {
  if (!textoSite) return null;
  return textoSite.includes(kw.toLowerCase().replace(/\s+/g, " "));
};

if (urlSite) {
  md += `## O que a região busca — e o site atende?\n\n| Termo buscado | No site | |\n|---|---|---|\n`;
  for (const { kw } of buscasReais.slice(0, 15)) {
    const p = presente(kw);
    md += `| ${kw} | ${p ? "✔" : "—"} | ${p ? "" : "🔴 oportunidade"} |\n`;
  }
  md += `\n> Observação: descarte da tabela o termo que citar outra empresa ou outra\n> praça (ex.: "construtora união mogi guaçu" é a marca União; "em são paulo"\n> é outra cidade). O que sobra é munição direta pro conteúdo do site.\n\n`;
}

md += `## Busca local/serviço (as que importam)\n\n`;
for (const { kw, n } of buscasReais) md += `- ${kw} ${n > 1 ? `· ${n} variações` : ""}\n`;

if (infos.length) {
  md += `\n## Busca informacional (interesse em aprender, não em contratar — ignora no pitch)\n\n`;
  for (const { kw } of infos) md += `- ${kw}\n`;
}
if (outros.length) {
  md += `\n## Outros termos capturados (sem classificação forte — use com cuidado)\n\n`;
  for (const { kw } of outros) md += `- ${kw}\n`;
}

if (marcas.length) {
  md += `\n## Intel de concorrência — o que o Google aponta quando alguém busca "${seeds[0]}" na região\n\n`;
  md += `> Não são oportunidades de palavra-chave (são nomes de empresas), mas mostram QUEM domina a cabeça do buscador. O cliente está invisível nesse grupo.\n\n`;
  for (const { kw } of marcas.slice(0, 15)) md += `- ${kw}\n`;
}

if (out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, md, "utf8");
  console.log(`[OK] ${ideias.length} resultados (${buscasReais.length} buscas reais + ${marcas.length} marcas) -> ${out}`);
} else {
  console.log(md);
}
