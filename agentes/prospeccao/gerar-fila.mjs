#!/usr/bin/env node
// gerar-fila.mjs v2 — leads do google-maps-scraper → fila de prospecção
//
// NOVIDADES DA v2:
//   1. SCORE ADAPTATIVO: aprende com o status.json — nichos/canais que
//      respondem mais sobem de prioridade sozinhos a cada rodada
//   2. ENRIQUECIMENTO: abre o site real do lead e injeta detalhes
//      verdadeiros na mensagem (título, serviços, o que tem/ falta)
//   3. COMANDO DE STATUS: atualize o funil direto pelo terminal e o
//      sistema aprende, ex:
//        node gerar-fila.mjs --status 03 respondeu
//        node gerar-fila.mjs --status pizzaria fechado
//   4. FOLLOW-UPS: lista o que precisa de segunda mensagem hoje
//
// Uso:
//   node gerar-fila.mjs leads.json [--limit N] [--canal whatsapp|email|instagram]
//   node gerar-fila.mjs --status <ID|nome> <enviado|visualizado|respondeu|proposto|fechado>
//   node gerar-fila.mjs --memoria                (mostra o aprendizado atual)
//   node gerar-fila.mjs --funil                  (relatório de conversão por etapa)
//   node gerar-fila.mjs --reset-memoria          (zera o aprendizado)
//   Opcional: [--demo https://demo.seusite.com/p] injeta o link de demo de cada lead
//
// Saída: prospeccao/fila.md + prospeccao/status.json
// Sem dependências. Node 18+.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATUS_PATH = resolve(__dirname, "status.json");
const FILA_PATH = resolve(__dirname, "fila.md");

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const NICHOS_QUE_COMPRAM = [
  "clínica", "dentista", "advocacia", "advogado", "imobiliária",
  "restaurante", "pizzaria", "hamburgueria", "estética", "beleza",
  "salão", "barbearia", "academia", "pilates", "yoga",
  "veterinário", "pet", "oftalmologia", "dermatologia", "fisioterapia",
  "psicologia", "nutrição", "arquitetura", "engenharia", "construtora",
  "contabilidade", "despachante", "floricultura",
];

