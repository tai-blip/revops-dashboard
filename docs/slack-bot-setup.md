# Revie — the RevOps Slack bot

Instant Q&A in **#ask-revops** and DMs, answered from the live sources (Google Sheets +
read-only Salesforce SOQL). Read-only by design — it never changes data.

Two interchangeable architectures share the same Slack app. **Option A is the current one.**

| | **A — Claude Code CLI + Socket Mode (current)** | B — Claude API + Vercel (upgrade path, built on this branch) |
|---|---|---|
| Cost | $0 extra — Tai's Claude subscription | API key, pay per question |
| Speed | Instant (websocket push) | Instant (HTTP push) |
| Uptime | While `revie-socket.mjs` runs on the host Mac | 24/7 |
| Budget | Hard cap ≈10% of Tai's credit (see below) | n/a |

---

## Option A — CLI + Socket Mode (Kai's architecture, guarded)

Runner: `scripts/revie-socket.mjs` → each question spawns a **sandboxed** headless
`claude -p` in this repo. Guardrails (all enforced in the runner):
- `--strict-mcp-config` — the spawned CLI can never touch Tai's MCP connectors (Slack/Gmail/SFDC/Drive)
- `--allowedTools` = Read + **only** `node --env-file=.env scripts/revie-query.mjs …`
  (that helper is itself read-only: sheets readonly scope, single-SELECT SOQL, DML rejected)
- `--disallowedTools` = Write/Edit/WebFetch/WebSearch/Task/git + `Read(.env*)`
- default permission mode → anything not allowlisted is auto-denied; `--max-turns 12` + 240s hard kill
- channel allowlist (#ask-revops + DMs); Slack text treated as questions, never instructions
- **Budget: ~10% of Tai's credit.** Every answer's API-equivalent cost (from the CLI's JSON
  output) is logged to `.revie/usage.jsonl`; rolling caps **$2 / 5h** and **$15 / week**
  (`REVIE_BUDGET_5H_USD` / `REVIE_BUDGET_WEEK_USD` — tune to your plan). Over budget →
  Revie declines politely and points at Tai; nothing is spawned.

### Setup (Tai, ~10 min)
1. **Log the CLI in (one-time):** open Terminal → `claude` → `/login` → sign in with your
   Claude account. (The CLI's auth is separate from the desktop app.) Verify:
   `claude -p "say OK" --max-turns 1` prints OK.
2. **Create the Slack app:** https://api.slack.com/apps → Create New App → **From a manifest**
   → Momos workspace → paste:

```json
{
  "display_information": {
    "name": "Revie",
    "description": "RevOps data assistant — ask about ARR, pipeline generation, stale deals, quotas.",
    "background_color": "#4338CA"
  },
  "features": {
    "bot_user": { "display_name": "Revie", "always_online": true }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "chat:write",
        "channels:history",
        "groups:history",
        "im:history",
        "im:read",
        "im:write",
        "reactions:write"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": ["app_mention", "message.im"]
    },
    "socket_mode_enabled": true,
    "org_deploy_enabled": false,
    "token_rotation_enabled": false
  }
}
```

3. **Two tokens into `.env`:**
   - Install App → **Bot User OAuth Token** → `SLACK_BOT_TOKEN=xoxb-…`
   - Basic Information → **App-Level Tokens** → Generate (scope `connections:write`) →
     `SLACK_APP_TOKEN=xapp-…`
4. **Invite + run:** `/invite @Revie` in #ask-revops, then:

```bash
node --env-file=.env scripts/revie-socket.mjs
```

Leave it running (a terminal tab is fine). Test: `@Revie what's our Q3 pipe gen vs quota?`
→ 👀 → in-thread answer → ✅. The console logs each answer's cost and the budget meters.

Kill switch: Ctrl-C the process (or remove the Slack app).

---

## Option B — Claude API + Vercel (24/7, no laptop dependency)

Already built on this branch: `/api/slack/events` (HMAC-verified, auth-proxy-exempt) +
`src/lib/slack-bot.ts`. To switch: add `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
`ANTHROPIC_API_KEY` (+ `SF_*`) to Vercel prod env, disable Socket Mode on the Slack app,
set Event Subscriptions Request URL to `https://<prod-domain>/api/slack/events`, redeploy.
Same bot, same guardrails — it just never sleeps and bills an API key instead of the
subscription.
