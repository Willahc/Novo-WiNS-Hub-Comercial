# Ferramentas Open Source para a Agência (catálogo pesquisado em 10/11/2026)

> Otimizações mapeadas a partir de pesquisa no GitHub, ranqueadas por impacto
> no fluxo: prospecção → site → fechamento → entrega → recorrência.

## O conselho de segurança da pesquisa (aplicar sempre)

Antes de instalar qualquer repo: 15 min de leitura, `npm info` de todo
pacote citado, `grep` por scripts que executam sozinhos. Estrela alta não é
selo de segurança. NUNCA instale configs de MCP de listas prontas sem auditar.

---

## FASE 1 — Melhorias instantâneas no que já existe (install hoje)

### 1.1 Skills prontas (anthropics/skills + VoltAgent/awesome-agent-skills)
- **Repo**: `github.com/anthropics/skills` (Apache 2.0, mantido pela Anthropic)
  e `github.com/VoltAgent/awesome-agent-skills` (MIT, 1000+ skills de
  engenharias de verdade)
- **O que muda pra nós**: o formato SKILL.md é o padrão aberto (agentskills.io)
  que funciona em OpenCode, Claude Code, Codex, Cursor e Antigravity — basta
  copiar a pasta da skill para `.claude/skills/` (ou equivalente do agente)
  e um clone limpo e instalável
  - `anthropics/pdf` → **proposta em PDF de verdade** (hoje é markdown)
  - `anthropics/xlsx` → planilha de MRR pra vender com proposta
  - `anthropics/frontend-design` → acabamento premium nos sites
  - `anthropics/webapp-testing` → testar o site do cliente com Playwright
  - `anthropics/skill-creator` → criar e TESTAR skills novas
- **Ação**: converter nossos 5 especialistas (`skills/*.md`) pro formato
  SKILL.md (frontmatter `name` + `description`) → compatíveis com todos os
  agentes, carregamento progressivo (não enche contexto)

### 1.2 AstroWind — template dos sites que justificam R$ 3.500+
- **Repo**: `github.com/arthelokyo/astrowind` — MIT
- Astro 7 + Tailwind, 30+ widgets, blog, SEO, sitemap, PageSpeed top, imagens
  otimizadas... **e vem com `AGENTS.md` + skills p/ agentes de IA** — o
  template foi desenhado pra ser construído por agente
- **Uso**: conforme o orçamento do cliente cresce: single-file (demo/fila),
  AstroWind (proposta fechada de R$ 3.500+)

---

## FASE 2 — Receita recorrente (a área que mais rende)

### 2.1 Whaticket Open Source — o "CRM de WhatsApp" pra VENDER
- **Repo**: `github.com/canove/whaticket-community` — **Whaticket Open Source** (MIT, ~2k ⭐) — sistema de tickets
  multi-usuário num único número de WhatsApp (Node + React, PT/ES/EN)
- **Uso**: produto equivalente é vendido pronto por R$ 6.100 no mercado —
  instale pro cliente, cobre instalação + mensalidade de
  suporte. MIT = pode comercializar sem negociar licença
- Versão paga (US$ 49/mês) tem IA/campanhas — mas a open source cobre 80%

### 2.2 Typebot — chatbot de orçamento no site do cliente
- **Repo**: `github.com/baptisteArno/typebot.io` (FSL, 10k+ ⭐, forte no BR)
- Builder visual de chatbot: blocos de texto/botão/pagamento (Stripe!),
  analytics de conversão, agendamento. Self-host grátis; cada release
  vira Apache 2.0 após 2 anos
- **Uso**: "seu site agora qualifica leads sozinho" → cobre setup + mensalidade.
  ⚠️ Só WhatsApp avançado/SSO exige licença paga mesmo self-host

### 2.3 Evolution API — a ponte WhatsApp séria (quando tiver volume)
- **Repo**: `github.com/evolution-foundation/evolution-api` (Apache 2.0 +
  condições de marca, 10k+ ⭐, comunidade BR enorme)
