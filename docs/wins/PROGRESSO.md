# WiNS Hub Comercial — estado do projeto

Última atualização: 19/11/2026

Este é o fork do `google-maps-scraper` publicado como serviço unificado em
**https://winshubcomercial.com.br**. O documento resume onde a aplicação roda,
como publicar mudanças e o que já foi entregue.

## O que é

Plataforma unificada em português composta por:
1. **WiNS Hub (Scraper)**: painel + mapa Leaflet que busca empresas no Google Maps por tipo de empresa e/ou CNAE e exporta/envia os resultados.
2. **CRM & Agentes (`/crm`)**: monitoramento de leads, conversas, métricas por nicho, logs ao vivo e botão de Start/Stop do disparo cadenciado.
3. **Agente SDR WhatsApp + Prévias**: Evolution API (`wins-comercial`) + Claude (`claude-sonnet-4-6`) + prévias personalizadas por nicho (`/previa/<slug>`) + handoff no Telegram (`@WiNSHubBot`).

## Onde roda

| Item | Valor |
|------|-------|
| Servidor unificado | `187.53.110.26` (Ubuntu, 2 vCPUs, 7,8 GiB RAM, 90 GB livres) |
| App Scraper | container `deploy-winshub-1`, imagem `winshub:latest`, `127.0.0.1:8080`, `WINSHUB_CONCURRENCY=1` |
| Agente & CRM | serviço systemd `wins-webhook.service` (`127.0.0.1:3005`, `agentes/sdr-whatsapp/server-webhook.mjs`) |
| Disparo | `wins-disparo.service` + `wins-disparo.timer` (ou acionado pelo botão Start em `/crm`) |
| WhatsApp | Evolution API (`wins-evolution-api` em `127.0.0.1:8081` + Postgres + Redis) |
| Entrada | Nginx 1.24 + Let's Encrypt (válido até 10/02/2027) + basic auth (`wins`) |
| Banco | SQLite `jobs.db` no volume `deploy_winshub_data` + `agentes/prospeccao/status.json` |

SSH:

```bash
ssh -i ~/.ssh/winshub_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@187.127.253.42
```

A aplicação não é exposta direto: só o Nginx fala com a internet.

## Como publicar mudanças

O código fica em `/opt/winshub`. Arquivos estáticos são embutidos com `go:embed`,
então **qualquer mudança em `web/static` exige rebuild** da imagem.

```bash
scp -i ~/.ssh/winshub_key <arquivos> root@187.127.253.42:/opt/winshub/<destino>
ssh -i ~/.ssh/winshub_key root@187.127.253.42 \
  'cd /opt/winshub/deploy && \
   docker compose -f docker-compose.vps.yml build && \
   docker compose -f docker-compose.vps.yml up -d'
```

Detalhes de operação (logs, backup, restauração, HTTPS): `deploy/README.md`.

## Funcionalidades entregues

- **Deploy completo**: HTTPS com redirect HTTP→HTTPS, `www` funcionando, app
  atrás de basic auth, container com restart automático e Docker habilitado no boot.
- **Backup diário** do SQLite e dos CSVs: `deploy/backup.sh` +
  `winshub-backup.{service,timer}`, às 03:30 UTC, retenção de 7 dias em
  `/var/backups/winshub`.
- **Cancelamento real de busca**: apagar um job em andamento cancela o contexto do
  scraper (não só some da lista), liberando a fila para o próximo job.
