# Ferramentas open source para evoluir o WiNS Hub Comercial

Levantamento feito em 10/11/2026. **Nada foi instalado ou aplicado** — esta lista
existe para decidir depois, item por item.

Contexto do que a ferramenta já usa (para não sugerir redundância): `playwright-go`
+ `scrapemate`, River (fila), `go-leadsdb`, dedupe por hash exato (`deduper`),
PostHog, S3 para CSVs, SQLite (`jobs.db`) na VPS.

## Resumo por prioridade

| # | Ferramenta | Resolve | Licença | Stack | Esforço | Prioridade |
|---|-----------|---------|---------|-------|---------|------------|
| 1 | Litestream | backup contínuo do SQLite | Apache-2.0 | Go | baixo | alta |
| 2 | wappalyzergo | qualificar o site do lead | MIT | Go | baixo | alta |
| 3 | phonenumbers | telefone/WhatsApp confiável | MIT | Go | baixo | alta |
| 4 | email-verifier | validar e-mail extraído | MIT | Go | baixo | média |
| 5 | Overture Maps | fonte alternativa de empresas | CDLA-P 2.0 | SQL/DuckDB | médio | média |
| 6 | Minha Receita / OpenCNPJ | dados oficiais de CNPJ | MIT / aberto | API | médio | média |
| 7 | Twenty CRM | pipeline depois do CSV | AGPL-3.0 | Docker | alto | baixa |
| 8 | fuzzy dedupe | juntar duplicatas parecidas | MIT | Go | baixo | baixa |

## 1. Litestream — backup contínuo do `jobs.db`

- Repo: https://github.com/benbjohnson/litestream
- Hoje: `winshub-backup.timer` copia o banco uma vez por dia (03:30 UTC). Uma
  queda às 15h perde o dia inteiro de buscas.
- O que faz: replica o WAL do SQLite continuamente para um destino compatível com
  S3 e restaura em segundos.
- Custo/risco: baixo. Roda como sidecar no `docker-compose.vps.yml`, sem alterar
  o app. Precisa de um destino (outro bucket/VPS ou disco separado).
- Como ativar: adicionar serviço `litestream` montando o volume
  `deploy_winshub_data`, configurar réplica, testar restauração num banco de teste
  e só então manter o backup diário como segunda camada.

## 2. wappalyzergo — qualificar o site do lead

- Repo: https://github.com/projectdiscovery/wappalyzergo
- Por que: a busca já visita o site de cada empresa quando "Buscar e-mails" está
  ligado, mas não olha o que voltou. Identificar WordPress, Wix, Shopify,
  plataforma antiga etc. permite filtros de venda muito mais específicos que o
  atual "Sem site".
- Efeito no produto: novos filtros no painel ("site em WordPress", "sem loja",
  "plataforma pronta") e uma coluna de tecnologia no CSV.
- Custo/risco: baixo. Biblioteca Go pura, sem dependência externa.
- Como ativar: rodar a detecção no mesmo estágio HTTP que busca e-mail, guardar as
  tecnologias no resultado do job e expor como filtro. Antes, medir no CSV atual
  quantos leads têm site em plataforma antiga — se for pouco, o discurso de venda
  não muda e o item cai de prioridade.

## 3. phonenumbers — telefone e WhatsApp confiáveis

- Repo: https://github.com/nyaruka/phonenumbers (v2)
- Por que: hoje "é celular, logo WhatsApp" é heurística. A lib é o port oficial do
  libphonenumber: valida, formata em E.164, separa fixo/celular e informa região.
- Efeito no produto: acaba WhatsApp falso, "Copiar telefones" sai normalizado.
- Custo/risco: baixo. Biblioteca Go, metadados embutidos.
- Como ativar: normalizar o campo telefone na gravação do resultado e recalcular a
  flag de WhatsApp do painel.

## 4. email-verifier — validar e-mail antes de entregar

- Repo: https://github.com/AfterShip/email-verifier
- Por que: o e-mail extraído do site entra no CSV sem checagem e pode voltar na
  primeira campanha.
- O que faz: sintaxe, MX, SMTP opcional, catch-all e domínio descartável.
- Custo/risco: baixo, mas o teste SMTP depende da porta 25 liberada na VPS — sem
  ela, usar só sintaxe + MX, que já filtra a maior parte do lixo.
