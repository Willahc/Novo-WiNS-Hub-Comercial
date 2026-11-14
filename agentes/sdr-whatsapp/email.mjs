// email.mjs — Envio SMTP (Hostinger) + Cold Email Cirúrgico + Cadência D+0 / D+3 / D+7
import nodemailer from "nodemailer";
import { callClaude, logActivity } from "./lib.mjs";
import { auditSite } from "../prospeccao/site-audit.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

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

export async function sendMail({ to, subject, text, html, replyTo }) {
  const fromName = process.env.SMTP_FROM_NAME || "William · WiNS Hub Comercial";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    replyTo: replyTo || fromEmail,
    subject,
    text,
    html: html || text.replace(/\n/g, "<br>"),
  });
  return { messageId: info.messageId, accepted: info.accepted || [] };
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

function fallbackColdEmail(lead, step) {
  const empresa = lead.nome || "sua empresa";
  const cidade = lead.cidade || "sua região";
  const gaps = summarizeAuditForEmail(lead);
  const assinatura = `\n\nWilliam\nWiNS Hub Comercial\ncontato@winshubcomercial.com.br`;

  if (step === 1) {
    return {
      subject: `Diagnóstico rápido do site da ${empresa}`,
      text: `Olá! Tudo bem?\n\nMe chamo William e trabalho com engenharia de conversão e prospecção na WiNS Hub Comercial.\n\nAnalisando a presença digital da ${empresa} em ${cidade} (inclusive as ${lead.avaliacoes || "ótimas"} avaliações no Google), notei um ponto técnico importante: ${gaps.join("; ")}.\n\nNa prática, isso faz clientes que já buscaram pelo serviço acabarem saindo antes de concluir o contato no WhatsApp.\n\nPosso te enviar em 2 minutos um resumo visual de como corrigir isso?${assinatura}`,
    };
  }
  if (step === 2) {
    const extra = lead.previewUrl ? `\nInclusive deixei uma prévia visual pronta aqui: ${lead.previewUrl}\n` : "";
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

export async function buildColdEmail(lead, step = 1) {
  const gaps = summarizeAuditForEmail(lead);
  const sys = `Você escreve cold emails B2B curtos, humanos e consultivos em português do Brasil.
Remetente fixo: William, da WiNS Hub Comercial (contato@winshubcomercial.com.br).
Regras:
- Nunca invente números ou métricas que não estejam nos dados.
- Sem spam, sem palavras exageradas ("imperdível", "revolucionário").
- Máximo 110 palavras no corpo.
- Retorne APENAS JSON válido: {"subject":"...","text":"..."}`;

  const prompt = `Crie o E-mail ${step} de 3 da cadência (D+0=1, D+3=2, D+7=3) para:
- Empresa: ${lead.nome}
- Nicho: ${lead.nicho || "serviços locais"}
- Cidade: ${lead.cidade || ""}
- Avaliações Google: ${lead.avaliacoes || 0} (nota ${lead.notaGoogle || "-"})
- Site: ${lead.site || "não possui"}
- Achados reais do Raio-X: ${gaps.join(" | ")}
- Prévia pronta: ${lead.previewUrl || "não"}`;

  try {
    const raw = await callClaude({ system: sys, messages: [{ role: "user", content: prompt }], maxTokens: 380 });
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(s, e + 1));
    if (parsed.subject && parsed.text) {
      return { subject: String(parsed.subject).trim(), text: String(parsed.text).trim() };
    }
  } catch {}
  return fallbackColdEmail(lead, step);
}

export async function sendLeadEmail(db, key, lead, { step, dryRun = false } = {}) {
  const to = String(lead?.email || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: `Lead #${lead?.id || key} sem e-mail válido` };
  }

  const currentStep = lead.emailCadence?.step || 0;
  const targetStep = Number(step) || Math.min(3, currentStep + 1);

  if (!lead.audit && lead.site) {
    try {
      lead.audit = await auditSite(lead.site);
    } catch {}
  }

  const { subject, text } = await buildColdEmail(lead, targetStep);
  let mailRes = { messageId: "dry-run", accepted: [to] };
  if (!dryRun) {
    mailRes = await sendMail({ to, subject, text });
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