- **Busca apenas por CNAE**: o campo "O que você procura?" pode ficar vazio; o
  código CNAE é traduzido em atividade e em um termo curto para o Maps.
  - `web/cnae.go`: resolução do código e geração do termo.
  - `web/data/cnae.json`: tabela oficial do IBGE embutida no binário (1.332
    subclasses + classes). A VPS **não alcança** `servicodados.ibge.gov.br`
    (timeout), por isso a tabela é local e a resposta é instantânea.
  - Apelidos (`cnaeAliases`) para os CNAEs mais comuns, porque a descrição oficial
    gera buscas ruins: `8630-5/04` → `dentista`, `9313-1/00` → `academia`,
    `9602-5/01` → `salão de beleza`, `4711-3/02` → `supermercado`, etc.
  - `GET /api/v1/cnae/{code}` devolve `cnae`, `atividade` e `termo`;
    `POST /api/v1/jobs` aceita `keywords` vazio quando vem `cnae`.
  - Aceita `4711-3/02`, `4711302`, `4711-3` e `4711` (prefixo cai para a classe).
- **Reorganização do projeto**: pastas `agentes/` (`prospeccao/`, `sdr-whatsapp/`, `closer/`, `entrega/`), `skills/`, `comercial/`, `tools/` e `docs/wins/`.
- **Prévias personalizadas por nicho**: `agentes/entrega/previas/templates.mjs` serve páginas HTML mobile-first em `https://winshubcomercial.com.br/previa/<slug>` (público, sem senha) para Veterinário, Academia, B2B e Geral.
- **Mini-CRM & Controle de Agentes (`/crm`)**: integrado na aba `CRM` do WiNS Hub + botão `Enviar para Agentes` no Painel, com KPIs, desempenho por nicho, histórico de conversas, logs ao vivo e Start/Stop do disparo.
- **Qualificação inteligente & filtro `onWhatsApp`**: `checkWhatsApp()` valida números na Evolution API antes do disparo e `qualificarLead()` escolhe a oferta (Site + Prévia, Site + Vídeos IA ou Ads + Vídeos IA) com regras anti-alucinação.
- **Raio-X Técnico & Auditoria Cirúrgica (`agentes/prospeccao/site-audit.mjs`)**: auditoria automática com Google PageSpeed Insights (nota mobile 0–100 e LCP em segundos), detecção de Google Tag Manager (GTM), Meta Pixel e links WhatsApp, além de lookup de CNPJ/sócios (QSA) via BrasilAPI, integrados ao `crm.mjs` (`/api/crm/audit`) e ao pitch do SDR.
- **Identidade fixa do SDR (`agentes/sdr-whatsapp/server-webhook.mjs` e `lib.mjs`)**: apresentação padronizada como **William da WiNS Hub Comercial** em todo primeiro contato e follow-up, sem variação de nome entre mensagens.
- **Assistente WiNS (Texto + Voz Contínua)**: copiloto interno no painel (`#assistantFab` / `POST /api/crm/assistant` em `crm.mjs`) conectado ao Claude (`callClaude`) com estado ao vivo do CRM, execução real de ações (`search_maps`, `audit_batch`, `start_dispatch`, `stop_dispatch`, `send_email`, `run_email_cadence`, `switch_view`), loop de voz contínuo mãos-livres (`SpeechRecognition` em `pt-BR` com debounce de silêncio + resposta em áudio via `speechSynthesis`) e renderização formatada no chat.
- **E-mail Corporativo SMTP & Cadência D+0/D+3/D+7 (`agentes/sdr-whatsapp/email.mjs`)**: integração via `nodemailer` com Hostinger (`contato@winshubcomercial.com.br`, porta `465` SSL), geração de Cold Email cirúrgico com dados do Raio-X Técnico, rotas `/api/crm/email/test`, `/api/crm/email/send`, `/api/crm/email/cadence` e ações no Assistente WiNS.
- **Fluxo Limpo `Mapa → Dashboard → CRM` (`web/static/templates/index.html`, `wins.js`, `crm.mjs`)**:
  - `Dashboard` dedicado com KPIs, Funil de Conversão, Top Nichos e **Matriz de Oportunidades** clicável (sem tabela duplicada).
  - `CRM` como central única: carrega toda a base scrapada em `Todos` com **Score (0–100)** + etiqueta de oportunidade (`WhatsApp + Sem site`, `E-mail + Sem site`, etc.), filtro por canal/oportunidade, **Simulação (`POST /api/crm/simulate`)** e **Start direto (WhatsApp ou E-mail)** sem passo intermediário.
  - **Sincronização de respostas & fim do descarte automático**: `worker-disparo.mjs` e `server-webhook.mjs` não descartam mais leads automaticamente (mantendo disponíveis para e-mail) e não sobrescrevem `respondeu` durante envios concorrentes.
