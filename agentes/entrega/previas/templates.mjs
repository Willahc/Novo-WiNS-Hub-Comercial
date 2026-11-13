// templates.mjs — Gera prévias de site personalizadas por nicho (HTML único, mobile-first)

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugify(s) {
  return String(s || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "empresa";
}

export function detectNiche(nichoRaw = "") {
  const n = nichoRaw.toLowerCase();
  if (/veterin|pet|animal|agropec/.test(n)) return "veterinario";
  if (/academia|artes marciais|jiu|muay|luta|pilates|crossfit|fitness|yoga/.test(n)) return "academia";
  if (/fornecedor|equipamento|industrial|fabricante|atacado|distribuidor|limpeza/.test(n)) return "b2b";
  return "geral";
}

function getNicheConfig(nicheKey, lead) {
  const nome = lead.nome || "Sua Empresa";
  const cidade = lead.cidade || "sua região";
  const nichoLabel = lead.nicho || "Serviços Locais";

  const configs = {
    veterinario: {
      palette: {
        bg: "#fafaf7",
        surface: "#ffffff",
        text: "#18221e",
        muted: "#52605a",
        accent: "#0f766e",
        accentDark: "#115e59",
        soft: "#e6f4f1",
        heroBg: "linear-gradient(135deg, #0f766e 0%, #134e4a 100%)",
      },
      badge: `Atendimento Veterinário em ${cidade}`,
      headline: `Cuidado veterinário rápido e seguro para o seu pet em ${cidade}`,
      subhead: `Consultas, vacinas, exames e orientação direta pelo WhatsApp — sem fila de espera desnecessária.`,
      cta: "Agendar consulta no WhatsApp",
      waMsg: `Olá! Vi o site da ${nome} e gostaria de agendar um atendimento para meu pet.`,
      servicesTitle: "Como cuidamos do seu pet",
      services: [
        { title: "Consultas e Check-up", desc: "Avaliação clínica completa com foco em prevenção e diagnóstico rápido." },
        { title: "Vacinação e Vermifugação", desc: "Protocolos atualizados para cães e gatos em todas as fases da vida." },
        { title: "Exames e Procedimentos", desc: "Coleta e acompanhamento sem estresse para o animal e transparência para o tutor." },
        { title: "Orientação Pós-Consulta", desc: "Canal direto no WhatsApp para tirar dúvidas durante a recuperação." },
      ],
      faqs: [
        { q: "Precisa agendar horário antes de ir?", a: "Recomendamos chamar no WhatsApp para garantir atendimento imediato, mas casos urgentes têm prioridade." },
        { q: "Atendem cães e gatos?", a: "Sim, estrutura preparada para receber cães e gatos com conforto e segurança." },
        { q: "Como funciona o retorno ou dúvida após a consulta?", a: "Você fala direto com nossa equipe pelo WhatsApp para acompanhar a evolução do tratamento." },
      ],
    },
    academia: {
      palette: {
        bg: "#0b0c10",
        surface: "#14161d",
        text: "#f4f4f5",
        muted: "#a1a1aa",
        accent: "#f97316",
        accentDark: "#ea580c",
        soft: "rgba(249, 115, 22, 0.14)",
        heroBg: "linear-gradient(135deg, #18181b 0%, #27150a 100%)",
      },
      badge: `${nichoLabel} em ${cidade}`,
      headline: `Treine com acompanhamento real e comece com 1 aula experimental em ${cidade}`,
      subhead: `Turmas organizadas por nível, horários flexíveis e ambiente focado em evolução — do iniciante ao avançado.`,
      cta: "Agendar aula experimental",
      waMsg: `Olá! Quero agendar uma aula experimental na ${nome}.`,
      servicesTitle: "Por que treinar com a gente",
      services: [
        { title: "Aula Experimental Sem Compromisso", desc: "Conheça a estrutura, os professores e a metodologia antes de fechar plano." },
        { title: "Turmas por Nível", desc: "Acompanhamento próximo para quem está começando do zero ou já treina." },
        { title: "Horários Flexíveis", desc: "Grade pensada para encaixar antes ou depois do trabalho." },
        { title: "Foco em Resultado e Constância", desc: "Condicionamento físico, técnica e comunidade que mantém você ativo." },
      ],
      faqs: [
        { q: "Nunca treinei antes, posso fazer aula experimental?", a: "Com certeza. A maioria dos nossos alunos começou do zero com acompanhamento passo a passo." },
        { q: "O que preciso levar para a primeira aula?", a: "Apenas roupa confortável para treino e garrafa de água. O resto orientamos na chegada." },
        { q: "Quais são os planos e horários?", a: "Chame no WhatsApp que enviamos a grade completa de horários e o plano ideal para sua rotina." },
      ],
    },
    b2b: {
      palette: {
        bg: "#f8fafc",
        surface: "#ffffff",
        text: "#0f172a",
        muted: "#475569",
        accent: "#1d4ed8",
        accentDark: "#1e40af",
        soft: "#dbeafe",
        heroBg: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
      },
      badge: `Fornecimento Comercial em ${cidade}`,
      headline: `Abastecimento confiável e cotação rápida para sua empresa em ${cidade}`,
      subhead: `Atendimento ágil para compras recorrentes, emissão de nota fiscal e entrega programada sem dor de cabeça.`,
      cta: "Solicitar cotação no WhatsApp",
      waMsg: `Olá! Gostaria de solicitar uma cotação com a ${nome}.`,
      servicesTitle: "Diferenciais para sua operação",
      services: [
        { title: "Orçamento em Minutos", desc: "Envie sua lista de itens pelo WhatsApp e receba a cotação estruturada." },
        { title: "Condições para CNPJ", desc: "Atendimento dedicado para compras recorrentes e faturamento empresarial." },
        { title: "Entrega Ágil na Região", desc: "Logística organizada para não deixar sua operação parar." },
        { title: "Suporte Técnico na Escolha", desc: "Ajudamos a especificar o produto certo com o melhor custo-benefício." },
      ],
      faqs: [
        { q: "Vocês emitem nota fiscal para empresa?", a: "Sim, trabalhamos com atendimento completo para CNPJ e emissão de NF." },
        { q: "Qual o prazo de entrega em " + cidade + "?", a: "Consulte nossa equipe no WhatsApp com seu CEP para confirmar entrega expressa ou programada." },
        { q: "Existe pedido mínimo?", a: "Temos opções flexíveis conforme o volume e a frequência de compra da sua empresa." },
      ],
    },
    geral: {
      palette: {
        bg: "#fafafa",
        surface: "#ffffff",
        text: "#111827",
        muted: "#4b5563",
        accent: "#111827",
        accentDark: "#000000",
        soft: "#f3f4f6",
        heroBg: "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
      },
      badge: `${nichoLabel} em ${cidade}`,
      headline: `${nome}: atendimento direto e rápido em ${cidade}`,
      subhead: `Tire suas dúvidas, solicite atendimento ou agende pelo WhatsApp em segundos — sem burocracia.`,
      cta: "Falar no WhatsApp agora",
      waMsg: `Olá! Encontrei o site da ${nome} e gostaria de mais informações.`,
      servicesTitle: "O que oferecemos",
      services: [
        { title: "Atendimento Personalizado", desc: "Conversa direta com nossa equipe para entender exatamente o que você precisa." },
        { title: "Agilidade no Orçamento", desc: "Respostas rápidas pelo WhatsApp sem formulários longos." },
        { title: "Localização Fácil", desc: `Atendimento dedicado em ${cidade} com acesso simples pelo Google Maps.` },
        { title: "Qualidade Reconhecida", desc: "Compromisso com pontualidade, clareza e satisfação do cliente." },
      ],
      faqs: [
        { q: "Como faço para agendar ou pedir um orçamento?", a: "Basta clicar no botão de WhatsApp nesta página e falar direto com nossa equipe." },
        { q: "Qual o horário de atendimento?", a: "Chame no WhatsApp para confirmar os horários disponíveis hoje." },
      ],
    },
  };

  return configs[nicheKey] || configs.geral;
}

export function renderPreviewHtml(lead) {
  const nicheKey = detectNiche(lead.nicho);
  const cfg = getNicheConfig(nicheKey, lead);
  const p = cfg.palette;

  const nome = esc(lead.nome || "Sua Empresa");
  const cidade = esc(lead.cidade || "Sua Cidade");
  const endereco = esc(lead.endereco || "");
  const phoneDigits = String(lead.telefone || "").replace(/\D/g, "");
  const waPhone = phoneDigits.startsWith("55") ? phoneDigits : (phoneDigits ? `55${phoneDigits}` : "");
  const waHref = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(cfg.waMsg)}`
    : "#contato";
  const avaliacoes = Number(lead.avaliacoes || 0);
  const nota = lead.nota ? Number(lead.nota).toFixed(1).replace(".", ",") : "4,9";

  const servicesHtml = cfg.services
    .map(
      (s) => `
      <div class="card">
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.desc)}</p>
      </div>`
    )
    .join("\n");

  const faqHtml = cfg.faqs
    .map(
      (f) => `
      <details class="faq-item">
        <summary>${esc(f.q)}</summary>
        <p>${esc(f.a)}</p>
      </details>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${nome} — ${esc(lead.nicho || "Atendimento")} em ${cidade}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: ${p.bg};
      --surface: ${p.surface};
      --text: ${p.text};
      --muted: ${p.muted};
      --accent: ${p.accent};
      --accent-dark: ${p.accentDark};
      --soft: ${p.soft};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .demo-bar {
      background: #111827;
      color: #f9fafb;
      font-size: 13px;
      text-align: center;
      padding: 8px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .demo-bar strong { color: #34d399; }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
    header {
      padding: 18px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand { font-weight: 800; font-size: 18px; letter-spacing: -0.02em; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--accent);
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      padding: 13px 22px;
      border-radius: 10px;
      transition: transform .15s ease, background .15s ease;
    }
    .btn:hover { background: var(--accent-dark); transform: translateY(-1px); }
    .btn-sm { padding: 9px 16px; font-size: 14px; border-radius: 8px; }
    .hero {
      background: ${p.heroBg};
      color: #ffffff;
      border-radius: 20px;
      padding: 52px 32px;
      margin: 12px 0 40px;
    }
    .badge {
      display: inline-block;
      background: rgba(255,255,255,0.14);
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 18px;
    }
    .hero h1 {
      font-size: clamp(28px, 4.5vw, 44px);
      line-height: 1.12;
      letter-spacing: -0.03em;
      max-width: 720px;
      margin-bottom: 16px;
    }
    .hero p {
      font-size: 17px;
      color: rgba(255,255,255,0.88);
      max-width: 600px;
      margin-bottom: 26px;
    }
    .proof {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      margin-top: 22px;
      font-size: 14px;
      color: rgba(255,255,255,0.9);
    }
    section { margin: 48px 0; }
    h2 {
      font-size: 26px;
      letter-spacing: -0.02em;
      margin-bottom: 20px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--surface);
      border: 1px solid rgba(128,128,128,0.16);
      border-radius: 14px;
      padding: 22px;
    }
    .card h3 { font-size: 17px; margin-bottom: 8px; }
    .card p { font-size: 14px; color: var(--muted); }
    .faq-item {
      background: var(--surface);
      border: 1px solid rgba(128,128,128,0.16);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 10px;
    }
    .faq-item summary {
      font-weight: 600;
      cursor: pointer;
      list-style: none;
    }
    .faq-item p { margin-top: 10px; font-size: 14px; color: var(--muted); }
    .cta-box {
      background: var(--soft);
      border-radius: 18px;
      padding: 36px 28px;
      text-align: center;
      margin-bottom: 80px;
    }
    .cta-box p { color: var(--muted); margin: 10px auto 22px; max-width: 520px; }
    .wa-float {
      position: fixed;
      right: 18px;
      bottom: 18px;
      background: #16a34a;
      color: #fff;
      padding: 13px 18px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 14px;
      text-decoration: none;
      box-shadow: 0 10px 25px rgba(0,0,0,0.22);
      z-index: 50;
    }
    footer {
      border-top: 1px solid rgba(128,128,128,0.16);
      padding: 24px 0 40px;
      font-size: 13px;
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
    }
    @media (max-width: 640px) {
      .hero { padding: 36px 20px; }
      header .btn-sm { display: none; }
    }
  </style>
</head>
<body>
  <div class="demo-bar">
    Prévia demonstrativa criada para <strong>${nome}</strong> · Modelo exclusivo <strong>WiNS Hub Comercial</strong>
  </div>

  <div class="wrap">
    <header>
      <div class="brand">${nome}</div>
      <a class="btn btn-sm" href="${waHref}" target="_blank" rel="noopener">${esc(cfg.cta)}</a>
    </header>

    <div class="hero">
      <span class="badge">${esc(cfg.badge)}</span>
      <h1>${esc(cfg.headline)}</h1>
      <p>${esc(cfg.subhead)}</p>
      <a class="btn" href="${waHref}" target="_blank" rel="noopener">${esc(cfg.cta)}</a>
      <div class="proof">
        ${avaliacoes > 0 ? `<span>★ <strong>${nota}</strong> no Google (${avaliacoes} avaliações reais)</span>` : `<span>★ Atendimento local em ${cidade}</span>`}
        ${endereco ? `<span>📍 ${endereco}</span>` : ""}
      </div>
    </div>

    <section>
      <h2>${esc(cfg.servicesTitle)}</h2>
      <div class="grid">
        ${servicesHtml}
      </div>
    </section>

    <section>
      <h2>Dúvidas frequentes</h2>
      ${faqHtml}
    </section>

    <section class="cta-box" id="contato">
      <h2>Pronto para falar com a ${nome}?</h2>
      <p>Clique abaixo para chamar direto no WhatsApp e receber atendimento rápido em ${cidade}.</p>
      <a class="btn" href="${waHref}" target="_blank" rel="noopener">${esc(cfg.cta)}</a>
    </section>

    <footer>
      <span>${nome} · ${cidade}</span>
      <span>Prévia de site profissional — WiNS Hub Comercial</span>
    </footer>
  </div>

  <a class="wa-float" href="${waHref}" target="_blank" rel="noopener">WhatsApp</a>
</body>
</html>`;
}

