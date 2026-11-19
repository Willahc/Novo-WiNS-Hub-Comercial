// email.mjs — Envio SMTP (Hostinger) + Cold Email Cirúrgico + Cadência D+0 / D+3 / D+7
import tls from "node:tls";
import { resolveMx } from "node:dns/promises";
import nodemailer from "nodemailer";
import { callClaude, logActivity, qualificarLead, capturePreviewPng } from "./lib.mjs";
import { slugify } from "../entrega/previas/templates.mjs";
import { auditSite } from "../prospeccao/site-audit.mjs";

function previewUrlFor(lead) {
  if (lead?.previewUrl) return lead.previewUrl;
  const base = (process.env.PREVIEW_BASE_URL || "https://winshubcomercial.com.br/previa").replace(/\/$/, "");
  if (!lead?.id || !lead?.nome) return "";
  return `${base}/${lead.id}-${slugify(lead.nome)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const mxCache = new Map();

export async function validateEmailMx(email) {
  const addr = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) {
    return { valid: false, reason: "formato de e-mail inválido" };
  }
  const domain = addr.split("@")[1];
  if (mxCache.has(domain)) return mxCache.get(domain);

  let result = { valid: true };
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise((_, rej) => setTimeout(() => rej(new Error("DNS_TIMEOUT")), 4000)),
    ]);
    if (!Array.isArray(records) || records.length === 0) {
      result = { valid: false, reason: `domínio ${domain} sem registro MX` };
    }
  } catch (err) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA" || err?.code === "ENOTIMP") {
      result = { valid: false, reason: `domínio ${domain} sem MX (${err.code})` };
    }
    // Em timeout transitório de DNS, mantém valid: true para não descartar lead válido.
  }
  mxCache.set(domain, result);
  return result;
}

function getTransporter() {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE !== "false";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error("SMTP_USER ou SMTP_PASS não configurado no .env");
  }
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

export async function verifySmtp() {
  const transporter = getTransporter();
  await transporter.verify();
  return { ok: true, host: process.env.SMTP_HOST || "smtp.hostinger.com", user: process.env.SMTP_USER };
}

function appendToImapSent(rawBuffer) {
  const host = process.env.IMAP_HOST || "imap.hostinger.com";
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const mailbox = process.env.IMAP_SENT_FOLDER || "INBOX.Sent";
  if (!user || !pass || !rawBuffer) return Promise.resolve(false);

  return new Promise((resolve) => {
    let step = 0;
    let buf = "";
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.end(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 6000);
    const sock = tls.connect(port, host);
    sock.on("error", () => finish(false));
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (step === 0 && buf.includes("* OK")) {
        buf = "";
        step = 1;
        sock.write(`a1 LOGIN "${user.replace(/"/g, '\\"')}" "${pass.replace(/"/g, '\\"')}"\r\n`);
      } else if (step === 1 && buf.includes("a1 OK")) {
        buf = "";
        step = 2;
        sock.write(`a2 APPEND "${mailbox}" (\\Seen) {${rawBuffer.length}}\r\n`);
      } else if (step === 2 && buf.includes("+")) {
        buf = "";
        step = 3;
        sock.write(rawBuffer);
        sock.write("\r\n");
      } else if (step === 3 && buf.includes("a2 OK")) {
        step = 4;
        sock.write("a3 LOGOUT\r\n");
        finish(true);
      } else if (/^a\d+ (NO|BAD)/m.test(buf)) {
        finish(false);
      }
    });
  });
}

export async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  const fromName = process.env.SMTP_FROM_NAME || "William · WiNS Hub Comercial";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    replyTo: replyTo || fromEmail,
    subject,
    text,
    html: html || text.replace(/\n/g, "<br>"),
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
  };
  const transporter = getTransporter();
  const info = await transporter.sendMail(mailOptions);

  // Grava cópia na pasta Enviados (INBOX.Sent) via IMAP
  let savedToSent = false;
  try {
    const rawInfo = await nodemailer
      .createTransport({ streamTransport: true, newline: "windows", buffer: true })
      .sendMail({ ...mailOptions, messageId: info.messageId });
    savedToSent = await appendToImapSent(rawInfo.message);
  } catch {}

  return { messageId: info.messageId, accepted: info.accepted || [], savedToSent };
}

