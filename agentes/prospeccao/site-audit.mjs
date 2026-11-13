// site-audit.mjs — Auditoria rápida de Qualidade + Segurança + Stack/Pixels + CNPJ (BrasilAPI) + Lighthouse
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export function extractInstagramFromText(text = "") {
  const m = String(text || "").match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/i)
    || String(text || "").match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (!m) return null;
  const handle = m[1].replace(/\/$/, "");
  if (!handle || /^(p|reel|reels|stories|explore|accounts|tv|share)$/i.test(handle)) return null;
  return { handle: `@${handle}`, url: `https://www.instagram.com/${handle}/` };
}

export function detectStack(html = "", headers = null) {
  const lower = String(html).toLowerCase();
  const stack = [];
  const add = (name) => { if (!stack.includes(name)) stack.push(name); };

  if (/wp-content|wp-includes|wordpress/i.test(lower)) add("WordPress");
  if (/elementor/i.test(lower)) add("Elementor");
  if (/wix\.com|wixstatic\.com|x-wix-/i.test(lower)) add("Wix");
  if (/cdn\.shopify\.com|shopify\.com/i.test(lower)) add("Shopify");
  if (/nuvemshop|tiendanube|mitiendanube/i.test(lower)) add("Nuvemshop");
  if (/webflow\.com|data-wf-site/i.test(lower)) add("Webflow");
  if (/squarespace\.com/i.test(lower)) add("Squarespace");
  if (/rdstation|d335luupugsy2\.cloudfront\.net/i.test(lower)) add("RD Station");
  if (/__next_data__|\/_next\/static/i.test(lower)) add("Next.js");
  if (/bootstrap/i.test(lower)) add("Bootstrap");
  if (headers?.get?.("server")?.toLowerCase().includes("cloudflare") || headers?.get?.("cf-ray")) add("Cloudflare");
  return stack;
}

