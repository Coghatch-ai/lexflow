# Probius Mobile (POC)

Mobile-first web app — a separate Vite frontend that reuses the **same backend**
(`api.probius.app`, tRPC) and the `shared/` domain logic as the main app. The main
app under `app/` is untouched.

Deliberately kept out of the root `package.json` so changes here never re-trigger the
main app / API deploys — call Vite directly with this app's config.

## Local commands

```bash
# Dev server (mobile-first; open in Chrome device-emulation or on a phone via LAN)
pnpm exec vite --config apps/mobile/vite.config.ts

# Typecheck
pnpm exec tsc --noEmit -p tsconfig.mobile.json

# Lint (covered by the repo-wide config)
pnpm exec eslint apps/mobile --max-warnings 0

# Production build -> dist/mobile/
pnpm exec vite build --config apps/mobile/vite.config.ts
```

### Env (repo-root `.env`)

- `VITE_API_URL` — point at `https://api.probius.app` for a no-backend demo, or
  `http://localhost:3001/api/trpc` when running `pnpm dev`.
- `VITE_CLERK_PUBLISHABLE_KEY` — same Clerk instance as the main app.

A signed-in Clerk user needs a local `users` row: `pnpm db:create-user <clerk-user-id>`.

## Deploy

`.github/workflows/deploy-mobile.yml` (push to `main` touching `apps/mobile/**` or
`shared/**`) → builds → `s3 sync dist/mobile` → CloudFront invalidation.

- Bucket: `lexflow-mobile-frontend-mrhewbuc`
- CloudFront: `E2A8P4MSEE55DT`
- URL: `https://mobile.probius.app`