function summarizeAuditForEmail(lead) {
  const a = lead.audit || {};
  const gaps = [];
  if (!lead.site) {
    gaps.push("a empresa ainda não possui site próprio (aparece apenas no Google Maps)");
  } else {
    if (a.nota !== undefined && a.nota !== null && a.nota < 70) {
      gaps.push(`nota técnica mobile de ${a.nota}/100 no carregamento/estrutura`);
    }
    if (a.temGTM === false && a.temPixel === false) {
      gaps.push("ausência de Google Tag Manager e Meta Pixel (sem rastreamento de conversões)");
    } else if (a.temPixel === false) {
      gaps.push("ausência de Meta Pixel instalado para rastrear quem vem de anúncios");
    }
    if (a.whatsappOk === false) {
      gaps.push("botão/link de agendamento no WhatsApp sem resposta direta");
    }
  }
  if (!gaps.length) {
    gaps.push("oportunidade de melhorar a taxa de conversão de visitantes do Google direto para o WhatsApp");
  }
  return gaps;
}

function fallbackColdEmail(lead, step, previewUrl = "") {
  const empresa = lead.nome || "sua empresa";
  const cidade = lead.cidade || "sua região";
  const gaps = summarizeAuditForEmail(lead);
  const assinatura = `\n\nWilliam\nWiNS Hub Comercial\ncontato@winshubcomercial.com.br`;

  if (step === 1) {
    const previaBloco = previewUrl
      ? `\n\nInclusive já montei uma prévia personalizada de como ficaria o site da ${empresa}: ${previewUrl}`
      : "";
    return {
      subject: previewUrl ? `Prévia de site pronta para a ${empresa}` : `Diagnóstico rápido do site da ${empresa}`,
      text: `Olá! Tudo bem?\n\nMe chamo William e trabalho com engenharia de conversão e prospecção na WiNS Hub Comercial.\n\nAnalisando a presença digital da ${empresa}${cidade ? ` em ${cidade}` : ""}, notei um ponto técnico importante: ${gaps.join("; ")}.\n\nNa prática, isso faz clientes que já buscaram pelo serviço acabarem não encontrando vocês.${previaBloco}\n\nPosso te explicar em 2 minutos como colocar isso no ar?${assinatura}`,
    };
  }
  if (step === 2) {
    const extra = previewUrl ? `\nInclusive deixei uma prévia visual pronta aqui: ${previewUrl}\n` : "";
    return {
      subject: `Re: Diagnóstico rápido da ${empresa}`,
      text: `Olá! Passando rapidamente para retomar meu e-mail anterior sobre a ${empresa}.\n\nCorrigindo o ponto técnico que identifiquei (${gaps[0]}), você passa a aproveitar melhor cada clique que já chega pelo Google.${extra}\nFaz sentido conversarmos 10 minutos esta semana?${assinatura}`,
    };
  }
  return {
    subject: `Último contato · ${empresa}`,
    text: `Olá! Não quero encher sua caixa de entrada — este é meu último toque sobre o diagnóstico técnico da ${empresa}.\n\nSe em algum momento quiser revisar a conversão do site e do WhatsApp, é só responder este e-mail.${assinatura}`,
  };
}

