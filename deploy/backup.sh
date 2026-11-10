#!/bin/sh
# Backup do volume de dados do WiNS Hub (banco SQLite + CSVs dos jobs).
# Uso: ./backup.sh   (agendado pelo winshub-backup.timer)
set -eu

DEST="${WINSHUB_BACKUP_DIR:-/var/backups/winshub}"
VOLUME="${WINSHUB_VOLUME:-deploy_winshub_data}"
RETENTION_DAYS="${WINSHUB_RETENTION_DAYS:-7}"

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"

docker run --rm \
	-v "$VOLUME":/data:ro \
	-v "$DEST":/backup \
	alpine:3 \
	tar czf "/backup/winshub-$STAMP.tgz" -C /data .

# Mantem apenas os ultimos N dias.
find "$DEST" -name 'winshub-*.tgz' -type f -mtime +"$RETENTION_DAYS" -delete

echo "backup ok: $DEST/winshub-$STAMP.tgz"
