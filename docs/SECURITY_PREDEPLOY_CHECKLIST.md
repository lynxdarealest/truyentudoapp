# Security Pre-Deploy Checklist

## 1) Secrets and key hygiene
- Never commit `.env`, `.env.local`, service-role keys, OAuth client secrets, or private keys.
- Use placeholder values only in `.env.example`.
- Rotate any key that was previously committed (even if later deleted).
- Keep all production secrets in Vercel/Supabase environment variables, not in source files.

## 2) Frontend hardening
- Enforce security headers in deploy config:
  - `Content-Security-Policy`
  - `Strict-Transport-Security`
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
- Service worker must only cache static same-origin assets, never authenticated API responses.
- Redact tokens/API keys/JWTs from client error logs before storing or sending.

## 3) API and backend hardening
- CORS must use an allowlist of trusted origins, never wildcard `*` for authenticated endpoints.
- Add rate limiting per IP/user on all write endpoints and relay endpoints.
- Add request size limits for upload/import endpoints.
- Validate and sanitize all user-provided JSON/text before persistence.

## 4) Supabase/RLS requirements
- Enable RLS on every table exposed to clients.
- Insert/update/select policies must be `auth.uid() = owner_id` style.
- Avoid anonymous write policies unless absolutely required and protected by server-side anti-abuse controls.
- Use `anon` key only in browser; never expose service-role key in client code.

## 5) CI/CD security gates
- Run secret scanning (Gitleaks) on every PR and push.
- Run dependency audit and fail on high/critical vulnerabilities.
- Keep lockfile updated after dependency changes.
- Add branch protection: require CI success before merge.

## 6) Incident response baseline
- Keep a simple key-rotation runbook (what to rotate, where to update).
- Keep deployment rollback instructions available.
- Track security-relevant releases in release notes.