export async function buildColdEmail(lead, step = 1, { dryRun = false } = {}) {
  const gaps = summarizeAuditForEmail(lead);
  const qual = qualificarLead(lead);
  const previewUrl = qual.usarPrevia ? previewUrlFor(lead) : "";
  if (dryRun) {
    return { ...fallbackColdEmail(lead, step, previewUrl), previewUrl };
  }
  const sys = `Você escreve cold emails B2B curtos, humanos e consultivos em português do Brasil.
Remetente fixo: William, da WiNS Hub Comercial (contato@winshubcomercial.com.br).
Regras:
- Nunca invente números ou métricas que não estejam nos dados.
- Sem spam, sem palavras exageradas ("imperdível", "revolucionário").
- Máximo 110 palavras no corpo.
${previewUrl ? `- Inclua EXATAMENTE este link da prévia personalizada no corpo do e-mail e mencione que a amostra visual segue abaixo: ${previewUrl}` : ""}
- Retorne APENAS JSON válido: {"subject":"...","text":"..."}`;

  const prompt = `Crie o E-mail ${step} de 3 da cadência (D+0=1, D+3=2, D+7=3) para:
- Empresa: ${lead.nome}
- Nicho: ${lead.nicho || "serviços locais"}
- Cidade: ${lead.cidade || ""}
- Avaliações Google: ${lead.avaliacoes || 0} (nota ${lead.notaGoogle || "-"})
- Site: ${lead.site || "não possui"}
- Achados reais do Raio-X: ${gaps.join(" | ")}
- Prévia pronta: ${previewUrl || "não"}`;

  try {
    const raw = await callClaude({
      system: sys,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 380,
      model: process.env.CLAUDE_FAST_MODEL || undefined,
      cacheSystem: true,
    });
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(s, e + 1));
    if (parsed.subject && parsed.text) {
      let text = String(parsed.text).trim();
      if (previewUrl && !text.includes(previewUrl)) {
        text += `\n\nPrévia personalizada: ${previewUrl}`;
      }
      return { subject: String(parsed.subject).trim(), text, previewUrl };
    }
  } catch {}
  return { ...fallbackColdEmail(lead, step, previewUrl), previewUrl };
}

export async function sendLeadEmail(db, key, lead, { step, dryRun = false } = {}) {
  const to = String(lead?.email || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: `Lead #${lead?.id || key} sem e-mail válido` };
  }

  const mx = await validateEmailMx(to);
  if (!mx.valid) {
    if (!dryRun && db?.leads?.[key]) {
      db.leads[key].emailInvalido = true;
      db.leads[key].motivoEmail = mx.reason;
    }
    return { ok: false, error: `E-mail inválido (${to}): ${mx.reason}` };
  }

  const currentStep = lead.emailCadence?.step || 0;
  const targetStep = Number(step) || Math.min(3, currentStep + 1);

  if (!lead.audit && lead.site) {
    try {
      lead.audit = await auditSite(lead.site);
    } catch {}
  }

  const { subject, text, previewUrl } = await buildColdEmail(lead, targetStep, { dryRun });
  let mailRes = { messageId: "dry-run", accepted: [to] };
  if (!dryRun) {
    const qual = qualificarLead(lead);
    const pngPath = qual.usarPrevia ? capturePreviewPng(lead) : null;
    const attachments = pngPath ? [{ filename: "previa-site.png", path: pngPath, cid: "previa-site" }] : [];
    const htmlBody = text.replace(/\n/g, "<br>") + (pngPath
      ? `<br><br><div style="margin-top:12px"><a href="${previewUrl || "#"}" target="_blank" rel="noopener"><img src="cid:previa-site" alt="Prévia do site" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #cbd5e1;display:block"></a></div>`
      : "");
    mailRes = await sendMail({ to, subject, text, html: htmlBody, attachments });
  }

  const now = Date.now();
  const nextDays = targetStep === 1 ? 3 : targetStep === 2 ? 4 : null;
  const history = Array.isArray(lead.emailCadence?.history) ? lead.emailCadence.history : [];
  history.push({
    step: targetStep,
    subject,
    sentAt: new Date(now).toISOString(),
    messageId: mailRes.messageId,
    dryRun: !!dryRun,
  });

  if (!dryRun) {
    lead.emailCadence = {
      step: targetStep,
      lastSentAt: new Date(now).toISOString(),
      nextDueAt: nextDays ? now + nextDays * DAY_MS : null,
      history,
    };
    if (lead.state === "na_fila") {
      lead.state = "enviado";
      lead.sentAt = lead.sentAt || new Date(now).toISOString();
    }
    db.leads[key] = lead;
  }

  logActivity({
    type: "email_sent",
    leadId: lead.id,
    nome: lead.nome,
    email: to,
    step: targetStep,
    subject,
    dryRun: !!dryRun,
  });

  return { ok: true, id: lead.id, nome: lead.nome, to, step: targetStep, subject, text, dryRun: !!dryRun, messageId: mailRes.messageId };
}

