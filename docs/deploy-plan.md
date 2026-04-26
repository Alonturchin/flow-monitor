# Flow Monitor — Deploy Plan

End-to-end runbook for deploying Flow Monitor to a fresh VPS via git + Docker + Caddy.

- **VPS:** `76.13.140.178` (root SSH)
- **Domain:** `flow-monitor.particle-retention.cloud`
- **Repo:** `https://github.com/Alonturchin/flow-monitor.git`
- **Stack on VPS:** Docker + docker compose. Caddy handles HTTPS automatically.
- **App dir on VPS:** `/var/www/flowmonitor`

> Credentials (root password etc.) live in `docs/deploy.md` (gitignored).

---

## 0 · Prerequisites

### DNS
Before deploying, point an A record at the VPS:

```
flow-monitor.particle-retention.cloud   A   76.13.140.178
```

Caddy needs DNS resolved + ports 80/443 open before it can mint a Let's Encrypt cert. Verify with:

```bash
dig +short flow-monitor.particle-retention.cloud
# should return 76.13.140.178
```

### Local: push everything to GitHub
From the workstation:

```bash
git add -A
git commit -m "Prepare for VPS deploy: Caddy reverse proxy, build fixes, new domain"
git push origin main
```

`docs/deploy.md` is gitignored; it stays local.

---

## 1 · One-time VPS setup

SSH in:
```bash
ssh root@76.13.140.178
```

### 1a. System update + basics
```bash
apt update && apt upgrade -y
apt install -y git curl ufw
```

### 1b. Install Docker Engine + Compose plugin
```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

### 1c. Firewall
```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

### 1d. Clone the repo
```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/Alonturchin/flow-monitor.git flowmonitor
cd flowmonitor
```

> Repo is public. If made private later, use a deploy key or HTTPS PAT.

---

## 2 · Configure environment

Copy the template and fill in real values:
```bash
cp .env.example .env
nano .env
```

Generate strong secrets first (locally or on the VPS):
```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# POSTGRES_PASSWORD  (no special chars that need escaping)
openssl rand -hex 24

# AUTH_PASSWORD (login)
openssl rand -base64 18
```

Required values in `.env`:

| Var | Value |
|---|---|
| `KLAVIYO_API_KEY` | from local `.env.local` |
| `ANTHROPIC_API_KEY` | from local `.env.local` |
| `MONDAY_API_KEY` | from local `.env.local` |
| `MONDAY_BOARD_ID` | as configured in app |
| `MONDAY_GROUP_ID` | as configured in app |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://flow-monitor.particle-retention.cloud` |
| `AUTH_EMAIL` | `Alon@particleformen.com` (or team email) |
| `AUTH_PASSWORD` | strong random |
| `POSTGRES_PASSWORD` | strong random |
| `DATABASE_URL` | leave the template — interpolated by compose |
| `DOMAIN` | `flow-monitor.particle-retention.cloud` |
| `ACME_EMAIL` | `Alon@particleformen.com` (Let's Encrypt notifications) |

`chmod 600 .env` so only root can read it.

---

## 3 · First boot

```bash
cd /var/www/flowmonitor
docker compose -f docker-compose.prod.yml up -d --build
```

Watch progress:
```bash
docker compose -f docker-compose.prod.yml logs -f
```

What happens:
1. `db` (Postgres 16) starts, runs migrations from `db/migrations/*.sql` once.
2. `app` (Next.js standalone) builds from the Dockerfile and connects to `db`.
3. `caddy` starts, requests a cert from Let's Encrypt for `$DOMAIN`, and begins reverse-proxying to `app:3000`.

Cert acquisition takes ~30s the first time. If it fails, see Troubleshooting.

---

## 4 · Verify

```bash
# health endpoint (DB connectivity)
curl https://flow-monitor.particle-retention.cloud/api/health

# login page
curl -I https://flow-monitor.particle-retention.cloud/login
```

In a browser: open `https://flow-monitor.particle-retention.cloud`, log in with `AUTH_EMAIL` / `AUTH_PASSWORD`.

---

## 5 · Post-deploy

### Backups
Wire up `scripts/backup.sh` (already in repo) for daily Postgres dumps:
```bash
chmod +x /var/www/flowmonitor/scripts/backup.sh
crontab -e
# add:
0 2 * * * /var/www/flowmonitor/scripts/backup.sh >> /var/log/flowmonitor-backup.log 2>&1
```

### Initial data backfill
Once running, hit the backfill endpoint or use the in-app pull button to seed Klaviyo data. The weekly cron (`node-cron` in the app process) handles ongoing pulls.

### Updating the deployed code
From local: push to `main`. Then on VPS:
```bash
cd /var/www/flowmonitor
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
For schema changes only: rerun migrations manually if needed (the `docker-entrypoint-initdb.d` mount only runs on first boot of an empty volume).

---

## Troubleshooting

**Caddy can't get a cert:**
- DNS not propagated → `dig +short flow-monitor.particle-retention.cloud` should return `76.13.140.178`.
- Port 80/443 blocked → check `ufw status` and any cloud firewall in the VPS provider's panel.
- Logs: `docker compose -f docker-compose.prod.yml logs caddy`.

**App can't connect to DB:**
- Check `docker compose ps` — `db` must show `healthy`.
- `POSTGRES_PASSWORD` mismatch between `.env` and what was used at first boot will lock you out. To reset: `docker compose down -v` (⚠️ wipes data) then `up -d` again.

**Login fails / NextAuth errors:**
- `NEXTAUTH_URL` must be the public HTTPS URL exactly.
- `NEXTAUTH_SECRET` must be set (≥32 chars).

**Build fails on VPS:**
- Low memory: `docker compose build` of Next.js needs ~1 GB RAM. Add a swapfile if the VPS is small:
  ```bash
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

**Need to rotate AUTH_PASSWORD or NEXTAUTH_SECRET:**
- Edit `.env`, then `docker compose -f docker-compose.prod.yml up -d` (no `--build` needed; it just restarts the app container with new env).

---

## File map (what changed for prod)

- `Caddyfile` — new, replaces nginx config
- `docker-compose.prod.yml` — `caddy` service replaces `nginx`; mounts `caddy_data` volume for cert persistence
- `.env.example` — added `DOMAIN`, `ACME_EMAIL`, updated `NEXTAUTH_URL`
- `tsconfig.json` — `target: es2020` (was implicit ES5)
- `src/app/api/alerts/compute/route.ts` — function declaration → arrow (strict-mode)
- `src/lib/klaviyo.ts` — explicit type annotations on paginated `page` consts
- `src/components/layout/AppShell.tsx` — `<Suspense>` around `Sidebar` so pages prerender despite `useSearchParams`
- `nginx/` — removed (Caddy handles all of it)