- **PONTO CRÍTICO**: modo Baileys (grátis) = mesmo risco de ban do mercado
  não-oficial; modo **Cloud API oficial da Meta** = zero risco de ban (+ custo
  por mensagem desde 07/2025, inclusive mensagens da janela 24h desde 10/2026)
- **Rota certa**: começar Baileys em volume baixíssimo → migrar p/ Cloud API
  sem reescrever código (a API é a mesma)
- Alternativas mais leves: WAHA (Apache 2.0, docker único) e Baileys direto

---

## FASE 3 — Sua infraestrutura de agência (de você, não do cliente)

### 3.1 CRM do próprio pipeline
- **Twenty** (`github.com/twentyhq/twenty`, AGPL + exceção comercial, 60k+ ⭐,
  "designed for AI", MCP nativo) OU **EspoCRM** (AGPL, PHP, estável desde 2014)
- **Uso**: substituir status.json quando o pipeline passar de ~200 leads.
  Enquanto não: o status.json é seu CRM de graça (e já inteligente)

### 3.2 Automação de fluxos
- **Activepieces** (`github.com/activepieces/activepieces`, **MIT core**,
  280+ pieces que viram MCP servers) OU **n8n** (fair-code, 210k ⭐,
  13k templates, mas: não pode hospedar pra CLIENTE sem acordo)
- **Uso**: cron daily: roda scraper → roda gerar-fila.mjs → manda a fila no
  seu Telegram. Activepieces = escolha melhor pra integrar em produtos do
  cliente (MIT permite embed/venda)

### 3.3 Email marketing (quando tiver lista)
- **Mautic** (`github.com/mautic/mautic`, GPL-3.0, 10k+ ⭐) — campanhas,
  lead scoring, segmentos. Fase tarde, reforço p/ nicho B2B

---

## Roteiro de implantação recomendado