- **Deduplicação, validação no `[DRY-RUN]` e consistência pós-simulação (`agentes/sdr-whatsapp/worker-disparo.mjs`, `crm.mjs`)**:
  - `worker-disparo.mjs`: deduplica telefones no mesmo lote (`seenPhones`) e executa `checkWhatsApp(phone)` também no `[DRY-RUN]` antes de chamar o Claude (sem alterar `status.json` durante a simulação).
  - `crm.mjs`: `workerState.lastSimulatedKeys` armazena os leads da última simulação do Assistente para que o disparo real subsequente (sem `ids` explícitos) utilize o mesmo lote simulado.
- **Escrita atômica, Prompt Caching, MX & Pitch por origem (`lib.mjs`, `worker-disparo.mjs`, `email.mjs`, `crm.mjs`, `web/static/`)**:
  - `lib.mjs`: `saveStatus()` agora usa escrita atômica (arquivo temporário + `renameSync`), e `callClaude()` suporta `cacheSystem` (Prompt Caching da Anthropic) e `model` configurável (`CLAUDE_FAST_MODEL`).
  - `worker-disparo.mjs`: `detectLeadContext()` adapta o prompt quando o lead vem da base CNPJ (sem avaliações no Maps, razão social longa) e evita citar "São Paulo" quando o DDD diverge.
  - `email.mjs`: `validateEmailMx()` valida sintaxe + registro MX do domínio com cache em memória antes de gerar/enviar cold e-mail.
  - `web/static/`: logo do cabeçalho ampliado (`.brand-logo` em `wins.css` e `index.html`) e imagem reconstruída no container `deploy-winshub-1`.
- **Rastreamento de prévia, IMAP INBOX, cadência automática & detecção de stack (`server-webhook.mjs`, `email.mjs`, `worker-disparo.mjs`, `gmaps/`, `wins.js`)**:
  - `server-webhook.mjs`: `/previa/:slug` contabiliza `previewViews`/`previewLastViewedAt` (ignorando bots) e envia alerta no Telegram; scheduler a cada 15 min verifica respostas na `INBOX` via IMAP (`checkInboxReplies`) e dispara follow-ups D+3/D+7 devidos (`runDueEmailCadence`) em horário comercial.
  - `email.mjs`: envio inclui link automático da prévia + imagem `.png` incorporada (`cid:previa-site`), e `--dry-run` / `dryRun` pula chamadas ao Claude.
  - `worker-disparo.mjs`: prioriza celulares e DDD alvo (`TARGET_DDD`) na fila de WhatsApp; `--dry-run` não gasta tokens do Claude por padrão.
  - `gmaps/emailjob.go` & `gmaps/entry.go`: `detectSiteTech()` identifica WordPress, Wix, Shopify, Nuvemshop, Webflow, RD Station, GTM e Meta Pixel em `Entry.Tech`.
  - `web/static/js/wins.js`: formatação visual `(DD) 99999-9999` nos cards do CRM e badge `👀 Viu prévia (Nx)`.
