# Publicar o WiNS Hub em winshubcomercial.com.br

Esta pasta tem tudo para rodar a ferramenta num servidor Linux e servir em
`https://winshubcomercial.com.br`, com certificado HTTPS automático e senha de
acesso.

## O que você precisa

- **Um servidor (VPS) Linux** com Docker. Mínimo prático: 2 vCPU, 4 GB de RAM e
  30 GB de disco (o Chromium que faz as buscas consome bastante memória).
  Ubuntu 22.04/24.04 ou Debian 12 servem.
- **Acesso ao DNS do domínio** `winshubcomercial.com.br` (no registrador, onde
  você comprou o domínio).
- **Portas 80 e 443 liberadas** no firewall do servidor.

> Hoje o domínio aponta para `2.25.162.199` (IP da Akamai, típico de
> estacionamento do registrador) e não responde. Esse apontamento precisa ser
> trocado pelo IP do seu VPS.

## 1. Apontar o domínio

No painel do registrador, na zona DNS:

| Tipo | Nome | Valor |
|------|------|-------|
| A | `@` | IP público do seu VPS |
| A | `www` | IP público do seu VPS |

Apague registros antigos de `@`/`www` que apontem para o estacionamento. A
propagação costuma levar de minutos a algumas horas.

## 2. Instalar o Docker no servidor

Entre no servidor por SSH e rode:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Saia e entre de novo no SSH para o grupo valer.

## 3. Enviar o projeto para o servidor

Na sua máquina, dentro da pasta do projeto:

```bash
scp -r . usuario@IP-DO-VPS:~/winshub
```

(Ou clone o repositório direto no servidor, se ele estiver num Git remoto.)

## 4. Criar a senha de acesso

No servidor, dentro de `~/winshub/deploy`:

```bash
chmod +x definir-senha.sh
./definir-senha.sh 'ESCOLHA-UMA-SENHA' wins
```

Isso gera o `caddy.env` com o hash bcrypt já escapado. O escape é necessário
porque o Docker Compose interpola `$` nos valores de env_file; sem dobrar cada
`$`, o hash chega corrompido ao Caddy e a senha nunca funciona.

## 5. Subir

```bash
docker compose up -d --build
```

A primeira execução compila a aplicação e baixa o Chromium (alguns minutos).

## 6. Conferir

```bash
docker compose ps
docker compose logs -f caddy
```

Abra `https://winshubcomercial.com.br`. O navegador deve pedir usuário e senha
(os definidos em `caddy.env`) e então mostrar o painel. O certificado é emitido
sozinho na primeira visita, quando o DNS já estiver apontando para o VPS.

## Atualizar depois de mudar o código

```bash
cd ~/winshub
git pull            # se estiver usando Git no servidor
cd deploy
docker compose up -d --build
```

Os dados ficam no volume `winshub_data` (`/data` dentro do container): banco de
buscas e planilhas CSV sobrevivem a reinícios e atualizações.

## Ajustes úteis

- **Velocidade:** no `docker-compose.yml`, o `-c 2` é a concorrência. Em VPS
  maior, pode subir para `-c 4`.
- **Proxy:** se o Google começar a pedir captcha (comum em IP de datacenter),
  acrescente `-proxies` na lista `command` do serviço `winshub`, no formato
  `http://usuario:senha@host:porta`.
- **Backup:** `docker run --rm -v deploy_winshub_data:/data -v "$PWD":/backup alpine tar czf /backup/winshub-backup.tgz /data`

## Variante: servidor que já tem Nginx (Hostinger 187.127.253.42)

Nesse caso não use o `docker-compose.yml` com Caddy — o Caddy brigaria pelas
portas 80/443 com o Nginx existente. Use:

```bash
docker compose -f docker-compose.vps.yml up -d --build
```

O container fica em `127.0.0.1:8080` e o site é publicado pelo Nginx:

```bash
sudo cp nginx/winshubcomercial.com.br.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/winshubcomercial.com.br.conf /etc/nginx/sites-enabled/
sudo htpasswd -bcB /etc/nginx/.htpasswd-winshub wins 'SUA-SENHA'
sudo chown root:www-data /etc/nginx/.htpasswd-winshub && sudo chmod 640 /etc/nginx/.htpasswd-winshub
sudo nginx -t && sudo systemctl reload nginx
```

Antes disso, aponte `@` e `www` para o IP desse servidor (o registro atual aponta
para o servidor de banco de dados).

### HTTPS, backup e senha (servidor com Nginx)

Depois que o DNS apontar para este servidor, o `ativar-https.sh` emite o
certificado pelo plugin do Nginx e ativa o redirect de HTTP para HTTPS. Ele pode
rodar sozinho pelo timer até o DNS propagar:

```bash
sudo cp backup.sh ativar-https.sh /opt/winshub/deploy/
sudo cp systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now winshub-backup.timer winshub-https.timer
```

- `winshub-https.timer` consulta o DNS público a cada 10 min, emite o
  certificado quando o domínio aponta para cá e se desliga em seguida.
- `winshub-backup.timer` roda todo dia às 03:30 UTC e guarda 7 dias de
  `/var/backups/winshub/winshub-*.tgz` (volume `deploy_winshub_data`).
- Trocar a senha: `sudo htpasswd -bcB /etc/nginx/.htpasswd-winshub wins 'NOVA-SENHA'`
  e `sudo systemctl reload nginx`.

## Antes de divulgar, saiba

- **O painel não tem login próprio.** A proteção é o `basic_auth` do Caddy.
  Não remova essa parte do `Caddyfile` sem colocar outra autenticação na frente.
- **Um servidor só, sem fila.** Cada busca abre um navegador; buscas simultâneas
  de várias pessoas disputam a mesma memória. Para uso comercial com clientes,
  vale migrar para a versão SaaS do projeto (`cmd/gmapssaas`), que tem contas,
  banco Postgres e workers.
- **Termos do Google e LGPD.** Coletar o Maps automaticamente contraria os
  termos do Google, e o IP do servidor pode acabar bloqueado por um tempo.
  Mantenha o uso moderado e trate os contatos conforme a LGPD.
