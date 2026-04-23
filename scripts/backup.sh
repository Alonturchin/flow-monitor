#!/bin/bash
# Flow Monitor — daily Postgres backup
#
# Set up via cron on the VPS:
#   crontab -e
#   0 2 * * * /var/www/flowmonitor/scripts/backup.sh >> /var/log/flowmonitor-backup.log 2>&1

set -euo pipefail

APP_DIR="/var/www/flowmonitor"
BACKUP_DIR="/var/backups/flowmonitor"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="flowmonitor_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup → ${FILENAME}"

docker compose -f "${APP_DIR}/docker-compose.prod.yml" exec -T db \
  pg_dump -U flowmonitor flowmonitor | gzip > "${BACKUP_DIR}/${FILENAME}"

# Keep last 30 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: $(du -sh "${BACKUP_DIR}/${FILENAME}" | cut -f1)"
