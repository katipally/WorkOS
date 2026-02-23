# OAuth Setup Guide — One-Time Configuration

This guide covers the one-time setup for GitHub, Slack, and Atlassian (Jira) OAuth so users can click **Connect** in the app and get authenticated without any issues.

---

## Prerequisites

The app runs at **`https://localhost:3443`** (HTTPS via mkcert). All OAuth redirect URIs must use this exact URL. HTTP will be rejected by Slack and Atlassian.

```
App URL:  https://localhost:3443
```

---

## Step 0 — Generate TLS Certs (one-time per machine)

```bash
brew install mkcert nss
make setup          # generates frontend/certs/localhost.pem + localhost-key.pem
```

The `make setup` command also creates `.env` from `.env.example` if it doesn't exist.

---

## Step 1 — GitHub OAuth App

**Redirect URI:** `https://localhost:3443/api/oauth/github/callback`

1. Go to [https://github.com/settings/developers](https://github.com/settings/developers)
2. Click **OAuth Apps** → **New OAuth App**
3. Fill in:
   - **Application name:** AI Workforce Assistant (local)
   - **Homepage URL:** `https://localhost:3443`
   - **Authorization callback URL:** `https://localhost:3443/api/oauth/github/callback`
4. Click **Register application**
5. Copy **Client ID** and click **Generate a new client secret**
6. Add to `.env`:
   ```
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   ```

---

## Step 2 — Slack OAuth App

**Redirect URI:** `https://localhost:3443/api/oauth/slack/callback`

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name: `AI Workforce Assistant`, pick your workspace → **Create App**
4. In the left sidebar → **OAuth & Permissions**:
   - Under **Redirect URLs** → **Add New Redirect URL:**
     ```
     https://localhost:3443/api/oauth/slack/callback
     ```
   - Click **Save URLs**
   - Under **Bot Token Scopes** → **Add an OAuth Scope** — add all of:
     - `channels:read`
     - `channels:history`
     - `chat:write`
     - `users:read`
     - `team:read`
5. In the left sidebar → **Basic Information** → **App Credentials**:
   - Copy **Client ID** and **Client Secret**
6. Add to `.env`:
   ```
   SLACK_CLIENT_ID=your_client_id
   SLACK_CLIENT_SECRET=your_client_secret
   ```

> **Important:** The redirect URI in Slack must match **exactly** — including `https://` and the port `:3443`. Even a trailing slash will cause a mismatch error.

---

## Step 3 — Atlassian (Jira) OAuth 2.0

**Redirect URI:** `https://localhost:3443/api/oauth/atlassian/callback`

1. Go to [https://developer.atlassian.com/console/myapps/](https://developer.atlassian.com/console/myapps/)
2. Click **Create** → **OAuth 2.0 integration**
3. Name: `AI Workforce Assistant` → **Create**
4. In the left sidebar → **Authorization**:
   - Click **Add** next to **OAuth 2.0 (3LO)**
   - **Callback URL:** `https://localhost:3443/api/oauth/atlassian/callback`
   - Click **Save changes**
5. In the left sidebar → **Permissions**:
   - Click **Add** next to **Jira API**
   - Under **Jira platform REST API** → **Configure** → add scopes:
     - `read:jira-work`
     - `write:jira-work`
     - `read:jira-user`
   - Click **Save**
6. In the left sidebar → **Settings**:
   - Copy **Client ID** and **Secret**
7. Add to `.env`:
   ```
   ATLASSIAN_CLIENT_ID=your_client_id
   ATLASSIAN_CLIENT_SECRET=your_client_secret
   ```

---

## Step 4 — Set APP_BASE_URL in .env

```env
APP_BASE_URL=https://localhost:3443
```

This is the single source of truth for all redirect URIs. The backend builds them dynamically:
```
{APP_BASE_URL}/api/oauth/{provider}/callback
```

---

## Step 5 — Start the Stack

```bash
make up
# or
docker compose up --build -d
```

Open `https://localhost:3443` in your browser. Accept the certificate (it's locally trusted via mkcert, so no warning should appear).

---

## Step 6 — Connect in the App

1. Go to **Settings → Integrations**
2. Click **Connect with GitHub / Slack / Jira**
3. A popup opens → authorize → popup closes → status shows **Connected**

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `redirect_uri did not match` | APP_BASE_URL is `http://` or wrong port | Set `APP_BASE_URL=https://localhost:3443` in `.env` and restart |
| `invalid_state` | State cookie expired or popup blocked | Allow popups for `localhost`, retry |
| `OAuth not configured` | Client ID/Secret missing | Add credentials to `.env`, restart containers |
| Certificate warning in browser | mkcert CA not trusted | Run `mkcert -install` then restart browser |
| Popup blocked | Browser popup blocker | Allow popups for `https://localhost:3443` |
| Atlassian "Access denied" | Confluence scope requested but no Confluence site | This is fixed in the app (Confluence scope removed). **Disconnect and reconnect** Jira in Settings → Integrations to get a fresh token with only Jira scopes. |
| Atlassian "No Jira sites accessible" | OAuth app not linked to a Jira site | In the Atlassian developer console, ensure your OAuth app has Jira API permissions added under **Permissions** |

---

## Production Deployment

Replace `https://localhost:3443` with your production domain everywhere:

1. Set `APP_BASE_URL=https://yourdomain.com` in your production environment
2. Update the redirect URI in each OAuth app's settings to `https://yourdomain.com/api/oauth/{provider}/callback`
3. Use a real TLS certificate (Let's Encrypt / Cloudflare) instead of mkcert
