---
name: Gerador de Proposta em PDF
description: Gera a proposta comercial do cliente como PDF profissional (3 opções de preço com ancoragem) usando o skill pdf da Anthropic. Usar quando o usuário pedir "gera proposta", "gera o PDF da proposta" ou quiser preencher o template para enviar ao cliente.
---

# Proposta Comercial em PDF

Converte o template de proposta da agência num PDF pronto para enviar no WhatsApp.

## Fluxo

1. **Pega o contexto do cliente** — leia `clientes\<pasta-do-cliente>\contexto.md`
   (relativo à raiz `agencia-ia\`). Sem contexto, pergunte: nome do negócio,
   nicho, cidade, serviços principais e nome do contato.
2. **Preenche o template** — leia `..\..\propostas\template-proposta.md` e
   preencha com o contexto real. NUNCA invente dados/ticket: use
   `[SUBSTITUIR: ...]` onde faltar informação.
3. **Preço sempre em 3 opções** (ancoragem):
   - Essencial (site simples) — base R$ 1.500–2.500
   - Completa (recomendada) — site + sistema, R$ 3.000–5.000
   - Crescimento — completa + gestão mensal R$ 500–1.500/mês

   Ajuste conforme nicho e diagnóstico (ver `..\comercial.md`).
4. **Renderiza em PDF** — invoque o skill `pdf` (da Anthropic, já instalada
   na pasta vizinha desta) com o método de *criação de documento*:
   HTML estilizado → PDF. Regras de estilo:
   - Máximo 2 páginas (proposta curta fecha mais)
   - Tipografia Inter/Montserrat, paleta verde #2F9E44 + grafite #0F1216
   - Tabela comparativa das 3 opções na página 1
   - Rodapé com dados de contato e forma de pagamento (Pix)
5. **Salva** o PDF em `clientes\<pasta>\proposta.pdf` e a fonte markdown em
   `clientes\<pasta>\proposta.md`.

## Regras

- Validade da proposta: 7 dias (mesmo padrão das abordagens em
  `..\..\prospeccao\whatsapp.md`).
- Garantia única: revisões ilimitadas OU reembolso — nunca as duas.
- Se o cliente fechou: atualize o funil do lead com
  `node agencia-ia\prospeccao\gerar-fila.mjs --status <ID-lead> fechado`.
