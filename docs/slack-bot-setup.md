# Revie — the RevOps Slack bot (setup)

Instant Q&A bot for #ask-revops and DMs. Slack pushes events to `/api/slack/events` on the
dashboard's Vercel deployment; the route answers from the Google Sheets + read-only Salesforce
SOQL using the Claude API. Read-only by design — it never changes data.

## One-time setup (Tai, ~15 minutes)

### 1. Create the Slack app
1. Go to https://api.slack.com/apps → **Create New App** → **From a manifest** → pick the Momos workspace.
2. Paste the manifest below → Create.
3. **Install to Workspace** (Settings → Install App). Approve the permissions.

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
      "request_url": "https://REPLACE-WITH-PROD-DOMAIN/api/slack/events",
      "bot_events": ["app_mention", "message.im"]
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

### 2. Add the secrets to Vercel (dashboard project → Settings → Environment Variables, Production)
| Variable | Where to find it |
|---|---|
| `SLACK_BOT_TOKEN` | Slack app → OAuth & Permissions → Bot User OAuth Token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → Signing Secret |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API keys → Create key |
| `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL` | same values as in the local `.env` (may already exist in Vercel — check) |

`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY_B64`, `GOOGLE_SHEET_ID` are already in Vercel for the dashboard.

### 3. Wire the URL (after this branch is merged & deployed)
1. Redeploy so the env vars take effect.
2. Slack app → **Event Subscriptions** → set Request URL to `https://<prod-domain>/api/slack/events`.
   Slack sends a challenge; it should turn **Verified** instantly.
3. In Slack: `/invite @Revie` into **#ask-revops**.

### 4. Test
Post in #ask-revops: `@Revie what's our Q3 pipeline generation vs quota?` — expect 👀 within a
second, an in-thread answer in ~10–30s, then ✅. DMs to Revie work too.

## Guardrails (enforced in code, `src/lib/slack-bot.ts`)
- Salesforce tool accepts a **single SELECT** only; DML keywords rejected.
- Sheets scope is **readonly**; only the two known spreadsheets are reachable.
- Slack messages are treated as questions, never as instructions; no secrets in replies.
- Every reply cites its source and freshness (4-hourly tabs / weekly rep tabs / live SOQL).

## Ops notes
- Answers run inside `after()` with `maxDuration = 300` on the route.
- If Revie ever misbehaves: remove the Slack app from the workspace (instant kill switch), or
  delete `SLACK_BOT_TOKEN` from Vercel and redeploy.
