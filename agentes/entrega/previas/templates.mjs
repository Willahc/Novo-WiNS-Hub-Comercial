// templates.mjs — Gera prévias de site personalizadas por nicho (HTML único, editorial, mobile-first)

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
  if (/veterin|pet|animal|agropec|zoonutri/.test(n)) return "veterinario";
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
        accent950: "#0c261f",
        accent900: "#13382e",
        accent800: "#173c32",
        accent600: "#2b6f59",
        accent500: "#397a61",
        accent100: "#e7f1ec",
        accentLine: "rgba(23, 60, 50, 0.12)",
        accentBorder: "rgba(57, 122, 97, 0.22)",
      },
      badge: `Atendimento Veterinário · ${cidade}`,
      headline: `Cuidado veterinário <em>individualizado</em> e humano para o seu pet em ${cidade}`,
      subhead: `Consultas, prevenção, exames e orientação direta pelo WhatsApp — com acolhimento real e sem fila de espera desnecessária.`,
      cta: "Agendar no WhatsApp",
      waMsg: `Olá! Vi o site da ${nome} e gostaria de agendar um atendimento para meu pet.`,
      cardEyebrow: "Acolhimento & Técnica",
      cardTitle: "Saúde em cada detalhe",
      cardSubtitle: "Estrutura pensada para reduzir o estresse do pet e dar clareza ao tutor.",
      cardHighlights: [
        "Atendimento direto com a equipe",
        "Agendamento rápido via WhatsApp",
        "Acompanhamento pós-consulta",
      ],
      servicesEyebrow: "Especialidades",
      servicesTitle: "Como cuidamos do seu pet",
      services: [
        { num: "01", title: "Consultas e Check-up", desc: "Avaliação clínica completa com foco em prevenção, bem-estar e diagnóstico ágil." },
        { num: "02", title: "Vacinação e Protocolos", desc: "Esquemas atualizados para cães e gatos em todas as fases da vida." },
        { num: "03", title: "Exames e Procedimentos", desc: "Coleta e acompanhamento cuidadoso com total transparência para o tutor." },
        { num: "04", title: "Orientação Pós-Consulta", desc: "Canal direto no WhatsApp para tirar dúvidas durante toda a recuperação." },
      ],
      faqs: [
        { q: "Precisa agendar horário antes de ir?", a: "Recomendamos chamar no WhatsApp para garantir atendimento pontual, mas casos urgentes têm prioridade." },
        { q: "Atendem cães e gatos?", a: "Sim, nossa estrutura é preparada para receber cães e gatos com conforto e tranquilidade." },
        { q: "Como funciona o retorno ou dúvida após a consulta?", a: "Você fala direto com nossa equipe pelo WhatsApp para acompanhar a evolução do tratamento." },
      ],
    },
    academia: {
      palette: {
        accent950: "#1f140e",
        accent900: "#2e1c12",
        accent800: "#3d2314",
        accent600: "#b45309",
        accent500: "#d97706",
        accent100: "#fef3c7",
        accentLine: "rgba(61, 35, 20, 0.12)",
        accentBorder: "rgba(217, 119, 6, 0.25)",
      },
      badge: `${nichoLabel} · ${cidade}`,
      headline: `Treine com método e comece com <em>1 aula experimental</em> em ${cidade}`,
      subhead: `Turmas organizadas por nível, horários flexíveis e acompanhamento próximo para você evoluir com constância.`,
      cta: "Agendar aula experimental",
      waMsg: `Olá! Quero agendar uma aula experimental na ${nome}.`,
      cardEyebrow: "Metodologia & Constância",
      cardTitle: "Do zero ao avançado",
      cardSubtitle: "Ambiente acolhedor, técnica aplicada e evolução medida semana a semana.",
      cardHighlights: [
        "Aula experimental sem compromisso",
        "Turmas separadas por nível",
        "Grade flexível manhã, tarde e noite",
      ],
      servicesEyebrow: "Experiência",
      servicesTitle: "Por que treinar com a gente",
      services: [
        { num: "01", title: "Aula Experimental Gratuita", desc: "Conheça o espaço, os professores e a metodologia antes de escolher seu plano." },
        { num: "02", title: "Acompanhamento Real", desc: "Correção técnica e atenção individualizada para quem está começando do zero." },
        { num: "03", title: "Horários Flexíveis", desc: "Grade pensada para encaixar antes ou depois do trabalho sem perder ritmo." },
        { num: "04", title: "Comunidade e Resultado", desc: "Condicionamento físico, disciplina e ambiente que mantém você motivado." },
      ],
      faqs: [
        { q: "Nunca treinei antes, posso fazer aula experimental?", a: "Com certeza. A maioria dos nossos alunos começou do zero com acompanhamento passo a passo." },
        { q: "O que preciso levar para a primeira aula?", a: "Apenas roupa confortável para treino e garrafa de água. O resto orientamos na chegada." },
        { q: "Quais são os planos e horários?", a: "Chame no WhatsApp que enviamos a grade completa e o plano ideal para sua rotina." },
      ],
    },
    b2b: {
      palette: {
        accent950: "#0b192c",
        accent900: "#102542",
        accent800: "#163258",
        accent600: "#1d4ed8",
        accent500: "#2563eb",
        accent100: "#dbeafe",
        accentLine: "rgba(22, 50, 88, 0.12)",
        accentBorder: "rgba(37, 99, 235, 0.22)",
      },
      badge: `Fornecimento B2B · ${cidade}`,
      headline: `Abastecimento <em>confiável</em> e cotação ágil para sua empresa em ${cidade}`,
      subhead: `Atendimento consultivo para compras recorrentes, emissão de nota fiscal e entrega programada sem dor de cabeça.`,
      cta: "Solicitar cotação",
      waMsg: `Olá! Gostaria de solicitar uma cotação com a ${nome}.`,
      cardEyebrow: "Operação & Logística",
      cardTitle: "Parceria comercial direta",
      cardSubtitle: "Agilidade no orçamento e previsibilidade para sua operação nunca parar.",
      cardHighlights: [
        "Cotação estruturada em minutos",
        "Faturamento e NF para CNPJ",
        "Entrega programada na região",
      ],
      servicesEyebrow: "Diferenciais",
      servicesTitle: "Soluções para sua operação",
      services: [
        { num: "01", title: "Orçamento em Minutos", desc: "Envie sua lista de itens pelo WhatsApp e receba a cotação completa rapidamente." },
        { num: "02", title: "Condições para CNPJ", desc: "Atendimento dedicado para compras recorrentes e faturamento empresarial." },
        { num: "03", title: "Entrega Ágil na Região", desc: "Logística organizada para cumprir prazos e manter seu estoque abastecido." },
        { num: "04", title: "Suporte na Especificação", desc: "Ajudamos a escolher o produto certo com o melhor custo-benefício." },
      ],
      faqs: [
        { q: "Vocês emitem nota fiscal para empresa?", a: "Sim, trabalhamos com atendimento completo para CNPJ e emissão de NF." },
        { q: `Qual o prazo de entrega em ${cidade}?`, a: "Consulte nossa equipe no WhatsApp com seu CEP para confirmar entrega expressa ou programada." },
        { q: "Existe pedido mínimo?", a: "Temos opções flexíveis conforme o volume e a frequência de compra da sua empresa." },
      ],
    },
    geral: {
      palette: {
        accent950: "#121f22",
        accent900: "#1a2d31",
        accent800: "#233c41",
        accent600: "#2c5e63",
        accent500: "#38757b",
        accent100: "#e6f0f1",
        accentLine: "rgba(35, 60, 65, 0.12)",
        accentBorder: "rgba(56, 117, 123, 0.22)",
      },
      badge: `${nichoLabel} · ${cidade}`,
      headline: `Atendimento <em>direto</em>, ágil e sob medida em ${cidade}`,
      subhead: `Tire suas dúvidas, solicite um orçamento ou agende seu horário pelo WhatsApp em segundos — sem burocracia.`,
      cta: "Falar no WhatsApp",
      waMsg: `Olá! Encontrei o site da ${nome} e gostaria de mais informações.`,
      cardEyebrow: "Atendimento Premium",
      cardTitle: "Clareza e agilidade",
      cardSubtitle: "Da primeira mensagem à entrega, tudo pensado para facilitar sua rotina.",
      cardHighlights: [
        "Resposta rápida pelo WhatsApp",
        "Orçamento claro e sem compromisso",
        "Atendimento bem avaliado no Google",
      ],
      servicesEyebrow: "O que fazemos",
      servicesTitle: "Compromisso com qualidade",
      services: [
        { num: "01", title: "Atendimento Personalizado", desc: "Conversa direta com nossa equipe para entender exatamente o que você precisa." },
        { num: "02", title: "Agilidade no Orçamento", desc: "Respostas rápidas pelo WhatsApp sem formulários longos ou espera." },
        { num: "03", title: "Localização Estratégica", desc: `Atendimento dedicado em ${cidade} com acesso fácil pelo Google Maps.` },
        { num: "04", title: "Qualidade Reconhecida", desc: "Foco em pontualidade, transparência e satisfação em cada serviço." },
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
  const iniciais = esc(
    (lead.nome || "SE")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("")
  );

  const servicesHtml = cfg.services
    .map(
      (s) => `
      <article class="card">
        <span class="card-num serif">${esc(s.num)}</span>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.desc)}</p>
      </article>`
    )
    .join("\n");

  const highlightsHtml = cfg.cardHighlights
    .map(
      (h) => `
      <li>
        <span class="check" aria-hidden="true">✓</span>
        <span>${esc(h)}</span>
      </li>`
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

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${nome} — ${esc(lead.nicho || "Atendimento")} em ${cidade}</title>
  <meta name="theme-color" content="${p.accent800}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent-950: ${p.accent950};
      --accent-900: ${p.accent900};
      --accent-800: ${p.accent800};
      --accent-600: ${p.accent600};
      --accent-500: ${p.accent500};
      --accent-100: ${p.accent100};
      --cream: #f8f7f1;
      --paper: #fffefa;
      --sand: #e8dcc5;
      --sand-soft: #f5efe2;
      --ink: #152822;
      --ink-soft: #31463f;
      --muted: #5d6d65;
      --line: ${p.accentLine};
      --border-soft: ${p.accentBorder};
      --shadow-sm: 0 4px 16px rgba(12, 38, 31, 0.04);
      --shadow-md: 0 14px 36px rgba(12, 38, 31, 0.07);
      --shadow-lg: 0 26px 60px rgba(12, 38, 31, 0.11);
      --radius-md: 24px;
      --radius-lg: 32px;
      --radius-pill: 999px;
      --container: 1120px;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
    body {
      font-family: "Plus Jakarta Sans", system-ui, -apple-system, sans-serif;
      color: var(--ink);
      background-color: var(--cream);
      line-height: 1.65;
      overflow-x: hidden;
    }
    a { color: inherit; text-decoration: none; }
    .container { width: min(var(--container), calc(100% - 40px)); margin-inline: auto; }
    .serif { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-optical-sizing: auto; letter-spacing: -0.02em; }

    .demo-bar {
      background: var(--accent-950);
      color: #f8f7f1;
      font-size: 12.5px;
      text-align: center;
      padding: 8px 16px;
      letter-spacing: 0.01em;
    }
    .demo-bar strong { color: var(--sand); font-weight: 600; }

    .site-header {
      position: sticky;
      top: 0;
      z-index: 40;
      background: rgba(248, 247, 241, 0.88);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--line);
    }
    .nav-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 14px 0;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 1.05rem;
      letter-spacing: -0.01em;
    }
    .brand-mark {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: var(--accent-800);
      color: var(--paper);
      display: grid;
      place-items: center;
      font-family: "Fraunces", Georgia, serif;
      font-size: 1rem;
      font-weight: 600;
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 26px;
      font-size: 0.92rem;
      font-weight: 500;
      color: var(--ink-soft);
    }
    .nav-links a:hover { color: var(--accent-800); }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 24px;
      border-radius: var(--radius-pill);
      font-weight: 600;
      font-size: 0.94rem;
      transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer;
    }
    .btn-primary {
      background: var(--accent-800);
      color: var(--paper);
      box-shadow: 0 10px 24px rgba(12, 38, 31, 0.16);
    }
    .btn-primary:hover {
      background: var(--accent-900);
      transform: translateY(-2px);
    }
    .btn-ghost {
      background: var(--paper);
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .btn-ghost:hover {
      border-color: var(--accent-600);
      transform: translateY(-1px);
    }
    .btn-sm { padding: 10px 18px; font-size: 0.86rem; }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: var(--radius-pill);
      background: var(--accent-100);
      border: 1px solid var(--border-soft);
      color: var(--accent-800);
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* Hero */
    .hero {
      padding: 54px 0 64px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 44px;
      align-items: center;
    }
    .hero h1 {
      margin: 18px 0 18px;
      font-size: clamp(2.1rem, 4.2vw, 3.35rem);
      line-height: 1.12;
      color: var(--ink);
    }
    .hero h1 em {
      font-style: italic;
      color: var(--accent-600);
    }
    .hero-sub {
      font-size: 1.08rem;
      color: var(--muted);
      max-width: 540px;
      margin-bottom: 28px;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 26px;
    }
    .rating-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      font-size: 0.88rem;
      color: var(--ink-soft);
      box-shadow: var(--shadow-sm);
    }
    .stars { color: #d97706; letter-spacing: 1px; }

    .hero-card {
      background: linear-gradient(155deg, var(--accent-800) 0%, var(--accent-950) 100%);
      color: var(--paper);
      border-radius: var(--radius-lg);
      padding: 36px 32px;
      box-shadow: var(--shadow-lg);
      position: relative;
      overflow: hidden;
    }
    .hero-card::before {
      content: "";
      position: absolute;
      inset: -40% -20% auto auto;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(232, 220, 197, 0.16) 0%, transparent 70%);
      pointer-events: none;
    }
    .hero-card-eyebrow {
      display: inline-block;
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sand);
      margin-bottom: 12px;
    }
    .hero-card h2 {
      font-size: 1.85rem;
      line-height: 1.2;
      margin-bottom: 10px;
    }
    .hero-card p {
      font-size: 0.94rem;
      color: rgba(255, 254, 250, 0.8);
      margin-bottom: 24px;
    }
    .hero-list {
      list-style: none;
      display: grid;
      gap: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      padding-top: 20px;
    }
    .hero-list li {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.92rem;
      color: rgba(255, 254, 250, 0.94);
    }
    .hero-list .check {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(232, 220, 197, 0.18);
      color: var(--sand);
      display: grid;
      place-items: center;
      font-size: 0.75rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    /* Trust Strip */
    .trust-strip {
      background: var(--accent-900);
      color: var(--paper);
      border-radius: var(--radius-md);
      padding: 28px 32px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      margin-bottom: 64px;
    }
    .trust-item strong {
      display: block;
      font-family: "Fraunces", Georgia, serif;
      font-size: 1.65rem;
      color: var(--sand);
      font-weight: 500;
      margin-bottom: 4px;
    }
    .trust-item span {
      font-size: 0.88rem;
      color: rgba(255, 254, 250, 0.78);
    }

    /* Sections */
    .section { padding: 24px 0 64px; }
    .section-head { margin-bottom: 32px; max-width: 620px; }
    .section-head h2 {
      font-size: clamp(1.75rem, 3vw, 2.4rem);
      margin-top: 12px;
      line-height: 1.18;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 28px;
      box-shadow: var(--shadow-sm);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow-md);
    }
    .card-num {
      display: inline-block;
      font-size: 1.15rem;
      color: var(--accent-600);
      margin-bottom: 10px;
    }
    .card h3 {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--ink);
    }
    .card p {
      font-size: 0.94rem;
      color: var(--muted);
    }

    /* FAQ */
    .faq-list { display: grid; gap: 12px; max-width: 820px; }
    .faq-item {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px 22px;
    }
    .faq-item summary {
      font-weight: 600;
      cursor: pointer;
      list-style: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .faq-item summary::after {
      content: "+";
      font-size: 1.25rem;
      color: var(--accent-600);
      font-weight: 500;
    }
    .faq-item[open] summary::after { content: "−"; }
    .faq-item p {
      margin-top: 12px;
      font-size: 0.94rem;
      color: var(--muted);
    }

    /* Final CTA */
    .cta-box {
      background: var(--sand-soft);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 44px 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 28px;
      flex-wrap: wrap;
      margin-bottom: 48px;
    }
    .cta-box h2 {
      font-size: clamp(1.6rem, 2.8vw, 2.15rem);
      margin-bottom: 8px;
    }
    .cta-box p { color: var(--muted); max-width: 540px; }

    footer {
      border-top: 1px solid var(--line);
      padding: 28px 0 42px;
      font-size: 0.88rem;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    @media (max-width: 860px) {
      .hero-grid, .cards-grid, .trust-strip { grid-template-columns: 1fr; }
      .nav-links { display: none; }
      .hero { padding: 34px 0 44px; }
    }
  </style>
</head>
<body>
  <div class="demo-bar">
    Prévia exclusiva preparada para <strong>${nome}</strong> · pronta para publicar no seu domínio
  </div>

  <header class="site-header">
    <div class="container nav-wrap">
      <a href="#" class="brand">
        <span class="brand-mark">${iniciais}</span>
        <span>${nome}</span>
      </a>
      <nav class="nav-links" aria-label="Navegação principal">
        <a href="#servicos">Serviços</a>
        <a href="#duvidas">Dúvidas</a>
        <a href="#contato">Contato</a>
      </nav>
      <a class="btn btn-primary btn-sm" href="${waHref}" target="_blank" rel="noopener">${esc(cfg.cta)}</a>
    </div>
  </header>

  <main class="container">
    <section class="hero">
      <div class="hero-grid">
        <div>
          <span class="eyebrow">${esc(cfg.badge)}</span>
          <h1 class="serif">${cfg.headline}</h1>
          <p class="hero-sub">${esc(cfg.subhead)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="${waHref}" target="_blank" rel="noopener">${esc(cfg.cta)}</a>
            <a class="btn btn-ghost" href="#servicos">Conhecer serviços</a>
          </div>
          ${avaliacoes > 0 ? `
          <div class="rating-pill">
            <span class="stars" aria-hidden="true">★★★★★</span>
            <span><strong>${nota}</strong> no Google · ${avaliacoes} avaliações verificadas</span>
          </div>` : ""}
        </div>

        <aside class="hero-card">
          <span class="hero-card-eyebrow">${esc(cfg.cardEyebrow)}</span>
          <h2 class="serif">${esc(cfg.cardTitle)}</h2>
          <p>${esc(cfg.cardSubtitle)}</p>
          <ul class="hero-list">
            ${highlightsHtml}
          </ul>
        </aside>
      </div>
    </section>

    <section class="trust-strip" aria-label="Destaques">
      <div class="trust-item">
        <strong>${avaliacoes > 0 ? `${nota} ★` : "Direto"}</strong>
        <span>${avaliacoes > 0 ? `${avaliacoes} avaliações reais no Google` : "Atendimento direto sem intermediários"}</span>
      </div>
      <div class="trust-item">
        <strong>${cidade}</strong>
        <span>Atendimento local e fácil localização</span>
      </div>
      <div class="trust-item">
        <strong>WhatsApp</strong>
        <span>Agendamento e dúvidas em minutos</span>
      </div>
    </section>

    <section class="section" id="servicos">
      <div class="section-head">
        <span class="eyebrow">${esc(cfg.servicesEyebrow)}</span>
        <h2 class="serif">${esc(cfg.servicesTitle)}</h2>
      </div>
      <div class="cards-grid">
        ${servicesHtml}
      </div>
    </section>

    <section class="section" id="duvidas">
      <div class="section-head">
        <span class="eyebrow">Perguntas frequentes</span>
        <h2 class="serif">Tudo claro antes do primeiro contato</h2>
      </div>
      <div class="faq-list">
        ${faqHtml}
      </div>
    </section>

    <section class="cta-box" id="contato">
      <div>
        <h2 class="serif">Pronto para falar com a ${nome}?</h2>
        <p>${endereco ? `Atendimento em ${endereco}. ` : ""}Clique no botão ao lado para conversar direto pelo WhatsApp.</p>
      </div>
      <a class="btn btn-primary" href="${waHref}" target="_blank" rel="noopener">${esc(cfg.cta)}</a>
    </section>
  </main>

  <footer class="container">
    <span>© ${new Date().getFullYear()} ${nome} · ${cidade}</span>
    <span>${endereco || "Atendimento via WhatsApp"}</span>
  </footer>
</body>
</html>`;
}
