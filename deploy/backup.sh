#!/bin/sh
# Backup do volume de dados do WiNS Hub (banco SQLite + CSVs dos jobs).
# Uso: ./backup.sh   (agendado pelo winshub-backup.timer)
set -eu

DEST="${WINSHUB_BACKUP_DIR:-/var/backups/winshub}"
VOLUME="${WINSHUB_VOLUME:-deploy_winshub_data}"
REPO_DIR="${WINSHUB_REPO_DIR:-/root/wins-hub}"
RETENTION_DAYS="${WINSHUB_RETENTION_DAYS:-7}"

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"

docker run --rm \
	-v "$VOLUME":/data:ro \
	-v "$DEST":/backup \
	alpine:3 \
	tar czf "/backup/winshub-$STAMP.tgz" -C /data .

if [ -d "$REPO_DIR/agentes" ]; then
	tar czf "$DEST/agentes-$STAMP.tgz" -C "$REPO_DIR" \
		--ignore-failed-read \
		agentes/prospeccao/status.json \
		agentes/sdr-whatsapp/conversas \
		agentes/sdr-whatsapp/disparos-hoje.json \
		agentes/sdr-whatsapp/.env 2>/dev/null || true
fi

# Mantem apenas os ultimos N dias.
find "$DEST" \( -name 'winshub-*.tgz' -o -name 'agentes-*.tgz' \) -type f -mtime +"$RETENTION_DAYS" -delete

echo "backup ok: $DEST/winshub-$STAMP.tgz"
