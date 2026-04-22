# Cloud Sync — Deployment

The sync endpoints are now part of this worker, mounted at `/sync/*`. Deploying takes ~15 min total, most of which is Cloudflare/GitHub setup.

## Prereqs you already have

- Wrangler CLI (`npm install -g wrangler`, `wrangler login` — you've done this)
- This repo cloned locally
- A Cloudflare account with `micaiahs-worker` already deployed

## One-time setup

### 1. Create the SYNC_KV namespace

From the repo root:

```bash
wrangler kv:namespace create SYNC_KV
```

Output looks like:

```
🌀 Creating namespace with title "micaiahs-worker-SYNC_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "SYNC_KV", id = "abc123def456..." }
```

Copy the `id`. Open `wrangler.toml` and replace `REPLACE_WITH_SYNC_KV_ID` with the real id (keep the existing `OUTER_RIM_KV` entry — don't touch that).

### 2. Create a GitHub OAuth App

Go to https://github.com/settings/developers → **New OAuth App**.

- **Application name**: `Outer Rim Apps Sync`
- **Homepage URL**: `https://micaiahs-worker.micaiah-tasks.workers.dev`
- **Authorization callback URL**: `https://micaiahs-worker.micaiah-tasks.workers.dev/sync/oauth/callback`

Register, then copy the **Client ID** and click **Generate a new client secret** → copy it too.

### 3. Add the three new secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
# paste Client ID when prompted

wrangler secret put GITHUB_CLIENT_SECRET
# paste Client Secret

wrangler secret put TOKEN_SIGNING_KEY
# paste any random long string — openssl rand -hex 32 works fine
```

Your existing `MANUS_API_KEY` is untouched.

### 4. Deploy

```bash
wrangler deploy
```

Sanity check after deploy:

```bash
curl https://micaiahs-worker.micaiah-tasks.workers.dev/sync
# → {"name":"outer-rim-sync","mounted":"/sync","ok":true}

curl https://micaiahs-worker.micaiah-tasks.workers.dev/health
# → {"status":"ok","service":"micaiahs-worker"}   (still works)
```

If both respond, the merge is live. Your MCP and Siri endpoints are undisturbed.

## What the endpoints look like now

All sync endpoints are under `/sync/`:

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/sync/oauth/start?app={app}&port={port}` | Start OAuth flow (called by Electron app) |
| `GET`  | `/sync/oauth/callback?code=...&state=...` | GitHub redirects here after approval |
| `GET`  | `/sync/v1/me` | Who am I (requires token) |
| `GET`  | `/sync/v1/state/{app}` | Pull state blob |
| `PUT`  | `/sync/v1/state/{app}` | Push state blob (If-Match header) |
| `DEL`  | `/sync/v1/state/{app}` | Clear state |

`{app}` is one of `outer-rim`, `parallel`, `perimeter`, `quartet`.

## KV key namespaces (for reference / debugging)

All sync keys live in `SYNC_KV`:
- `oauth_state:{token}` — ephemeral OAuth state (10 min TTL)
- `token:{syncToken}` — device sync tokens
- `state:{githubUserId}:{app}` — the actual sync blobs

Your existing `OUTER_RIM_KV` is untouched and continues to serve Siri.

## Troubleshooting

**`{"error":"sync_not_configured"}`** — the `SYNC_KV` binding is missing. Check `wrangler.toml`.

**`Worker misconfigured: GITHUB_CLIENT_ID not set`** — you forgot step 3. Run `wrangler secret list` to see what's set.

**OAuth callback fails with "redirect_uri_mismatch"** — the GitHub OAuth app's callback URL doesn't match exactly. It must be `/sync/oauth/callback`, not just `/oauth/callback`.

**Live logs** — run `wrangler tail` while testing; every request prints in your terminal.