export async function runDueEmailCadence(db, { limit = 10, dryRun = false } = {}) {
  const now = Date.now();
  const due = Object.entries(db.leads || {}).filter(([, l]) => {
    if (!l.email || !String(l.email).includes("@")) return false;
    if (l.state === "fechado" || l.state === "descartado" || l.state === "respondeu") return false;
    const c = l.emailCadence;
    return c && c.step >= 1 && c.step < 3 && c.nextDueAt && now >= c.nextDueAt;
  }).slice(0, limit);

  const results = [];
  for (const [key, lead] of due) {
    try {
      results.push(await sendLeadEmail(db, key, lead, { step: (lead.emailCadence.step || 1) + 1, dryRun }));
    } catch (e) {
      results.push({ ok: false, id: lead.id, nome: lead.nome, error: e.message });
    }
  }
  return results;
}

function fetchUnseenInboxSenders() {
  const host = process.env.IMAP_HOST || "imap.hostinger.com";
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return Promise.resolve([]);

  return new Promise((resolve) => {
    let step = 0;
    let buf = "";
    let done = false;
    const senders = new Set();
    const finish = (list) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.end(); } catch {}
      resolve(list);
    };
    const timer = setTimeout(() => finish([...senders]), 8000);
    const sock = tls.connect(port, host);
    sock.on("error", () => finish([]));
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (step === 0 && buf.includes("* OK")) {
        buf = "";
        step = 1;
        sock.write(`a1 LOGIN "${user.replace(/"/g, '\\"')}" "${pass.replace(/"/g, '\\"')}"\r\n`);
      } else if (step === 1 && buf.includes("a1 OK")) {
        buf = "";
        step = 2;
        sock.write(`a2 EXAMINE INBOX\r\n`);
      } else if (step === 2 && buf.includes("a2 OK")) {
        buf = "";
        step = 3;
        sock.write(`a3 SEARCH UNSEEN\r\n`);
      } else if (step === 3 && buf.includes("a3 OK")) {
        const m = buf.match(/\* SEARCH([^\r\n]*)/);
        const ids = (m ? m[1].trim().split(/\s+/).filter((x) => /^\d+$/.test(x)) : []).slice(-30);
        buf = "";
        if (!ids.length) {
          step = 5;
          sock.write("a5 LOGOUT\r\n");
          finish([]);
          return;
        }
        step = 4;
        sock.write(`a4 FETCH ${ids.join(",")} (BODY.PEEK[HEADER.FIELDS (FROM)])\r\n`);
      } else if (step === 4 && buf.includes("a4 OK")) {
        const matches = buf.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        for (const em of matches) senders.add(em.toLowerCase());
        step = 5;
        sock.write("a5 LOGOUT\r\n");
        finish([...senders]);
      } else if (/^a\d+ (NO|BAD)/m.test(buf)) {
        finish([]);
      }
    });
  });
}

export async function checkInboxReplies(db) {
  const senders = await fetchUnseenInboxSenders();
  if (!senders.length) return [];
  const senderSet = new Set(senders);
  const selfEmail = String(process.env.SMTP_USER || "").toLowerCase();
  senderSet.delete(selfEmail);

  const matched = [];
  for (const [key, lead] of Object.entries(db.leads || {})) {
    const em = String(lead?.email || "").trim().toLowerCase();
    if (!em || !senderSet.has(em)) continue;
    if (!lead.emailCadence || lead.emailRepliedAt) continue;

    lead.emailRepliedAt = new Date().toISOString();
    lead.respondedVia = "email";
    if (lead.state !== "fechado" && lead.state !== "descartado") {
      lead.state = "respondeu";
    }
    if (lead.emailCadence) {
      lead.emailCadence.nextDueAt = null;
    }
    db.leads[key] = lead;
    matched.push({ key, id: lead.id, nome: lead.nome, email: em });
  }
  return matched;
}
