# Paperclip Railway Template

One-click Railway template source for deploying Paperclip with:

- `paperclip` app service (Docker build from this repo)
- Railway managed `postgres`
- Railway volume mounted at `/paperclip`

## Deploy

- Template URL: `https://railway.com/deploy/KJZc89?referralCode=uXzB-u&utm_medium=integration&utm_source=template&utm_campaign=generic`
- Deploy button:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/KJZc89?referralCode=uXzB-u&utm_medium=integration&utm_source=template&utm_campaign=generic)

## Deploy model

- `Dockerfile` builds a pinned upstream Paperclip release (`ARG PAPERCLIP_REF`).
- No Docker `VOLUME` instruction (Railway-compatible).
- Runtime starts Paperclip directly (no wrapper server).

## Required Paperclip variables

Set these in Railway template editor (service: `paperclip`):

- `DATABASE_URL=${{postgres.DATABASE_URL}}`
- `BETTER_AUTH_SECRET=${{secret(64, "abcdef0123456789")}}`
- `HOST=0.0.0.0`
- `PORT=3100`
- `SERVE_UI=true`
- `PAPERCLIP_HOME=/paperclip`
- `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE=private`
- `PAPERCLIP_PUBLIC_URL=https://${{paperclip.RAILWAY_PUBLIC_DOMAIN}}`
- `RAILWAY_RUN_UID=0`

Optional:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## Networking/storage

- Add HTTP proxy on port `3100`
- Attach a Railway volume at `/paperclip`

## Updating upstream version

Pinned version is controlled by `PAPERCLIP_REF` in `Dockerfile`.

To bump to the latest upstream release tag:

```bash
GITHUB_TOKEN=... node scripts/bump-paperclip-ref.mjs
```

## Support

- Template issues: this repository Issues tab
- Paperclip app issues: https://github.com/paperclipai/paperclip/issues
