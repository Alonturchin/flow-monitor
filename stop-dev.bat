@echo off
title Flow Monitor — Stopping
cd /d "%~dp0"

echo  Stopping Flow Monitor containers...
docker compose -f docker-compose.dev.yml down

echo  Done.
pause
