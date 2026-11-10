#!/bin/sh
# Emite o certificado Let's Encrypt quando o DNS do dominio apontar para este
# servidor. Roda a cada 10 min pelo winshub-https.timer e se desliga sozinho
# depois de concluir.
set -eu

DOMAIN="${WINSHUB_DOMAIN:-winshubcomercial.com.br}"

MYIP="$(curl -s --max-time 10 https://api.ipify.org || true)"
# Consulta DNS publico (DoH) para nao depender do cache do resolvedor local.
RESOLVED="$(curl -s --max-time 10 -H 'accept: application/dns-json' \
	"https://cloudflare-dns.com/dns-query?name=$DOMAIN&type=A" \
	| grep -o '"data":"[0-9.]*"' | head -1 | cut -d'"' -f4)"
if [ -z "$RESOLVED" ]; then
	RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
fi

if [ -z "$RESOLVED" ] || [ "$RESOLVED" != "$MYIP" ]; then
	echo "dns ainda aponta para '${RESOLVED:-vazio}' (esperado $MYIP); nada a fazer"
	exit 0
fi

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
	echo "certificado ja existe"
	systemctl disable --now winshub-https.timer 2>/dev/null || true
	exit 0
fi

certbot --nginx \
	-d "$DOMAIN" -d "www.$DOMAIN" \
	--redirect --non-interactive --agree-tos \
	--register-unsafely-without-email

systemctl disable --now winshub-https.timer 2>/dev/null || true
echo "https ativo em https://$DOMAIN"
