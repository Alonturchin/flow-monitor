Flow Monitor — Project Description
Klaviyo Flow Intelligence Dashboard
Internal Retention Team Tool

What This App Does
Flow Monitor is an internal web application that replaces the current Make.com automation for Klaviyo flow monitoring. Instead of receiving a weekly Slack report, the retention team gets a live dashboard where they can explore flow performance, investigate deliverability issues, get AI-powered analysis, create action tasks in Monday.com, and receive A/B test suggestions — all in one place.

Tech Stack
LayerTechnologyWhyFrontend + BackendNext.js 14 (App Router)Full-stack in one codebase, no separate API serverLanguageTypeScriptType safety across the whole projectDatabasePostgreSQLReliable, queryable, runs in DockerStylingTailwind CSSFast, consistent, utility-firstAuthNextAuth.jsSimple email/password for internal useAIClaude API (claude-sonnet-4-20250514)Flow analysis and A/B suggestionsSchedulingnode-cronWeekly Klaviyo data pull, built into the appContainerizationDocker + Docker ComposeConsistent local dev and production deploymentReverse ProxyNginxSSL termination, routingIntegrationsKlaviyo API, Monday.com APIData source and task management

Project Structure
flow-monitor/
├── docker-compose.dev.yml        ← local development
├── docker-compose.prod.yml       ← VPS production
├── .env.example                  ← variable placeholders
├── nginx/
│   └── nginx.conf                ← reverse proxy + SSL
├── db/
│   └── migrations/
│       ├── 001_flows.sql
│       ├── 002_snapshots.sql
│       ├── 003_alerts.sql
│       └── 004_ab_tests.sql
└── src/
    ├── app/                      ← Next.js pages
    │   ├── dashboard/
    │   ├── flows/[id]/
    │   ├── alerts/
    │   ├── ab-tests/
    │   └── settings/
    ├── components/
    │   ├── dashboard/
    │   ├── flows/
    │   ├── alerts/
    │   └── monday/
    ├── lib/
    │   ├── klaviyo.ts            ← Klaviyo API client
    │   ├── monday.ts             ← Monday.com API client
    │   ├── claude.ts             ← Claude API client
    │   ├── db.ts                 ← Postgres connection
    │   └── scheduler.ts          ← weekly cron job
    └── types/

Database Schema
flows — one row per Klaviyo flow
flow_id, name, tags, status, trigger_type, updated_at
flow_snapshots — one row per flow per week (trend history)
id, flow_id, week_start, recipients, open_rate, click_rate, unsubscribe_rate, spam_complaint_rate, bounce_rate, conversion_rate, revenue, revenue_per_recipient
message_snapshots — email-level metrics per week
id, flow_id, message_id, message_name, week_start, [same metrics as above]
alerts — generated automatically when thresholds are crossed
id, flow_id, message_id, severity, metric, value, threshold, ai_suggestion, created_at, resolved_at
ab_tests — AI-generated test suggestions per flow
id, flow_id, message_id, hypothesis, suggested_change, metric_to_watch, confidence, status, created_at, result

Development Phases

Phase 1 — Foundation & Infrastructure
Estimated: 2–3 days
Everything the app needs to exist and run — no features yet, just a solid base.

Initialize Next.js 14 project with TypeScript and Tailwind
Set up docker-compose.dev.yml with hot reload for local development
Set up docker-compose.prod.yml with Nginx + Next.js + Postgres for VPS
Write Nginx config with reverse proxy and SSL placeholder
Create .env.example with all required variable placeholders
Run all four database migrations and verify schema
Set up Postgres connection pool in lib/db.ts
Confirm Docker Desktop runs the full stack locally

Deliverable: App starts locally with docker compose -f docker-compose.dev.yml up. Empty pages, no data yet.

Phase 2 — Klaviyo Data Pipeline
Estimated: 3–4 days
The data engine. Without this nothing else works.

Build Klaviyo API client in lib/klaviyo.ts
Implement flow list pull (all live flows with tags and metadata)
Implement flow values report pull (metrics per flow per week)
Implement message-level metrics pull (per email inside each flow)
Write data normalization and storage logic into Postgres
Build the weekly cron job with node-cron in lib/scheduler.ts
Add manual "Pull now" trigger via API route for testing
Handle API pagination, rate limits, and error retries
Write seed script to backfill 8 weeks of historical data

