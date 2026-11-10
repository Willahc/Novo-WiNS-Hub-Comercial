# WiNS Hub Comercial — estado do projeto

Última atualização: 10/11/2026

Este é o fork do `google-maps-scraper` publicado como serviço em
**https://winshubcomercial.com.br**. O documento resume onde a aplicação roda,
como publicar mudanças e o que já foi entregue.

## O que é

Interface web em português (painel + mapa Leaflet) que busca empresas no Google
Maps por tipo de empresa e/ou CNAE, em uma localidade, e entrega os resultados em
CSV. Cada busca vira um job persistido em SQLite.

## Onde roda

| Item | Valor |
|------|-------|
| Servidor web | `187.127.253.42` (Hostinger, Ubuntu 24.04, 1 vCPU, 3,8 GB) |
| App | container `deploy-winshub-1`, imagem `winshub:latest`, `127.0.0.1:8080` |
| Entrada | Nginx 1.24 + Let's Encrypt (válido até 08/02/2027) + basic auth |
| Banco | SQLite `jobs.db` no volume Docker `deploy_winshub_data` |
| Postgres | instância separada em `2.25.162.199` (não usada nesta variante) |
| Concorrência | 1 job por vez (`WINSHUB_CONCURRENCY=1` no `.env` do servidor) |
| Acesso | usuário `wins` (senha definida com `deploy/definir-senha.sh`) |

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
