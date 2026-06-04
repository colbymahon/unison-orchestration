# Vercel production deployment

The storefront lives in this `frontend/` directory. Deploy from the **monorepo root** or link this folder as the Vercel project root.

## One-time setup

1. Push the repo to GitHub (do **not** `git init` inside `frontend/` alone).
2. [vercel.com](https://vercel.com) → Import Project → set **Root Directory** to `frontend`.
3. Add environment variables from `.env.example` (Production + Preview).
4. Bind custom domain `unisonorchestration.com` when ready.

## CLI

```bash
cd frontend
npm install -g vercel   # once
vercel login
vercel link
vercel --prod
```

## Post-deploy checks

- `https://unisonorchestration.com/.well-known/ai-plugin.json`
- `https://unisonorchestration.com/api/openapi.json`
- `https://unisonorchestration.com/legal`

## Local production build

```bash
cd frontend
rm -rf .next
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
npm run build
```
