# Agentes — WiNS Hub Comercial

Estrutura dos agentes autônomos de captação, prospecção, fechamento e entrega:

- `prospeccao/` — Conversão de CSVs (`converter-leads.mjs`), auditoria (`auditor-seo.mjs`), geração de fila priorizada (`gerar-fila.mjs`) e estado do funil (`status.json`).
- `sdr-whatsapp/` — Evolution API (`docker-compose.yml`), disparo cadenciado (`worker-disparo.mjs`) e atendimento 24/7 via Claude (`server-webhook.mjs`) com handoff no Telegram.
- `closer/` — Agente de proposta, demonstração e fechamento (próxima etapa do funil).
- `entrega/` — Playbooks e automações de entrega (sites, gestão de Ads e vídeos curtos com IA).
- `AGENTS-AGENCIA.md` — Instruções mestras dos papéis da agência.

