# Agente Comercial VPS (WhatsApp Business + Claude + Handoff)

Conecta seu **WhatsApp Business** via QR Code (Evolution API) na sua VPS para prospectar a fila do `gerar-fila.mjs`, conversar com **Claude** até o **"Ok!"** do cliente e te avisar no **Telegram** para você entrar e fechar o Pix.

> **Proteção de conversas pessoais:** O webhook **só responde** números que existam em `agencia-ia/prospeccao/status.json`. Clientes atuais, amigos ou família que mandarem mensagem no seu WhatsApp Business são 100% ignorados pela IA.

## Passo a passo na VPS

### 1. Configurar variáveis
```bash
cd agencia-ia/agente-vps
cp .env.example .env
# Edite o .env com sua ANTHROPIC_API_KEY, EVOLUTION_API_KEY e TELEGRAM_BOT_TOKEN/CHAT_ID
```

### 2. Subir a Evolution API (Docker)
```bash
docker compose up -d
```

### 3. Criar instância e ler o QR Code do WhatsApp Business
Crie a instância apontando o webhook para `http://host.docker.internal:3005/webhook/whatsapp` (ou IP da bridge Docker `172.17.0.1:3005`):
```bash
curl -X POST http://127.0.0.1:8081/instance/create \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "wins-comercial",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true,
    "webhook": {
      "url": "http://172.17.0.1:3005/webhook/whatsapp",
      "byEvents": false,
      "base64": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```
Depois abra `http://127.0.0.1:8081/instance/connect/wins-comercial` (via túnel SSH) ou pegue o QR Code retornado e escaneie no **WhatsApp Business → Aparelhos conectados**.

### 4. Rodar o servidor de respostas (24/7)
```bash
node server-webhook.mjs
# Em produção na VPS, use pm2 ou systemd:
# pm2 start server-webhook.mjs --name wins-agente
```

### 5. Testar e rodar os disparos
```bash
# Simular sem enviar nada:
node worker-disparo.mjs --dry-run

# Enviar respeitando horário comercial e limite diário:
node worker-disparo.mjs
```
Você pode agendar o `worker-disparo.mjs` no `cron` da VPS (ex.: 1x às 09:15 de seg–sex).

## Cuidados para não perder o número
- Mantenha `MAX_DISPAROS_DIA` entre **15 e 20** nos primeiros dias (e nunca passe de 30–40).
- Use um número secundário ou já aquecido (não use chip novo no primeiro dia disparando).
- Se o cliente disser que não quer, o agente marca `descartado` automaticamente e não manda mais nada.
