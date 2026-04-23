@echo off
title Flow Monitor — Dev Server
cd /d "%~dp0"

echo.
echo  Flow Monitor — starting dev environment...
echo.

REM Check Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Docker Desktop is not running.
    echo  Please start Docker Desktop and try again.
    pause
    exit /b 1
)

REM Copy env file if .env.local doesn't exist
if not exist ".env.local" (
    echo  Creating .env.local from .env.example...
    copy ".env.example" ".env.local" >nul
    echo  Done. Edit .env.local to add your API keys ^(KLAVIYO_API_KEY, ANTHROPIC_API_KEY, etc^).
    echo.
)

echo  Building and starting containers...
echo  This will take a few minutes on first run ^(npm install inside Docker^).
echo.

docker compose -f docker-compose.dev.yml up --build

pause
