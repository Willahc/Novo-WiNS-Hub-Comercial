# Agência IA — Starter Gratuito

Estrutura que substitui o "sistema de agência" vendido pronto: um agente de IA
(Antigravity, OpenCode, Gemini CLI, Claude Code...) + arquivos de instrução e
contexto. O agente lê estes arquivos e vira seus 5 especialistas.

## Como usar (3 passos)

1. **Abra a pasta `agencia-ia\` no seu agente de IA** (o mesmo jeito que você
   abriria um projeto de código). O agente lê o `AGENTS.md` da raiz
   automaticamente e assume o papel da agência.

2. **Para cada cliente novo:**
   - Copie `clientes\template-cliente\` e renomeie para o nome do cliente
     (ex: `clinica-sorrir\`)
   - Preencha o `contexto.md` com os dados reais do negócio
   - Peça: "Leia o contexto.md em clientes\clinica-sorrir e crie o site dele"

3. **Trabalhe normal no chat**: "crie a página de vendas", "gere a proposta",
   "crie 3 criativos para Instagram", "monte a campanha Google Ads".

## O que tem aqui

```
agencia-ia\
├── AGENTS.md                 ← instruções mestras (o "sistema")
├── README.md                 ← este arquivo
├── ferramentas-opensource.md ← catálogo de ferramentas FOSS mapeadas (Nov/2026)
├── skills\                   ← skills padrão SKILL.md — descobertas automaticamente
│   ├── dev.md                ← programador: sites, sistemas, painéis
│   ├── designer.md           ← designer: identidade visual, criativos
│   ├── copywriter.md         ← copywriter: textos que vendem
│   ├── trafego.md            ← gestor de tráfego: Meta e Google Ads
│   ├── comercial.md          ← comercial: diagnóstico e proposta
│   ├── proposta-pdf\         ← proposta em PDF (usa o skill `pdf` da Anthropic)
│   └── pdf\                  ← skill oficial da Anthropic (Apache 2.0)
├── clientes\
│   └── template-cliente\     ← modelo de pasta por cliente
│       └── contexto.md
├── prospeccao\
│   ├── converter-leads.mjs    ← CSV do scraper → leads.json (fecha o funil)
│   ├── gerar-fila.mjs        ← leads → fila priorizada (v2: aprende com feedback)
│   ├── exemplo-leads.json    ← referência do formato de entrada
│   └── whatsapp.md           ← abordagens prontas (demo, follow-up, objeções)
└── propostas\
    └── template-proposta.md  ← modelo de proposta com ancoragem de preço
```

### Registro das skills (OpenCode)

O `opencode.jsonc` na raiz do workspace registra `./agencia-ia/skills`.
Os IDs derivam dos arquivos: `dev`, `designer`, `copywriter`, `trafego`,
`comercial`, `proposta-pdf`, `pdf`. No Claude Code/Cursor, copie a pasta
para `.claude/skills/`. Formato: padrão aberto (agentskills.io).

## Regra de ouro

A memória de cada cliente vive na pasta dele. Antes de qualquer entrega, o
agente DEVE ler (ou você colar) o `contexto.md` do cliente — senão ele
"esquece" as informações, exatamente como acontece em qualquer chat comum.

## Publicar o site de graça

Peça ao agente: "instruções para publicar este site gratis na Vercel/Netlify".
Resumo: conta gratuita no GitHub → repositório → conecta na Vercel/Netlify →
link `nome-cliente.vercel.app` em ~2 minutos.