const ESTADOS = ["na_fila", "enviado", "visualizado", "respondeu", "proposto", "fechado", "descartado"];
const AMOSTRA_MINIMA = 5; // enviados por nicho antes de o aprendizado valer

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const MENSAGENS = {
  whatsapp: {
    A: (l, en) =>
      `Oi! Tudo bem?\n\n` +
      `Fui pesquisando ${l.nicho.toLowerCase()}s aqui em ${l.cidade} e ` +
      `encontrei o ${l.nome} — ${l.avaliacoes} avaliações no Google, parabéns!\n\n` +
      `${cap(l.queixa)}\n\n` +
      (en?.achado ? `${en.achado}\n\n` : "") +
      `Montei uma prévia de site com a cara do ${l.nome} pra você ver como ` +
      `ficaria. Posso te mandar o link?`,
    B: (l, en) =>
      `Boa tarde! Encontrei o ${l.nome} no Google e ${l.queixa}\n\n` +
      `Pergunta: como vocês recebem cliente novo hoje?\n\n` +
      `Pergunto porque busquei "${l.nicho.toLowerCase()} ${l.cidade}" e o ` +
      `${l.nome} não aparece bem — e é o primeiro lugar que cliente novo ` +
      `vai procurar.\n\n` +
      (en?.achado ? `${en.achado}\n\n` : "") +
      `Montei uma versão de teste de site pro ${l.nome}. Quer dar uma olhada?`,
  },
  email: {
    A: (l, en) =>
      `Assunto: Uma prévia de site que preparei pro ${l.nome}\n\n` +
      `Olá, tudo bem?\n\n` +
      `Encontrei o ${l.nome} no Google Maps (${l.avaliacoes} avaliações, ` +
      `nota ${l.nota}) aqui em ${l.cidade}.\n\n` +
      `${cap(l.queixa)}\n\n` +
      (en?.achado ? `${en.achado}\n\n` : "") +
      `Montei uma versão de teste personalizada, só pra mostrar como ficaria. ` +
      `Sem compromisso — quer que eu mande o link?\n\n` +
      `Abraço,\n[Seu nome]\n[Telefone]`,
    B: (l, en) =>
      `Assunto: vocês aparecem quando buscam "${l.nicho.toLowerCase()} em ${l.cidade}"?\n\n` +
      `Olá!\n\nFiz um teste rápido: busquei isso no Google e o ${l.nome} ` +
      `${l.temSite ? "apareceu, mas abaixo dos concorrentes" : "não apareceu"}.\n\n` +
      `${cap(l.queixa)}\n\n` +
      (en?.achado ? `${en.achado}\n\n` : "") +
      `Montei uma prévia de site pro ${l.nome}. Mando o link e você decide ` +
      `se vale a pena.\n\nAbraço,\n[Seu nome]\n[Telefone]`,
  },
  instagram: {
    A: (l, en) =>
      `Oi, ${l.nome}! 👋\n\nVi vocês no Maps — ${l.avaliacoes} avaliações é ` +
      `bastante, parabéns!\n\n${cap(l.queixa)}\n\n` +
      (en?.achado ? `${en.achado}\n\n` : "") +
      `Montei uma prévia de site com a cara de vocês. Posso mandar o link?`,
    B: (l, en) =>
      `Fala! Tudo certo?\n\nAchei o perfil do ${l.nome} e ${l.queixa}\n\n` +
      (en?.achado ? `${en.achado}\n\n` : "") +
      `Se quiser, monto uma prévia de site — 2 minutos pra ver e você ` +
      `decide se faz sentido. Sem cobrar nada pra ver.`,
  },
};

const FOLLOW_UP = (l) =>
  `Oi de novo, ${l.nome}! Passando aqui — conseguiu olhar o site de teste?\n\n` +
  `Se quiser, faço uma ligação de 5 minutos mostrando o que dá pra ativar ` +
  `(tipo agendamento direto pelo WhatsApp). Dar uma olhada não custa nada.`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. ARGUMENTOS
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf("--" + name);
  return i !== -1 ? args[i + 1] : undefined;
};
const has = (name) => args.includes("--" + name);
const LIMIT = parseInt(opt("limit") || "20", 10);
const CANAL = (opt("canal") || "whatsapp").toLowerCase();
const DEMO = opt("demo");
const RELAXED = has("relaxed");

const isCelular = (tel) => {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return /^\d{2}9\d{8}$/.test(d);
};