- Como ativar: validar no fim do job, marcar `email_status` no CSV e permitir
  filtrar por "e-mail válido".

## 5. Overture Maps — Places (fonte alternativa)

- Docs: https://docs.overturemaps.org/guides/places
- O que é: dataset aberto com ~88 milhões de lugares (release out/2026), com nome,
  categoria, telefone, site, e-mail, redes sociais e endereço, em GeoParquet.
- Para que serve aqui: enriquecer o que o Maps devolveu e cobrir bairros onde o
  Maps limita resultados, sem risco de captcha.
- Custo/risco: médio. Consultas diretas no S3 são lentas; o certo é extrair o
  recorte do Brasil/PR uma vez por mês para Parquet local e consultar por SQL.
- Como ativar: gerar o extrato com DuckDB, comparar com um CSV de busca real
  (quantos leads novos/sem site aparecem) antes de integrar ao painel.

## 6. Minha Receita / OpenCNPJ — dados oficiais de CNPJ

- Repos: https://codeberg.org/cuducos/minha-receita (Go) · https://opencnpj.org
- O que permite: enriquecer com CNAE secundário, porte, situação cadastral e
  sócios; e o caminho inverso — listar empresas de um CNAE numa cidade pela base
  oficial, como fonte complementar ao Maps.
- **Ressalva de infraestrutura**: o self-hosted pede ~180 GB de disco, inviável na
  VPS atual (1 vCPU, 3,8 GB). O uso realista é consumir a API pública
  (`minhareceita.org`, BrasilAPI) ou o OpenCNPJ.
- Custo/risco: médio (dependência de serviço público, sem SLA).
- Como ativar: enriquecer apenas os leads que já têm CNPJ identificado; cachear
  respostas no `jobs.db` para não repetir consulta.

## 7. Twenty CRM — pipeline depois do CSV

- Repo: https://github.com/twentyhq/twenty (AGPL-3.0, ~60 mil ⭐)
- Por que: a ferramenta termina no CSV, o funil começa depois. Twenty tem REST,
  GraphQL e pipeline em kanban.
- Custo/risco: alto. Pede Postgres + Redis; só vale se a dor for "não sei o que
  fiz com a lista".
- Como ativar: subir num ambiente separado (o Postgres de `2.25.162.199` serve) e
  importar uma busca real antes de decidir qualquer integração automática.
- Alternativas mais leves se a necessidade for só organizar dados: NocoDB,
  Baserow ou uma planilha compartilhada.

## 8. Dedupe aproximado

- Opções: `adrg/fuzzy` ou `lithammer/fuzzysearch` (MIT, Go)
- Por que: o `deduper` atual é hash exato — "Dentista Sorriso" e "Sorriso
  Odontologia" no mesmo endereço entram duas vezes. Similaridade sobre
  nome + endereço normalizado resolve a maior parte.
- Como ativar: comparar dentro do mesmo job (e entre buscas, se houver índice
  histórico), com limite de similaridade conservador para não fundir empresas
  diferentes.

## Descartados por ora

- **Camoufox / Patchright / nodriver** (anti-detect): melhores contra bloqueio,
  mas são Python/Node — exigiriam serviço à parte, e `nodriver` é AGPL-3.0. Com IP
  de datacenter falham igual ao Playwright comum; o ganho real vem de proxy
  residencial, que já é o caminho atual. Reavaliar só se o volume de captcha
  crescer muito.
- **libpostal** (normalização de endereço): excelente, mas ~2 GB de dados e CGO,
  não cabe na VPS. Para CEP/endereço brasileiro, ViaCEP/BrasilAPI resolve sem peso.

## Ordem sugerida de ativação

1. Litestream — protege o que já existe, sem tocar no app.
2. wappalyzergo — muda o que o cliente vê e vende (medir antes no CSV atual).
3. phonenumbers — corrige um filtro que hoje pode estar errado.
4. email-verifier — qualidade da lista entregue.
5. Overture Maps — só depois de um teste comparativo com uma busca real.
6. Minha Receita — enriquecimento dos leads com CNPJ.
7. Twenty — se o problema virar gestão de funil.

Os três primeiros são Go, de licença permissiva e rodam dentro do binário ou do
container atual, sem mudança de arquitetura.
