---
name: prospeccao-b2b
description: Executa a esteira completa do WiNS Hub Comercial (scraping/CSV -> filtro ICP + BrasilAPI -> prévia HTML/PNG -> disparo Evolution API -> proposta Closer no CRM).
---

# Esteira de Prospecção B2B — WiNS Hub Comercial

Quando o usuário pedir para prospectar um novo nicho/região ou rodar um lote, execute as fases abaixo usando a infraestrutura real do `/root/wins-hub`:

## Fase 1: Coleta e Conversão
1. Os leads são coletados via scraper em `https://winshubcomercial.com.br` ou colocados como `.csv` em `webdata/`.
2. Converta para JSON unificado:
   ```bash
   node /root/wins-hub/agentes/prospeccao/converter-leads.mjs -o /root/wins-hub/agentes/prospeccao/leads.json
   ```

## Fase 2: Qualificação ICP + Validação Fiscal
1. Gere a fila priorizada com filtro ICP estrito (`nota >= 4.0`, `avaliacoes >= 15`, celular válido e validação fiscal via BrasilAPI para `ATIVA`, `não-MEI` e `>= 3 anos` quando o CNPJ estiver presente):
   ```bash
   node /root/wins-hub/agentes/prospeccao/gerar-fila.mjs /root/wins-hub/agentes/prospeccao/leads.json --limit 20 --canal whatsapp
   ```
   *(Use `--relaxed` apenas se nenhum lead passar no filtro estrito e o usuário autorizar.)*

## Fase 3: Prévias Visuais e Simulação de Disparo
1. Simule o lote antes de qualquer envio real:
   ```bash
   node /root/wins-hub/agentes/sdr-whatsapp/worker-disparo.mjs --dry-run
   ```
2. No envio real (pelo CRM ou CLI), leads sem site próprio ou com apenas rede social recebem automaticamente o screenshot `.png` da prévia personalizada (`/previa/:slug`) via Evolution API (`sendWhatsAppMedia`), respeitando cadência anti-bloqueio (`DELAY_MIN_SEG`..`DELAY_MAX_SEG`, máx. `MAX_DISPAROS_DIA` em horário comercial) e follow-up automático em 48h.

## Fase 4: Atendimento e Fechamento (Closer)
1. O `wins-webhook.service` responde os interessados via Claude (`server-webhook.mjs`) e notifica no Telegram.
2. Quando o lead demonstrar interesse no CRM (`https://winshubcomercial.com.br`), use o botão **Gerar Proposta (Closer)** (`POST /api/crm/proposta`) para gerar diagnóstico, pacote (Site + Google/Meta Ads + Vídeos Curtos com IA), ancoragem de investimento e respostas a objeções.