export function detectPixels(html = "") {
  const lower = String(html).toLowerCase();
  const pixels = [];
  const add = (name) => { if (!pixels.includes(name)) pixels.push(name); };

  if (/fbq\(|connect\.facebook\.net\/.*\/fbevents\.js/i.test(lower)) add("Meta Pixel");
  if (/googletagmanager\.com\/gtm\.js/i.test(lower)) add("Google Tag Manager");
  if (/gtag\(|google-analytics\.com|googletagmanager\.com\/gtag/i.test(lower)) add("Google Analytics");
  if (/googleadservices\.com|aw-\d{6,}/i.test(lower)) add("Google Ads");
  if (/analytics\.tiktok\.com/i.test(lower)) add("TikTok Pixel");
  if (/static\.hotjar\.com/i.test(lower)) add("Hotjar");
  return pixels;
}

export function extractCnpj(html = "") {
  const m = String(html).match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
  return m ? m[1] : "";
}

export async function lookupCnpj(cnpjFormatted = "") {
  const digits = String(cnpjFormatted).replace(/\D/g, "");
  if (digits.length !== 14) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const d = await res.json();
    const socios = Array.isArray(d.qsa)
      ? d.qsa.map((s) => s.nome_socio).filter(Boolean).slice(0, 2)
      : [];
    return {
      cnpj: cnpjFormatted,
      razaoSocial: d.razao_social || "",
      porte: d.porte || "",
      situacao: d.descricao_situacao_cadastral || "",
      abertura: d.data_inicio_atividade || "",
      socios,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function auditSite(rawUrl, leadName = "") {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WinsHubAudit/1.0)" },
    });
    const html = await res.text();
    clearTimeout(timer);
    const loadMs = Date.now() - t0;
    const finalUrl = res.url || url;
    const lower = html.toLowerCase();

    // 1. Segurança (0-100)
    const httpsOk = finalUrl.startsWith("https://");
    const hstsOk = !!res.headers.get("strict-transport-security");
    const nosniffOk = !!res.headers.get("x-content-type-options");
    const frameCspOk = !!(res.headers.get("x-frame-options") || res.headers.get("content-security-policy"));

    let securityScore = 0;
    if (httpsOk) securityScore += 40;
    if (hstsOk) securityScore += 20;
    if (nosniffOk) securityScore += 20;
    if (frameCspOk) securityScore += 20;

    // 2. Qualidade & Conversão (0-100)
    const statusOk = res.ok;
    const viewportOk = /<meta[^>]+name=["']viewport["']/i.test(lower);
    const whatsappOk = /wa\.me|api\.whatsapp\.com|whatsapp/i.test(lower);
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "";
    const titleOk = title.length >= 15 && title.length <= 75;
    const descOk = /<meta[^>]+name=["']description["'][^>]*content=["'][^"']{25,}/i.test(html);
    const ogOk = /property=["']og:title["']/i.test(lower) && /property=["']og:image["']/i.test(lower);
    const speedOk = loadMs < 1500;

    let qualityScore = 0;
    if (statusOk) qualityScore += 15;
    if (viewportOk) qualityScore += 20;
    if (whatsappOk) qualityScore += 20;
    if (titleOk) qualityScore += 15;
    if (descOk) qualityScore += 10;
    if (ogOk) qualityScore += 10;
    if (speedOk) qualityScore += 10;

    const score = Math.round(securityScore * 0.4 + qualityScore * 0.6);

    const problems = [];
    if (!statusOk) problems.push(`Site retornou erro HTTP ${res.status}`);
    if (!httpsOk) problems.push("Sem HTTPS (navegador exibe 'Não Seguro')");
    if (!viewportOk) problems.push("Sem ajuste mobile (viewport)");
    if (!whatsappOk) problems.push("Sem botão direto para WhatsApp");
    if (!hstsOk && !frameCspOk) problems.push("Sem cabeçalhos básicos de segurança (HSTS/CSP)");
    if (!speedOk) problems.push(`Carregamento lento (${(loadMs / 1000).toFixed(1)}s)`);
    if (!ogOk) problems.push("Sem Open Graph (link compartilhado fica sem prévia)");

    const stack = detectStack(html, res.headers);
    const pixels = detectPixels(html);
    const cnpj = extractCnpj(html);
    const empresaInfo = cnpj ? await lookupCnpj(cnpj) : null;

    if (!pixels.includes("Meta Pixel") && !pixels.includes("Google Ads")) {
      problems.push("Sem Pixel de anúncios (Meta/Google Ads)");
    }

    const ig = extractInstagramFromText(html);
    const top2 = problems.slice(0, 2).join(" e ").toLowerCase();
    const pitch = problems.length
      ? `Olá! Analisei o site da ${leadName || "empresa"} (${finalUrl}) — nota técnica ${score}/100. Notei ${top2}. Posso te enviar uma prévia gratuita de uma versão atualizada, rápida e segura?`
      : `Olá! O site da ${leadName || "empresa"} está bem estruturado (${score}/100). Se quiser aumentar ainda mais os agendamentos no WhatsApp, temos um modelo focado em conversão.`;

    return {
      ok: true,
      url: finalUrl,
      score,
      securityScore,
      qualityScore,
      loadMs,
      https: httpsOk,
      mobile: viewportOk,
      whatsappBtn: whatsappOk,
      stack,
      pixels,
      cnpj,
      empresaInfo,
      problems: problems.slice(0, 6),
      instagram: ig?.handle || "",
      instagramUrl: ig?.url || "",
      pitch,
      auditedAt: new Date().toISOString(),
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      url,
      score: 0,
      securityScore: 0,
      qualityScore: 0,
      loadMs: Date.now() - t0,
      https: false,
      mobile: false,
      whatsappBtn: false,
      problems: [`Site fora do ar ou bloqueado (${e?.name === "AbortError" ? "timeout >7s" : e.message})`],
      instagram: "",
      instagramUrl: "",
      pitch: `Olá! Tentei abrir o site da ${leadName || "empresa"} (${url}) e ele está fora do ar ou muito lento. Posso te mandar uma prévia de um site novo pronto para o Google e WhatsApp?`,
      auditedAt: new Date().toISOString(),
    };
  }
}

export async function runLighthouse(rawUrl, leadName = "") {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const { stdout } = await execFileAsync(
    "lighthouse",
    [
      url,
      "--output=json",
      "--quiet",
      "--only-categories=performance,seo,accessibility,best-practices",
      "--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage",
    ],
    {
      env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || "/snap/bin/chromium" },
      timeout: 65000,
      maxBuffer: 15 * 1024 * 1024,
    }
  );
  const d = JSON.parse(stdout);
  const c = d.categories || {};
  const pct = (cat) => (cat?.score != null ? Math.round(cat.score * 100) : null);
  const perf = pct(c.performance);
  const seo = pct(c.seo);
  const acc = pct(c.accessibility);
  const bp = pct(c["best-practices"]);
  const lcp = d.audits?.["largest-contentful-paint"]?.displayValue || "";
  const fcp = d.audits?.["first-contentful-paint"]?.displayValue || "";

  const pitch = perf !== null && perf < 70
    ? `Olá! Rodei o teste oficial do Google (Lighthouse) no site da ${leadName || "empresa"} (${url}): a Performance Mobile deu ${perf}/100${lcp ? ` (carregamento principal em ${lcp})` : ""} e SEO ${seo ?? "-"}/100. Isso faz perder clientes no celular. Posso te enviar uma prévia gratuita de uma versão ultra rápida?`
    : `Olá! Rodei o Google Lighthouse no site da ${leadName || "empresa"} (${url}): Performance ${perf ?? "-"}/100 e SEO ${seo ?? "-"}/100. Se quiser transformar mais dessas visitas em conversas no WhatsApp, temos uma estrutura focada em conversão.`;

  return {
    ok: true,
    url: d.finalDisplayedUrl || url,
    perf,
    seo,
    acc,
    bp,
    lcp,
    fcp,
    pitch,
    auditedAt: new Date().toISOString(),
  };
}