- **Auditoria geral, correções críticas & otimizações de performance (`server-webhook.mjs`, `crm.mjs`, `email.mjs`, `lib.mjs`, `auth.mjs`, `worker-disparo.mjs`, `telegram-bot.mjs`, `monitor-silencioso.mjs`, `gerar-fila.mjs`, `gmaps/entry.go`, `web/places.go`, `index.html`, `wins.js`)**:
  - **Estabilidade & Concorrência:** deduplicação por `messageId` + fila/debounce de 3,5 s por telefone no webhook WhatsApp (eliminando respostas duplicadas), proteção global contra `URIError`/`decodeURIComponent` em `server-webhook.mjs` e `auth.mjs`, e `patchStatus()` atômico em todas as operações assíncronas longas.
  - **Áudio no WhatsApp:** suporte a `audioMessage`/`pttMessage` com transcrição automática via Groq Whisper / OpenAI Whisper / Gemini Flash (quando configurados no `.env`) e fallback imediato com alerta no Telegram + resposta educada.
  - **E-mail & Raio-X:** `email.mjs` agora lê/grava `lead.siteAudit` real, corrige transição `mapeado → enviado` (recuperando 19 leads órfãos), corrige `logActivity("Email", ...)`, escapa HTML e clona `history` no `dryRun`.
  - **Performance & CRM:** `overviewBaseCache` em memória + paginação/filtro/ordenação server-side em `/api/crm/overview` (**10 KB gzip, ~6 ms quente**), exportação direta `GET /api/crm/export.csv`, propagação completa de `Entry.Tech` (Go CSV → `/places` → `crm.mjs` → filtro `#crmTechFilter` e badges na UI), aba **Todos** restrita a pendentes de ação e filtro `E-mail + Sem site` unificado.
  - **Infraestrutura VPS:** 2 GB de swap (`/swapfile`) habilitado, remoção do backup duplicado no `crontab`, contadores diários em `America/Sao_Paulo` (`todayBr()`), DDD obrigatório no match por 8 dígitos (`findLeadByPhone`), timeouts explícitos (`AbortSignal.timeout`) e `monitor-silencioso.mjs` apontando para `/health`.

- **Materiais executivos e comerciais (`docs/wins/`)**:
  - `docs/wins/Apresentacao_WiNS_Hub_Comercial.pdf`: apresentação institucional e técnica detalhada da plataforma (8 páginas A4).
  - `docs/wins/Proposta_WiNS_Hub_Progen_SA.pdf`: proposta executiva B2B de mapeamento e pré-qualificação de fornecedores e clientes para a Progen S.A., incluindo amostra piloto real de Macaé/RJ (8 páginas A4).

## Correções que já foram necessárias

- `Dockerfile`: copiar `third_party` antes de `go mod download`.
- `web/job.go`: struct `JobData` sem chave de fechamento.
- `web/sqlite/sqlite.go`: `SELECT *` divergindo das 7 colunas com `cnae`, o que
  deixava jobs presos em `pending`.
- `runner/webrunner`: contexto por job para permitir cancelamento.

## Verificação

- `go test ./web/ -run CNAE` — 7 testes (subclasse, só dígitos, fallback de classe,
  prefixo, apelidos, código inválido, limpeza de descrição).
- `go test ./web/sqlite/ ./runner/webrunner/` — ok.
- **Falha conhecida e pré-existente**: `TestIndexScrapeFormReplacesPaginatedJobs`
  em `web/web_test.go` falha porque o template customizado não tem
  `hx-target="#job-tbody"`. Não afeta o painel em produção.
- `runner/filerunner` falha no Windows por lock de `TempDir`.

## Pendências

- Botão de pausa foi dispensado: o caso de uso é cancelar e liberar a fila.
- Nenhum job de teste deixado no painel; o job do usuário
  "Veterinario · São paulo" (`ok`) foi preservado.
- O banco (`jobs.db`) e os CSVs vivem só no volume do servidor e nos backups —
  não entram no git.

## Próximos passos

- Acompanhar respostas e aberturas de prévia do lote D+0 enviado (9 leads de veterinária sem site) e follow-ups automáticos D+3/D+7.
- Executar a prospecção dos decisores da Progen S.A. (Suprimentos/PMO e Manutenção/Facilities) usando os comandos do Open Bot, os roteiros e os PDFs em `docs/wins/`.
- Definir o próximo lote de prospecção (WhatsApp ou E-mail) a partir da fila limpa **Todos** no CRM.