| # | Ação | Esforço | Ganho |
|---|---|---|---|
| 1 | Converter skills/*.md pro formato SKILL.md | 1h | todos os agentes ganham os especialistas |
| 2 | Instalar skill `pdf` de Anthropic → proposta em PDF | 30min | proposta comercial de verdade |
| 3 | Baixar AstroWind p/ sites de proposta fechada | 2h | R$ 3.500+ justificável |
| 4 | Whaticket FOSS num VPS barato → teu produto "CRM de WhatsApp" | 4-6h | peça que cursos vendem como exclusividade |
| 5 | Typebot self-hosted no cliente X que aceitar | 4h | chatbot no site do cliente + mensalidade |
| 6 | Evolution API na Cloud API quando volume justificar | 1 dia | automação SEM ban |

## O que NÃO instalar (analisado e descartado)

- OpenWA/Venom/WPPConnect — mesma arquitetura quebrada (browser automation) e
  comunidades mais calmas que seus concorrentes
- rohitg00/awesome-claude-code-toolkit — abandonado (MAR 2026) e MCP configs
  quebrados apontando pra pacotes que NÃO existem
- Suites fechadas de "CRM de WhatsApp" vendidas como produto pronto são,
  por dentro, Whaticket + Typebot + Evolution API embalados: montar o
  próprio = preço real

---

# RONDA 2 — indicadas pelo usuário (auditadas em 10/11/2026)

Metadados confirmados na API do GitHub (stars/licença/último push). Veredito
por ferramenta e onde encaixam no funil: prospecção → demo → proposta →
entrega → recorrência.

## 1. Scrapling (D4Vinci/Scrapling) — ⭐ 100.972 · BSD-3-Clause · Python
**ADOPTADO — fallback aditivo no enriquecimento (10/11/2026). Não perde nada.**
- Web scraping com **stealth/adaptativo** (seletores que se recuperam quando
  o site muda de layout) + fetchers em requests/Playwright/Camoufox.
- **Como entrou (ADITIVO)**: o fetch do enriquecimento nativo dos
  leads foi mantido como primeira tentativa. Novo CLI
  `prospeccao\scrapling-fetch.py` (Fetcher com TLS stealth) é chamado
  SÓ quando o site bloqueia/decepciona o fetch básico (Cloudflare/403,
  HTML mínimo). Depois é alguns bits de código no `gerar-fila.mjs`
  (`enriquecerViaScrapling`), zero mudança no fluxo que já funciona.
- **Instalado**: `pip install Scrapling` (0.5.1) + `curl-cffi` +
  `patchright` + `browserforge` (Python 3.14 omitiu os extras silenciosos).
- Teste determinístico: servidor local que protege contra o UA do fetch
  nativo e aceita stealth → fila.md recebeu título + flag de WhatsApp
  via `via: scrapling`. ✓
- **Opcional depois**: `scrapling install` (baixa navegador Camoufox, ~
  250 MB) e o MCP server incluso (`scrapling-mcp.exe` é instalado) para eu
  usar Scrapling direto durante sessões.
- ⚠️ Mesma ética do Maps: use em sites REAIS de leads e do próprio
  concorrente, não massivamente.

## 2. open-seo (every-app/open-seo) — ⭐ 27.150 · MIT · TypeScript
**DEFERIDO — exige chave DataForSEO paga (top-up mínimo US$ 50) — conflito com a regra do 100% gratuito.**
- Alternativa open-source a Semrush/Ahrefs: auditoria de site, pesquisa de
  palavras-chave, análise de backlinks + **Google Search Console MCP**.
- **Substituições GRATUITAS já em uso** (cadeia própria + oficial, tudo sem pagar):
  1. `prospeccao\auditor-seo.mjs` — auditoria técnica por fetch puro
     (title/description/headings/imagens/og/JSON-LD/robots/sitemap/peso).
     Nota 0–100 + tabela de problemas. Já gerou `auditoria-seo.md` (66/100).
  2. `prospeccao\palavras-chave.mjs` — pesquisa de palavras-chave via
     **Google Suggest** (endpoint público `suggestqueries`, sem chave).
     Expande seeds+cidade, separa busca REAL (munição) de MARCA (intel de
     concorrência — K10/VRV/SimoSos dominam "construtora mogi guaçu") de
     INFORMACIONAL (curso/salário — ignora). Confere presença no site do
     cliente. Já gerou `palavras-chave.md`.
  3. **Google Search Console** (oficial, grátis) — rank tracking REAL e
     backlinks do próprio cliente: posições, impressões, CTR. Precisa do
     dono adicionar o site — pedir acesso na fase de fechamento.
  4. **Google Keyword Planner / Trends** (grátis) — volume em faixa e
     tendência quando um número extra valer a pena.
- O que continua sem versão grátis: volumes EXATOS e backlinks de sites
  TERCEIROS. Quando isso virar entregável de contrato mensal, criar conta
  DataForSEO e usar o crédito grátis de US$ 1 pra testar ANTES de top-up.

## 3. Presenton (presenton/presenton) — ⭐ 11.838 · Apache-2.0 · TypeScript
Adotar em FASE 2.
- Gerador de apresentações por IA + API (alternativa a Gamma/Canva),
  self-host em Docker.
- **Encaixe**: decks de apresentação do cliente (design de proposta,
  apresentação pro dono do negócio), e ***API*** significa que dá pra
  gerar deck personalizado do lead a partir do `contexto.md` dele —
  pitch deck por lead em vez do PDF sozinho.
- ⚠️ Precisa de LLM API key configurada (tem custo por uso).

## 4. OpenShorts (mutonby/openshorts) — ⭐ 7.634 · MIT · Python
Adotar em FASE 2-3. **Nova linha de receita, mas pesada.**
- Clips por IA: vídeo longo → shorts 9:16 com detecção de momento viral,
  face tracking, legendas e dublagem. Docker self-host + API + MCP server.
- **Encaixe**: serviço de "cortes de Reels" pros clientes que postam no
  Instagram (restaurante, academia, clínica — os nichos da nossa fila).
  MIT = pode vender o resultado sem questionar licença.
- ⚠️ Processamento é pesado — GPU/CPU forte. No PC atual, testar com vídeos
  curtos primeiro. Fork do Autocrop-vertical (projeto base sem licença
  declarada — OpenShorts SIM é MIT).

## 5. Dify (langgenius/dify) — ⭐ 160.849 · licença PRÓPRIA (não MIT/Apache)
Adotar com CAUTELA — FASE 3, se sobrar caso.
- Plataforma de agentes/RAG low-code, self-host. O maior famoso da lista.
- **Por que CAUTELA**: a licença "Dify Open Source License" tem restrições
  (multi-tenant SaaS exige acordo comercial; cap de usuários/receita) —
  não dá pra revender como produto SEM negociar, diferente de tudo na
  nossa lista até aqui.
- **Encaixe real**: Redes de especialistas da agência rodando autonomia
  24/7 exigiria servidor + LLM keys constantes — hoje OpenCode + skills
  cobre isso melhor. Mantenha na watchlist; não instale por enquanto.

## 6. WhatsApp open-source (whatsapp-web.js · Baileys · Evolution API · WAHA)
**WATCHLIST FASE 3 — risco real de ban do número. NÃO instalar no número pessoal.**
- whatsapp-web.js ⭐ 22,9k · Apache-2.0 · headless Chromium.
  Baileys ⭐ 11,6k · MIT (depende de libsignal GPLv3 por baixo).
  Evolution API ⭐ ~10k · Apache-2.0 + condições de marca + telemetria.
  WAHA ⭐ 7,7k · Apache-2.0 · tudo liberado desde 2026.6.1.
- **O que TODAS têm em comum:** conectam como "dispositivo vinculado"
  não oficial → viola ToS do WhatsApp, com **bloqueio de conta possível**.
  Não é teoria: relatos recorrentes de queda de sessão (1x/semana) e
  banimento. Nosso modelo semi-autônomo (usuário envia, 20/dia, tom
  humano) existe EXATAMENTE porque ele protege esse número.
- **Encaixe futuro (e só isso):** ler eventos e marcar `visualizado`/
  `respondeu` automaticamente na fila — poupa digitação, sem disparo.
  Se um dia for testado: número dedicado (nunca o pessoal) e Baileys num
  processo separado (isola a dependência GPL).
- **Não confundir** com a WhatsApp Cloud API oficial (Meta): 1.000
  mensagens de serviço/mês grátis, sem risco — mas exige app Meta e
  template aprovado. É o único caminho de automação legítima.

## 7. harken (montezuma-p/harken) — MIT/Apache-2.0 · Rust · ~13 MB
**ADOTADO HOJE (10/11/2026) — transcrição de áudio 100% local, offline.**
- Binário único com whisper.cpp embutido: transcreve áudios, pastas e
  **export de conversa do WhatsApp (.zip com mídia)** sem Python/ffmpeg/
  API key. Ferramentas MCP: `transcribe_file`, `transcribe_whatsapp_export`.
- **Encaixe agora**: cliente manda áudio de 5 minutos explicando o que
  quer no site → eu transcrevo e transformo em contexto/demanda, sem
  ficar pedindo pra digitar. Também serve pra briefings e reclamações.
- **Instalado em**: `agencia-ia\tools\harken\harken.exe` (v0.8.0) e
  registrado como MCP no `opencode.jsonc`. Modelo baixa no primeiro uso
  (~466 MB, `small`) — CPU puro, sem GPU.
- Uso direto no terminal: `harken.exe audio.opus` (ou pasta/globs) e
  `harken.exe whatsapp "WhatsApp Chat com Fulano.zip"` para export de
  conversa. Dentro das sessões, eu uso as ferramentas MCP diretamente.

## 8. Easy!Appointments (easyappointments/easyappointments) — GPL-3.0 · PHP
**FASE 2 — produto de agendamento pra vender (clinica/salão/construtora).**
- Sistema maduro desde 2014 (v1.6.1, out/2026): página de agendamento,
  serviços, profissionais, sincronização Google Calendar/CalDAV,
  multilíngue (40+), API REST + webhooks. Roda em hospedagem PHP barata.
- **Encaixe**: nos sites-demo, seção "Agende uma visita" (visita técnica da
  construtora, horário na clínica). Não é só site — vira **sistema**,
  justificando a faixa R$ 3.000–5.000.
- ⚠️ É a primeira ferramenta que **precisa de hospedagem** (PHP 8.2+ e
  MySQL). Nunca vender como "grátis sem servidor": a hospedagem (~R$ 15–40/
  mês) entra no mensal do cliente.
- **Cal.com NAO serve mais**: virou closed source em abr/2026; o fork
  Cal.diy é MIT mas o próprio mantenedor diz "personal, non-production".

## 9. CRM open-source: EspoCRM (AGPL-3.0 · ⭐ 3,5k · PHP) vs Twenty (AGPL-3.0 · ⭐ 61k · TS)
**FASE 2 — só quando o `status.json` da fila virar gargalo (vários funis).**
- **EspoCRM é a escolha**: leve (~380 MB RAM no total), maduro (2014),
  mass email + IMAP embutidos, REST API, roda em VPS 2 GB. Menos estrela,
  mais estabilidade.
- **Twenty**: moderno (GraphQL, UI bonita) mas jovem, releases semanais
  com breaking changes, 2–4 GB de RAM, SSO/permissões atrás do plano pago.
  Watchlist.
- Hoje: `status.json` + `--funil` cobre bem 20 msgs/dia. CRM só compensa a
  partir de ~3 funis simultâneos.

## 10. n8n (n8n-io/n8n) — fair-code (Sustainable Use License, NÃO é OSI)
**WATCHLIST FASE 3 — cola visual entre WhatsApp/Ollama/GSC quando houver servidor 24/7.**
- Self-host grátis; licença restringe revenda como SaaS. Integrações
  prontas com Evolution API, Dify, WhatsApp Cloud, HTTP.
- Hoje nossos scripts Node (gerar-fila, converter, auditor, palavras-chave)
  fazem o mesmo sem servidor nem login. n8n só entra quando o fluxo
  precisar rodar sozinho com o PC desligado.

## 11. Ollama — motor MIT · modelos locais grátis
**FASE 3.** Roda LLM na máquina (ex.: Gemma/Qwen pequenos). Encaixe real:
automação offline com n8n e resumos de transcrição do harken. O agente
atual já cobre geração de textos sem custo — Ollama só vale quando algo
precisar rodar 24/7 sem internet/API.

## 12. Analytics do site do cliente: Umami (MIT) / Plausible (AGPL)
**FASE 2 — painel de visitas vira entregável do mensal.** Ambos
open-source e self-host, sem cookie banner (LGPD mais simples). Precisa de
VPS/hospedagem — mesma regra do Easy!Appointments: cliente paga a infra
dentro da mensalidade. Não instalado.

## Ordem de adoção recomendada (ronda 3)

| # | Ação | Esforço | Ganho |
|---|---|---|---|
| 1 | **harken instalado + MCP** (transcrever áudios de cliente) | feito | briefings por áudio viram texto na hora |
| 2 | Easy!Appointments como PRODUTO (agendamento) em 1º cliente que pedir | ~3h + hospedagem | sobe o ticket de site para "site + sistema" |
| 3 | EspoCRM quando o funil passar de 3 frentes | ~2h + VPS | fim da planilha, follow-up disciplinado |
| 4 | Umami no 1º contrato mensal | ~1h + VPS | relatório de visitas = retenção do mensal |
| 5 | WhatsApp API não oficial — NÃO (só com número dedicado) | — | risco de perder o número não paga |
| 6 | n8n + Ollama — só com servidor 24/7 | — | automação sem depender do PC |

## Ordem de adoção recomendada (ronda 2)

| # | Ação | Esforço | Ganho |
|---|---|---|---|
| 1 | Scrapling no enriquecimento do gerar-fila (403 hoje → stealth fetch) | ~1h | enriquecimento passa a funcionar em QUALQUER site |
| 2 | open-seo: auditar site da Construtora Rodrigues Santos → relatório pro pitch | ~1h | munição numérica na proposta que tá pronta |
| 3 | Presenton async: deck de apresentação do lead gerado do contexto.md | ~2h | pitch deck por lead |
| 4 | OpenShorts local p/ cortes de vídeo (GPU/CPU pesado) | ~4h | NOVA linha de receita de conteúdo |
| 5 | Dify — watchlist só | — | — |