const slugify = (s) =>
  (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// ─────────────────────────────────────────────────────────────────────────────
// 3. STATUS (memória entre execuções) — com migração do formato antigo
// ─────────────────────────────────────────────────────────────────────────────

let db = { leads: {}, aprendizado: { nichos: {}, canais: {}, site: {} } };
if (existsSync(STATUS_PATH)) {
  const raw = JSON.parse(readFileSync(STATUS_PATH, "utf8"));
  if (raw && typeof raw === "object" && "leads" in raw) {
    db = { ...db, ...raw, leads: raw.leads || {}, aprendizado: raw.aprendizado || db.aprendizado };
  } else {
    db.leads = raw; // formato v1: mapa flat
  }
}
const save = () => writeFileSync(STATUS_PATH, JSON.stringify(db, null, 2), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// 4. APRENDIZADO (score adaptativo) — deriva estatísticas do status
// ─────────────────────────────────────────────────────────────────────────────

function resetAprendizado() {
  db.aprendizado = { nichos: {}, canais: {}, site: {} };
  save();
  console.log("🧹 Memória de aprendizado zerada.");
  process.exit(0);
}

function derivarStats() {
  const stats = { nichos: {}, canais: {}, site: { com: { enviado: 0, respondeu: 0 }, sem: { enviado: 0, respondeu: 0 } } };
  const bump = (o, k) => (o[k] = o[k] || { enviado: 0, respondeu: 0, fechado: 0 });
  const RESPONDEU = ["respondeu", "proposto", "fechado"];
  const ENVIADO = ["enviado", "visualizado", ...RESPONDEU];
  for (const e of Object.values(db.leads)) {
    if (ENVIADO.includes(e.state)) {
      bump(stats.nichos, e.nicho).enviado++;
      bump(stats.canais, e.canal).enviado++;
      stats.site[e.temSite ? "com" : "sem"].enviado++;
    }
    if (RESPONDEU.includes(e.state)) {
      bump(stats.nichos, e.nicho).respondeu++;
      bump(stats.canais, e.canal).respondeu++;
      stats.site[e.temSite ? "com" : "sem"].respondeu++;
    }
    if (e.state === "fechado") bump(stats.nichos, e.nicho).fechado++;
  }
  return stats;
}

function aprender() {
  const stats = derivarStats();
  const ap = db.aprendizado;
  ap.nichos = {};
  for (const [nicho, s] of Object.entries(stats.nichos)) {
    const rate = s.enviado >= AMOSTRA_MINIMA ? s.respondeu / s.enviado : null;
    ap.nichos[nicho] = {
      enviado: s.enviado, respondeu: s.respondeu, fechado: s.fechado,
      taxa: rate === null ? null : +(rate * 100).toFixed(1),
      pontuacao: rate === null ? 0
        : rate >= 0.3 ? +3 : rate >= 0.15 ? +2 : rate >= 0.08 ? +1
        : -2,
    };
  }
  ap.canais = {};
  for (const [canal, s] of Object.entries(stats.canais)) {
    const rate = s.enviado >= AMOSTRA_MINIMA ? s.respondeu / s.enviado : null;
    ap.canais[canal] = {
      enviado: s.enviado, respondeu: s.respondeu,
      taxa: rate === null ? null : +(rate * 100).toFixed(1),
    };
  }
  // aprende: leads COM site respondem menos? então vale mais pontuar os SEM
  const { com, sem } = stats.site;
  ap.site = {
    com: { enviado: com.enviado, respondeu: com.respondeu },
    sem: { enviado: sem.enviado, respondeu: sem.respondeu },
    pontuacaoSemSite: 0,
  };
  if (com.enviado >= AMOSTRA_MINIMA && sem.enviado >= AMOSTRA_MINIMA) {
    const rcom = com.respondeu / com.enviado, rsem = sem.respondeu / sem.enviado;
    ap.site.pontuacaoSemSite = rsem > rcom * 1.5 ? +1 : rcom > rsem * 1.5 ? -1 : 0;
  }
  save();
  return { stats, ap };
}

function resumoAprendizado(ap) {
  const linhas = [];
  const bone = Object.entries(ap.nichos).filter(([, v]) => v.pontuacao);
  if (bone.length) {
    for (const [nicho, v] of bone.sort((a, b) => b[1].pontuacao - a[1].pontuacao).slice(0, 5))
      linhas.push(`  ${v.pontuacao > 0 ? "📈" : "📉"} ${nicho}: ${v.respondeu}/${v.enviado} respostas (${v.taxa}%) → ${v.pontuacao > 0 ? "+" : ""}${v.pontuacao} pts`);
  } else linhas.push(`  Ainda sem amostras suficientes (mín. ${AMOSTRA_MINIMA} envios por nicho).`);
  if (ap.site.pontuacaoSemSite) linhas.push(`  ${ap.site.pontuacaoSemSite > 0 ? "📈" : "📉"} leads SEM site: ajuste ${ap.site.pontuacaoSemSite > 0 ? "+" : ""}${ap.site.pontuacaoSemSite} (comparado a quem já tem site)`);
  return linhas.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. MODO --status  /  --memoria  /  --reset-memoria
// ─────────────────────────────────────────────────────────────────────────────

if (has("reset-memoria")) resetAprendizado();
if (has("memoria")) {
  console.log("🧠 Aprendizado atual:\n" + resumoAprendizado(db.aprendizado));
  process.exit(0);
}

if (has("funil")) {
  const ORDEM = ["na_fila", "enviado", "visualizado", "respondeu", "proposto", "fechado", "descartado"];
  const contar = {};
  for (const s of ORDEM) contar[s] = 0;
  let semEstado = 0;
  for (const e of Object.values(db.leads)) {
    if (e.state in contar) contar[e.state]++;
    else semEstado++;
  }
  const total = Object.values(db.leads).length;
  const enviados = ORDEM.slice(1, 6).reduce((a, s) => a + contar[s], 0);
  const resp = contar.respondeu + contar.proposto + contar.fechado;
  console.log(`📊 Funil — ${total} leads na memória${semEstado ? ` (+${semEstado} sem estado)` : ""}`);
  for (const s of ORDEM) if (contar[s]) console.log(`  ${s}: ${contar[s]}`);
  if (enviados)
    console.log(`  → taxa de resposta: ${(100 * resp / enviados).toFixed(1)}% · propostos: ${contar.proposto} · fechados: ${contar.fechado}`);
  else console.log("  ainda nada enviado — rode uma fila primeiro.");
  process.exit(0);
}

if (has("status")) {
  const chave = opt("status");
  const estado = args[args.indexOf("--status") + 2];
  if (!chave || !estado || !ESTADOS.includes(estado)) {
    console.error(`uso: --status <ID|nome> <${ESTADOS.join("|")}>`);
    process.exit(1);
  }
  const alvo = Object.values(db.leads).find(
    (e) => String(e.id) === chave || (e.nome || "").toLowerCase().includes(chave.toLowerCase())
  );
  if (!alvo) { console.error(`❌ lead "${chave}" não encontrado no status.json`); process.exit(1); }
  alvo.state = estado;
  alvo.atualizado = new Date().toLocaleDateString("pt-BR");
  save();
  const { ap } = aprender();
  console.log(`✅ ${alvo.nome} → ${estado}`);
  console.log("🧠 Aprendizado atualizado:\n" + resumoAprendizado(ap));
  process.exit(0);
}

const leadFile = args.find((a) => !a.startsWith("--"));
if (!leadFile) {
  console.error(
    "uso:\n  node gerar-fila.mjs <leads.json> [--limit N] [--canal whatsapp|email|instagram] [--demo URL]\n  node gerar-fila.mjs --status <ID|nome> <estado>\n  node gerar-fila.mjs --memoria\n  node gerar-fila.mjs --funil"
  );
  process.exit(1);
}
if (!MENSAGENS[CANAL]) {
  console.error(`canal inválido: ${CANAL} (use whatsapp | email | instagram)`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. NORMALIZAR E PONTUAR LEADS
// ─────────────────────────────────────────────────────────────────────────────

const raw = readFileSync(leadFile, "utf8").trim();
let leadsJson = [];
if (raw.startsWith("[")) leadsJson = JSON.parse(raw);
else leadsJson = raw.split(/\r?\n/).filter(Boolean).map((ln) => JSON.parse(ln));

const cidadeDe = (lead) => {
  const c = lead.complete_address?.city || "";
  if (c) return c;
  const parts = (lead.address || "").split(",");
  return (parts[parts.length - 2] || parts[0] || "sua região").trim();
};

function extractInstagram(raw = "") {
  const m = String(raw || "").match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (!m) return null;
  const handle = m[1].replace(/\/$/, "");
  if (!handle || /^(p|reel|reels|stories|explore|accounts|tv)$/i.test(handle)) return null;
  return { handle: `@${handle}`, url: `https://www.instagram.com/${handle}/` };
}

function queixa(lead) {
  if (!lead.web_site) return "só senti falta de um site — o perfil do Maps é bom, mas quem busca fora dele não encontra";
  if ((lead.review_rating || 0) >= 4.7 && (lead.review_count || 0) >= 20)
    return `a nota de vocês é excelente, então fiquei curioso de como é essa reputação online`;
  if ((lead.review_count || 0) < 15)
    return "vi que o perfil de vocês no Google tem pouco conteúdo — pouca gente te encontra por lá";
  return "tem bastante melhoria que dá pra fazer no que existe de vocês na internet";
}

const emailsDe = (e) =>
  Array.isArray(e.emails)
    ? e.emails.map((t) => String(t).trim()).filter(Boolean)
    : String(e.emails || "").split(/[,;\s]+/)
        .filter((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));

const normalizar = (e) => {
  const l = {
    key: e.cid || e.place_id || e.link,
    nome: e.title || "",
    nicho: e.category || (e.categories || [])[0] || "negócio",
    cats: [e.category, ...(e.categories || [])].filter(Boolean).join(", ").toLowerCase(),
    cidade: cidadeDe(e),
    avaliacoes: e.review_count || 0,
    nota: e.review_rating || 0,
    telefone: (e.phone || "").replace(/[^\d+]/g, ""),
    site: e.web_site || e.website || "",
    emails: emailsDe(e),
    cnpj: String(e.cnpj || "").replace(/\D/g, ""),
  };
  const isSocialUrl = /instagram\.com|facebook\.com|linktr\.ee|wa\.me|whatsapp\.com|tiktok\.com/i.test(l.site);
  l.temSite = l.site.length > 0 && !isSocialUrl;
  const igFromField = e.instagram
    ? (extractInstagram(e.instagram) || (() => {
        const h = String(e.instagram).trim().replace(/^@/, "").replace(/\/$/, "");
        return h ? { handle: `@${h}`, url: `https://www.instagram.com/${h}/` } : null;
      })())
    : null;
  l.instagram = igFromField || extractInstagram(l.site);
  l.temInsta = !!l.instagram;
  l.temTel = l.telefone.replace(/\D/g, "").length >= 10;
  l.isCelular = isCelular(l.telefone);
  l.temEmail = l.emails.length > 0;
  l.queixa = queixa(e);
  return l;
};

const leads = leadsJson.map(normalizar).filter((l) => l.nome && l.key);

// pontuação BASE + aprendizado
const pontosDo = (l) => {
  let s = 0, breakdown = [];
  const add = (p, why) => { s += p; if (p !== 0) breakdown.push(`${p > 0 ? "+" : ""}${p} ${why}`); };
  if (!l.temSite) add(3, "sem site (maior chance de fechar)");
  if (l.isCelular) add(2, "celular válido (WhatsApp provável)");
  else if (l.temTel) add(1, "tem telefone fixo");
  if (l.temEmail) add(1, "tem e-mail");
  if (l.temInsta) add(1, `Instagram ${l.instagram.handle}`);
  if (l.nota >= 4.5 && l.avaliacoes >= 15) add(2, "estabelecido (nota + avaliações)");
  if (l.avaliacoes >= 50) add(1, "movimento forte");
  if (NICHOS_QUE_COMPRAM.some((n) => l.cats.includes(n))) add(2, "nicho que costuma comprar");
  const nicheKey = l.nicho.trim().toLowerCase();
  const apN = Object.entries(db.aprendizado.nichos).find(([k, v]) => nicheKey.includes(k) || k.includes(nicheKey));
  if (apN && apN[1].pontuacao) add(apN[1].pontuacao, `histórico de ${apN[0]} (${apN[1].taxa}% respondeu)`);
  if (!l.temSite && db.aprendizado.site?.pontuacaoSemSite) add(db.aprendizado.site.pontuacaoSemSite, "histórico de SEM site");
  return { score: s, breakdown };
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. ENRIQUECIMENTO — abre o site real do lead
// ─────────────────────────────────────────────────────────────────────────────

const FLAGS_SITE = [
  ["orçamento", "tem pedido de orçamento no site"],
  ["agendamento|agenda online|marcar consulta", "tem agendamento online (vira cobrança de manutenção)"],
  ["delivery|pedidos online", "tem pedido/delivery pelo site"],
  ["cardápio", "tem cardápio digital"],
  ["trabalhe conosco|vagas", "contrata gente (opera de verdade)"],
  ["whatsapp|whats", "usa WhatsApp no atendimento"],
];

async function enriquecer(l) {
  if (!l.temSite) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(l.site, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    const rawHtml = (await res.text()).slice(0, 400000);
    const html = rawHtml.toLowerCase();
    // site bloqueado (Cloudflare/403) responde "ok-ish" com HTML mínimo:
    // sem título e quase vazio → é o gatilho do fallback Stealth
    if (!res.ok || html.length < 500) {
      const via2 = enriquecerViaScrapling(l.site);
      if (via2) return via2;
      if (!res.ok) return { erro: true, achado: null, detail: [`o site respondeu com erro ${res.status} (vale começar a mensagem citando o site fora do ar)`] };
    }
    if (!l.instagram) {
      const ig = extractInstagram(rawHtml);
      if (ig) {
        l.instagram = ig;
        l.temInsta = true;
      }
    }
    const titulo = (html.match(/<title[^>]*>([^<]+)<\/title>/) || [])[1]?.trim();
    const achadas = FLAGS_SITE.filter(([pat]) => new RegExp(pat).test(html)).map(([, txt]) => txt);
    const temHttps = l.site.startsWith("https://");
    const detalhe = [];
    if (titulo) detalhe.push(`Site oficial se chama "${titulo}"`);
    if (achadas.length) detalhe.push(`Reparei que ${achadas.join(" e ")}`);
    if (!temHttps) detalhe.push("o site ainda roda em HTTP (sem HTTPS)");
    return {
      achado: detalhe.length ? `Direto do site de vocês: ${detalhe[0]}${detalhe[1] ? " — e " + detalhe[1] : ""}.` : null,
      detail: detalhe,
    };
  } catch {
    clearTimeout(t);
    // FALLBACK ADITIVO (Scrapling): site bloqueou o fetch básico
    // (Cloudflare/403) — tenta stealth via scrapling-fetch.py.
    // O Python não está disponível? Segue o erro original como antes.
    const via2 = enriquecerViaScrapling(l.site);
    if (via2) return via2;
    return { erro: true, achado: null, detail: ["não consegui abrir o site (pode estar fora do ar ou lento — vale citar isso!"] };
  }
}

function enriquecerViaScrapling(site) {
  const cli = resolve(__dirname, "scrapling-fetch.py");
  const padroes = JSON.stringify(FLAGS_SITE);
  try {
    const out = execFileSync("python", [cli, site, padroes], {
      encoding: "utf8",
      timeout: 45000,
      windowsHide: true,
    });
    const i = out.indexOf("{");
    if (i === -1) return null;
    const data = JSON.parse(out.slice(i, out.lastIndexOf("}") + 1));
    if (data.erro || !data.title && !(data.flags || []).length) return null;
    const detalhe = [];
    if (data.title) detalhe.push(`Site oficial se chama "${data.title}"`);
    if (data.flags?.length) detalhe.push(`Reparei que ${data.flags.join(" e ")}`);
    if (data.http) detalhe.push("o site ainda roda em HTTP (sem HTTPS)");
    return {
      achado: detalhe.length ? `Direto do site de vocês: ${detalhe[0]}${detalhe[1] ? " — e " + detalhe[1] : ""}.` : null,
      detail: detalhe,
      via: "scrapling",
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7b. VALIDAÇÃO FISCAL (BrasilAPI — ATIVA, não-MEI, >= 3 anos)
// ─────────────────────────────────────────────────────────────────────────────

async function consultarCnpjBrasilApi(cnpj) {
  const clean = String(cnpj || "").replace(/\D/g, "");
  if (clean.length !== 14) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WinsHub/1.0)", Accept: "application/json" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    const ativa = String(d.descricao_situacao_cadastral || "").toUpperCase() === "ATIVA";
    const mei = d.opcao_pelo_mei === true;
    let anos = null;
    if (d.data_inicio_atividade) {
      const inicio = new Date(d.data_inicio_atividade);
      if (!Number.isNaN(inicio.getTime())) {
        anos = Math.floor((Date.now() - inicio.getTime()) / (365.25 * 86400000));
      }
    }
    return {
      cnpj: clean,
      razao: d.razao_social || "",
      ativa,
      mei,
      anos,
      porte: d.porte || "",
      aprovado: ativa && !mei && (anos === null || anos >= 3),
    };
  } catch {
    clearTimeout(t);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. SELECIONAR A FILA
// ─────────────────────────────────────────────────────────────────────────────

const podeContatar =
  CANAL === "email" ? (l) => l.temEmail
  : CANAL === "instagram" ? () => true
  : (l) => l.temTel;

const passaIcpEstrito = (l) => {
  if (RELAXED) return true;
  if (l.nota < 4.0) return false;
  if (l.avaliacoes < 15) return false;
  if (CANAL === "whatsapp" && !l.isCelular) return false;
  return true;
};

const seguinteId = 1 + Math.max(0, ...Object.values(db.leads).map((e) => e.id || 0));

const elegiveis = leads
  .filter(podeContatar)
  .filter((l) => !db.leads[l.key]);

const filtradosIcp = elegiveis.filter(passaIcpEstrito);
if (!RELAXED && elegiveis.length > 0 && filtradosIcp.length === 0) {
  console.log("⚠️  Nenhum lead passou no filtro ICP estrito (nota >= 4.0, >= 15 avaliações, celular). Use --relaxed para liberar todos.");
}

const candidatos = filtradosIcp
  .map((l) => { const p = pontosDo(l); return { ...l, score: p.score, breakdown: p.breakdown }; })
  .sort((a, b) => b.score - a.score)
  .slice(0, LIMIT);

// follow-ups: enviados há ≥2 dias sem resposta
const DIAS_ATRAS = (dt) => {
  const [d, m, y] = dt.split("/").map(Number);
  return Math.floor((Date.now() - new Date(y, m - 1, d)) / 86400000);
};
const followUps = Object.values(db.leads).filter(
  (e) => ["enviado", "visualizado"].includes(e.state) &&
         e.emitido && DIAS_ATRAS(e.emitido) >= 2
).map((e) => ({ ...e, diasAtras: DIAS_ATRAS(e.emitido) }));

// ─────────────────────────────────────────────────────────────────────────────
// 9. EXECUTAR (enriquecer + gerar fila.md)
// ─────────────────────────────────────────────────────────────────────────────

const { ap } = aprender();
const candidatosFinais = [];
for (const l of candidatos) {
  if (l.cnpj) {
    l.fiscal = await consultarCnpjBrasilApi(l.cnpj);
    if (!RELAXED && l.fiscal && !l.fiscal.aprovado) {
      console.log(`⏭️  ${l.nome} descartado no filtro fiscal (CNPJ ${l.fiscal.cnpj}: ativa=${l.fiscal.ativa}, mei=${l.fiscal.mei}, anos=${l.fiscal.anos})`);
      continue;
    }
    if (l.fiscal?.aprovado) {
      l.score += 2;
      l.breakdown.push("+2 CNPJ ativo não-MEI >= 3 anos");
    }
  }
  l.en = await enriquecer(l);
  candidatosFinais.push(l);
}

const hoje = new Date().toLocaleDateString("pt-BR");
let md = `# Fila de prospecção — ${hoje}\n\nCanal: **${CANAL}** · ${candidatosFinais.length} leads (limite ${LIMIT})\n\n`;
md += `> 🧠 **Aprendizado do sistema**\n- ` + resumoAprendizado(ap).replace(/\n/g, "\n- ") + "\n\n";
md += `> ⚠️ Taxiamento: máximo **20 msgs/dia** por canal; personalize com o\n> detalhe real de cada lead (🔎 abaixo); follow-up máx. 2.\n\n`;

if (followUps.length) {
  md += `## 🔁 Follow-ups de hoje\n\n`;
  for (const e of followUps) {
    md += `**${e.nome}** (${e.state} há ${e.diasAtras} dias · ID ${e.id}) · contato: ${e.telefone || e.email || e.canal}\n\n\`\`\`\n${FOLLOW_UP({ nome: e.nome })}\n\`\`\`\n\n`;
  }
}

let i = 0;
for (const l of candidatosFinais) {
  i++;
  const id = seguinteId + i - 1;
  const variante = i % 2 === 1 ? "A" : "B";
  const msg = MENSAGENS[CANAL][variante](l, l.en);
  const alvo = CANAL === "email" ? l.emails[0]
    : CANAL === "instagram" ? (l.instagram ? `${l.instagram.handle} (${l.instagram.url})` : "_buscar @ do negócio_")
    : l.telefone;
  const demoUrl = DEMO ? `${DEMO.replace(/\/+$/, "")}/${slugify(l.nome)}` : "";

  md += `\n---\n## ${i}. ${l.nome} · score ${l.score} ${l.temSite ? "🟡" : "🔴"}\n\n`;
  md += `- **ID p/ status:** \`${id}\`\n- **Contato ${CANAL}:** ${alvo}\n`;
  if (demoUrl) md += `- **Demo:** ${demoUrl}\n`;
  md += `- **Local:** ${l.cidade} · nota ${l.nota} (${l.avaliacoes} avaliações)\n`;
  md += `- **Categoria:** ${l.nicho}\n- **Por que esse score:** ${l.breakdown.join(", ") || "base"}\n`;
  if (l.en?.erro) md += `- **🔴 Site FORA DO AR** (vale começar a mensagem citando isso!)\n`;
  else if (l.en?.detail?.length) md += `- **🔎 Do site dele:** ${l.en.detail.join(" · ")}\n`;
  md += `\n**Mensagem (variante ${variante}):**\n\n\`\`\`\n${msg}\n\`\`\`\n\n`;
  md += `- [ ] enviado\n- [ ] visualizado\n- [ ] respondeu → \`node gerar-fila.mjs --status ${id} respondeu\`\n\n`;

  db.leads[l.key] = {
    id, nome: l.nome, nicho: l.nicho, cidade: l.cidade,
    telefone: l.telefone, email: CANAL === "email" ? l.emails[0] : "",
    instagram: l.instagram?.handle || "", instagramUrl: l.instagram?.url || "",
    site: l.site, temSite: l.temSite,
    score: l.score, canal: CANAL, state: "na_fila", emitido: hoje,
    variante, msg, demo_url: demoUrl,
  };
}

if (candidatosFinais.length === 0)
  md += `\n*Sem leads novos. Rode o scraper de novo ou apague \`status.json\` p/ recomeçar.*\n`;

writeFileSync(FILA_PATH, md, "utf8");
save();

console.log(`✅ fila.md — ${candidatos.length} leads · canal ${CANAL}${followUps.length ? ` · ${followUps.length} follow-up(s)` : ""}`);
const semSite = candidatos.filter((l) => !l.temSite).length;
console.log(`   🔴 sem site: ${semSite} · 🟡 com site: ${candidatos.length - semSite}`);
console.log(`\n🧠 Aprendizado:\n${resumoAprendizado(ap)}`);
console.log(`\nDepois de enviar: node gerar-fila.mjs --status <ID> <${ESTADOS.join("|")}>`);
