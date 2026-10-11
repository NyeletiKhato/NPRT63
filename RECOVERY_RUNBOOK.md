# Recovery runbook

This runbook covers the Node/Render app, Supabase PostgreSQL, and private Supabase Storage buckets `private-books` and `private-book-covers`. Supabase plan capabilities have not been verified for this project.

## Recommended recovery targets

Until the library sets formal targets, use a 24-hour recovery point objective (RPO) and a four-hour recovery time objective (RTO) as working targets. Reader progress and catalogue edits may warrant a shorter RPO. Confirm these targets with the library owner before production use.

## Backups to configure

1. In the Supabase dashboard, record the project plan and whether automated backups and point-in-time recovery (PITR) are actually enabled. Do not assume they are available from the plan name alone.
2. Keep schema and migrations in Git. Before any migration, create a database backup or confirm the provider backup is restorable. Keep a separately protected, encrypted daily logical PostgreSQL backup for an RPO of 24 hours; retain at least 7 daily and 4 weekly copies outside the production project.
3. Back up both Storage buckets daily to a separate private account or protected object store. Retain object paths and checksums so they can be compared with `books.virtual_file_path` and `books.cover_path`. Never commit book files or backups to the public source repository.
4. Store Render environment configuration in the team's approved secret manager and document variable names, owners, and rotation steps. Keep `SESSION_SECRET`, SMTP credentials, and the Supabase service-role key out of backups that are accessible to ordinary developers. Supabase Auth stores and protects administrator MFA factors.
5. Test a restore quarterly in a separate Supabase project and a non-production Render service. Record elapsed recovery time, row counts, Storage checksums, and the validation account used.

## Incident recovery

1. **Identify:** Check Render deploy and error logs, `/api/health/live/`, `/api/health/ready/`, Supabase database and Storage status, recent migrations, and the `X-Request-ID` from a reported failure. Search structured events using request IDs; do not copy secrets, session cookies, reset tokens, or signed URLs into incident notes.
2. **Contain:** Pause administrator writes and file replacements by placing the app in maintenance mode or scaling the Render service to zero if data corruption or credential misuse is suspected. Preserve logs and a current database snapshot before attempting repairs. Rotate credentials only through the approved secret manager and update Render securely.
3. **Restore in isolation:** Create or select a separate recovery Supabase project. Restore the database backup there, then apply only migrations newer than that backup in documented order. Restore both private Storage buckets while preserving object paths. Do not overwrite production until the isolated recovery passes validation.
4. **Check references:** Compare the restored set of book and cover paths against Storage listings. Confirm each referenced object exists, sizes are plausible, and no bucket is public. Identify orphaned objects for later review; do not bulk-delete them during incident recovery.
5. **Validate:** From a controlled staging app, verify reader login, admin password plus MFA, role-denied behavior, catalogue filters, PDF and TXT open, upload and safe replacement, favourites, bookmarks, progress, history, password reset, audit events, and readiness. Verify reader A cannot see reader B's data and that unpublished books are inaccessible to readers.
6. **Resume safely:** Deploy the verified code and restored data to the intended service, confirm the Render health check remains ready, check error rates and a controlled reader/admin smoke test, then restore normal writes. Keep the incident snapshot and recovered backup under the retention policy.

## Administrator recovery

Members authenticate through the existing `public.users` and `public.app_sessions` flow. Administrators authenticate through Supabase Auth and must have a linked active profile, a confirmed email, and AAL2 for every protected API request. Apply `supabase/supabase_admin_auth_migration.sql`. An authorized operator can preview the affected database admin rows and linked Auth identities with `npm run admin:reset-preview`. Do not run the production reset until the library owner approves that exact preview. `npm run admin:reset` demotes only the listed admin profiles, clears their Auth links, revokes custom sessions and unused tokens, and preserves all Supabase Auth identities, member accounts, library data, and audit history. It asks for an exact typed confirmation. Restore access using `npm run admin:provision`; an existing confirmed Auth identity is retained and receives a password setup email. Configure the Supabase Auth email provider/SMTP and the Render public Vite Auth keys. Supabase Auth owns administrator MFA enrollment and verification.

## Rollback

The production-hardening migration is additive to application records; it changes grants and adds a function and a restrictive policy. Roll back application code first if necessary. Do not blindly reverse the access restrictions to restore service. Diagnose the failing grant or policy in staging, then make a reviewed forward migration. Restore a database snapshot only when data damage is confirmed and the snapshot's data-loss window is accepted.

## Project checks still required

- Verify actual Supabase plan, automated backup/PITR status, retention, and restore procedure in the dashboard.
- Verify both named buckets are private and inspect every policy on `storage.objects` that can address them.
- Configure and test Render health path `/api/health/ready/` and all required environment variables.
- Complete one isolated database and Storage restore and record the measured RPO/RTO before claiming disaster recovery is tested.