Deliverable: Running the pull manually populates all five tables with real Klaviyo data.

Phase 3 — Core Dashboard & Flow Table
Estimated: 3–4 days
The main screen the team sees every day.

Build the sidebar navigation layout (Dashboard, Performance, Deliverability, Alerts, All Flows, Settings)
Build the top bar with date range picker and filter controls (tag, revenue, recipients)
Build the four summary metric cards (total revenue, flows monitored, active alerts, avg open rate)
Build the flows table with columns: flow name, tag, health score, recipients, open rate, click rate, revenue, 8-week sparkline, status badge
Implement table sorting and filtering
Build the health score calculation engine (0–100, weighted by deliverability vs. performance)
Build the flow detail panel that slides in from the right, showing message-level breakdown and metrics

Deliverable: Full working dashboard with real data, filterable table, and clickable flow detail panel.

Phase 4 — Alert Engine & Deliverability Monitor
Estimated: 2–3 days
The system that catches problems automatically.

Define alert thresholds (spam > 0.2%, bounce > 2%, unsubscribe > 1.5%, open rate < 25%, click rate < 1% for 500+ recipients)
Build per-flow baseline calculator (each flow's own historical average, not global thresholds)
Write alert generation job that runs after each data pull
Build the Alerts page with active and resolved states, filterable by severity and type
Add alert history log with timestamps
Build the two-tab monitoring split: Performance view and Deliverability view
Add resolve/dismiss functionality per alert

Deliverable: Alerts page shows real flagged issues with severity badges. Performance and Deliverability tabs work independently.

Phase 5 — AI Features
Estimated: 3–4 days
The intelligence layer that makes the app more than a reporting tool.

Set up Claude API client in lib/claude.ts
Build on-demand flow analysis — "Analyze this flow" button calls Claude with the flow's full metrics and returns a structured diagnostic
Build AI suggestion display inside the flow detail panel and on each alert card
Build the A/B test suggestions engine — Claude analyzes each flow and generates specific, testable hypotheses with a confidence score and the metric to watch
Add the A/B tests page listing all suggestions with status (pending, in progress, completed) and results
Implement confidence scoring based on recipient volume (no suggestions under 500 recipients)
Add the "Ask AI for full fix plan" button per flow

Deliverable: Every alert has an AI suggestion. Every flow has an "Analyze" button and an A/B suggestions tab.

Phase 6 — Monday.com Integration
Estimated: 1–2 days
Turns monitoring into action.

Build Monday.com API client in lib/monday.ts
Build the "Create task" modal — triggered from any alert card
Auto-populate task fields: name from alert title, description from AI suggestion, priority from severity
Add board selector dropdown (pulled from Monday API)
Add assignee selector (pulled from Monday API)
Store task ID in the alerts table after creation so the button changes to "View in Monday"
Handle API errors gracefully

Deliverable: Any alert can be turned into a Monday task in two clicks, pre-filled and ready to assign.

Phase 7 — Auth, Settings & Production Deploy
Estimated: 2 days
Lock it down and ship it.

Add NextAuth.js with email/password authentication
Restrict all routes to authenticated users only
Build Settings page (alert thresholds, Klaviyo tag filters, Monday board selection)
Add IP allowlist in Nginx config (office IPs only)
Configure SSL with Let's Encrypt on the VPS
Set up automated daily Postgres backup with pg_dump
Final production deployment to VPS
Smoke test all features end to end

Deliverable: Live at monitor.particleface.com, password protected, fully operational.

Environment Variables
KLAVIYO_API_KEY=
ANTHROPIC_API_KEY=
MONDAY_API_KEY=
DATABASE_URL=postgresql://user:password@localhost:5432/flowmonitor
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://monitor.particleface.com

Deployment Workflow
Local development
docker compose -f docker-compose.dev.yml up
Production deploy
ssh deploy@your-server-ip
cd /var/www/flowmonitor
git pull origin main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

Total Estimated Build Time
PhaseDaysPhase 1 — Foundation2–3Phase 2 — Data pipeline3–4Phase 3 — Dashboard3–4Phase 4 — Alert engine2–3Phase 5 — AI features3–4Phase 6 — Monday integration1–2Phase 7 — Auth & deploy2Total16–22 days
Working with Claude Code as your agent, expect to move significantly faster — phases 1 through 3 could realistically be done in a single focused session given how much scaffolding the agent handles automatically.