# Security and reliability audit

## Scope and baseline

Reviewed the React/Vite client, Express API, Supabase schema and versioned SQL migrations, private Storage buckets, Render manifest, environment templates, session and MFA code, administrator and reader endpoints, and available npm scripts. The application currently uses a custom `public.users` table with bcrypt passwords and Supabase-backed Express sessions; Supabase Auth is not configured or used by this repository. The service-role key is held by the Node server and is not a Vite variable. `.env` is ignored and is not tracked in the current Git history. No credential literal was found in tracked application source during the targeted scan.

Baseline before changes: `npm run build` passed; `node --check backend/server.js` passed; no test script existed. A repository-wide history scan for credentials and live Supabase policy inspection were not available in this environment.

## Findings

| Severity | Finding | Status |
|---|---|---|
| Critical | The baseline dependency scan flagged `proxy-addr` 2.0.7 for IP spoofing through IPv4-mapped IPv6 trust handling. Because production trusts the Render proxy and IP participates in rate-limit keys, spoofing could weaken those limits. | Fixed by updating the dependency tree to `proxy-addr` 2.0.8; the final full `npm audit` reports zero advisories. No code-level critical exploit was confirmed in the source review. |
| High | Password reset codes had 32 bits of entropy, and password update and token consumption were separate database writes. Concurrent reuse could race. | Fixed in the API and `production_hardening_migration.sql`: codes now have 128 bits of entropy, and a database function locks and consumes the token and updates the password atomically. Apply the migration before deploying this API change. |
| High | Book and cover uploads trusted caller MIME and short signatures. Replacement updated the record without cleaning the previous object. | Fixed with server-side format checks, byte limits, UUID object keys, private bucket enforcement at startup, update-after-upload ordering, old-object cleanup, and cleanup-failure diagnostics. PDF/TXT are supported; EPUB is not. |
| High | The API uses Supabase `service_role`, which bypasses RLS. A route authorization defect or exposed key could reach all application data. RLS was enabled, but direct browser grants and existing Storage policies had not been explicitly constrained by the app migrations. | Mitigation added: the new migration revokes browser-role grants on application tables and sequences, preserves service-role API access, and adds a restrictive Storage policy for the private book and cover buckets. Apply and inspect it in the actual Supabase project before deployment. Backend role checks and owner filters remain essential. |
| Medium | No bounded timeout existed for Supabase or SMTP calls; deployment health checks used `/api/session/`, which was not a dependency readiness check. Errors could log raw objects and return development details. | Fixed with bounded client timeouts, SMTP timeouts, `/api/health/live/`, database-and-Storage `/api/health/ready/`, Render health path update, request IDs, structured sanitized error logs, and generic client errors. |
| Medium | Catalogue search and file uploads had no dedicated rate limit, and uploads had no automated validation tests. | Fixed with shared Supabase rate limits and Node built-in unit tests for supported upload formats, signatures, encoding, filename normalization, and size limits. |
| Medium | Express session rolling could extend an active login indefinitely; registration and login responses disclosed account state in a few cases. | Fixed with an eight-hour absolute session age, generic login/duplicate-registration responses, and rate-limited audit events for authenticated role denials. Password reset also invalidates that user's stored sessions. Existing sessions without the new authentication timestamp must sign in again. |
| Medium | Current reader history/favourites/progress/bookmark authorization depends on the Express session and server-side `req.user.id` filters because accounts are not Supabase Auth identities. | Existing model preserved. The SQL migration leaves browser roles without table grants or Storage access; authenticated integration tests with two reader accounts remain required. |
| Low | The repository has no EPUB upload or EPUB reader despite the broader product brief mentioning EPUB. | Not changed; current product behavior remains PDF and TXT only. |
| Low | Backup/PITR availability and live Storage policies depend on the Supabase project and plan. Those project settings were not inspectable here. | See `RECOVERY_RUNBOOK.md`; verify plan and policy state in the Supabase dashboard. |

## Implemented controls

- Server-owned UUID request IDs are returned in `X-Request-ID`; errors and audit details carry the ID without logging query strings, passwords, reset codes, tokens, signed URLs, or raw error messages.
- Supabase fetches use an abort deadline configured by `SUPABASE_TIMEOUT_MS` (default 20 seconds; accepted range 1–60 seconds). SMTP connection, greeting, and socket deadlines are set.
- Readiness checks both the application database and configured book bucket without creating an authenticated session. Liveness does not depend on Supabase.
- Startup creates or updates the two app buckets as private, with their configured limits and MIME allowlists.
- Book files are validated as complete PDF (header and EOF marker) or strict UTF-8 text; covers are checked against JPEG, PNG, or WEBP signatures. MIME, extension, bytes, and server limits must agree.
- Uploads use generated object keys. The old object remains referenced until the new upload and database update succeed; cleanup errors are recorded without exposing object paths.
- Password-reset confirmation consumes all pending codes and changes the password in one database transaction.
- Reader-owned state remains filtered by the authenticated session user ID in the API. `reader_features_migration.sql` enables RLS and grants app access only to `service_role`.
- Admins retain the existing TOTP MFA flow; role checks still read the stored account role on every protected request.
- A current npm advisory scan initially found 9 issues (1 critical, 5 high, 2 moderate, 1 low). Compatible patch updates were applied within existing semver ranges; the final full `npm audit` reports zero vulnerabilities. The production build and tests pass after the update.

## Not verified

- The SQL migration has not been applied to a Supabase project; schema syntax and actual grants/policies must be reviewed and run in staging first.
- No controlled reader/admin account was available for MFA, cross-account access, uploads, PDF/TXT reading, or recovery end-to-end tests.
- Supabase dashboard policies, project plan, PITR availability, backups, Render environment variables, and live deployment health were not inspected.
- Malware scanning is not installed or claimed. PDF signature checks do not prove that a document is benign.
- Automated tests cover validation helpers; they do not replace API authorization, database RLS/grant, or browser integration tests.
- `npm audit` is currently clean, but dependency advisories change over time; repeat the scan in CI and before deployment.
