#!/bin/sh
# Gera o caddy.env com o hash bcrypt da senha, escapado para o Docker Compose.
# Uso: ./definir-senha.sh 'sua-senha' [usuario]
set -e

if [ -z "$1" ]; then
	echo "uso: $0 'sua-senha' [usuario]" >&2
	exit 1
fi

USER_NAME="${2:-wins}"

HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$1")"
# O Compose interpola "$" nos valores de env_file, o que corromperia o hash.
# Dobrar cada "$" faz o Compose entregar o hash literal ao Caddy.
ESCAPED="$(printf '%s' "$HASH" | sed 's/\$/$$/g')"

cat > caddy.env <<EOF
BASIC_AUTH_USER=$USER_NAME
BASIC_AUTH_HASH=$ESCAPED
EOF

echo "caddy.env criado para o usuario '$USER_NAME'."
echo "Agora rode: docker compose up -d --build"
