# NPRT63

## NPRT63 - Project

[![Code License](https://img.shields.io/badge/Code%20License-GPLv2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Follow%20%40iammelvink-blue.svg?style=social&logo=linkedin)](https://www.linkedin.com/in/iammelvink)

## Overview

This is a read-only digital library with a React/Vite frontend and a Node.js/Express API. Supabase PostgreSQL stores application data and Supabase Storage stores private digital book files.

## Run locally

```sh
npm install
npm run dev       # React development server and Node API
```

Copy `.env.example` to `.env`, replace every placeholder with real values, and fill in your Supabase project URL, server-only service role key, browser-safe anon/publishable key, and frontend URL. Apply the existing schema and feature migrations, including `supabase/reader_email_uniqueness_migration.sql`, then run `supabase/supabase_admin_auth_migration.sql`. Apply `supabase/reader_highlights_migration.sql` before deploying the reader highlight feature. The reader email migration enforces one reader account per email address, ignoring case and surrounding whitespace; resolve any existing duplicate reader emails before applying it. The administrator Auth migration adds the nullable `auth_user_id` link, updates the admin reset operation, retains Auth users, and removes legacy admin setup functions that trusted a custom email flag. Keep the service role key server-side and never use a `VITE_` prefix for it. Only the public anon/publishable key belongs in `VITE_SUPABASE_ANON_KEY`.

Open `http://127.0.0.1:5173/static/react/`. The development command starts both
the React site and the online reading API, so digital books can be read
without a second terminal.

### Phone access QR code

The landing page includes a QR code that opens the current library URL on a phone.
For local testing, connect the computer and phone to the same Wi-Fi network, start
`npm run dev`, then open the site on the computer using its LAN address (for example,
`http://192.168.1.25:5173/static/react/`) before scanning. The QR code will then
contain that phone-reachable address. In production it automatically uses the public
site address. You can also set `VITE_LIBRARY_URL` to explicitly choose the URL the
QR code contains.

For production, run `npm run build` and then `npm start`.

Reader accounts use the application's `public.users` table, not Supabase Auth. The Node/Express backend is the sole sender for reader confirmation, confirmation resend, reader password-reset, and administrator-initiated reader recovery emails. Nodemailer sends these messages through Gmail SMTP; Supabase Auth does not send a second reader verification email. Reader confirmation links expire after 24 hours. The registration success screen directs readers to check Inbox and Spam/Junk and offers a resend path without re-registering.

Configure Gmail SMTP on the Node service with `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. `SMTP_USER` is the Gmail account address; `SMTP_PASSWORD` is that account's Google App Password; `MAIL_FROM` must use the same address. The application forces the authenticated Gmail identity as the sender and fails configuration validation if the sender address differs. Set `PUBLIC_APP_URL` to the public portal URL and `PUBLIC_API_URL` to the public API origin; on Render, use your `https://<service>.onrender.com` URL (and `/static/react/` for the app URL), never localhost. The server rejects local-only URLs in production and falls back to Render's public service URL when those variables are accidentally set to localhost. Google requires 2-Step Verification to create an App Password. Do not use your normal Google password. Render Free web services block outbound SMTP on ports 25, 465, and 587; Gmail SMTP therefore requires a paid Render web service. The checked-in Render Blueprint uses the paid Starter plan, but confirm the deployed service's actual plan. Remove any old `RESEND_API_KEY` variable from Render; email delivery now uses Gmail SMTP only. The application no longer sends reservation, due-date, overdue, or fine emails because the system does not track loans or fines.

The application uses React and Vite for the frontend, Node.js and Express for the API, and Supabase for the database, sessions, and private file storage.

### Password reset

Use **Forgot password?** on the member login screen and enter either the account username or registered email. The backend emails a secure one-time reset link that expires after 15 minutes. The database stores only a hash of the random token, and successful password changes validate matching entries, the 8–72 UTF-8 byte password limit, token expiry, and single use. If sending fails, the token is invalidated and the response asks the reader to try again. Configure Gmail SMTP before enabling this flow in production.

For an existing Supabase project, make sure `email_verification_migration.sql` and `production_hardening_migration.sql` have been applied. The latter installs the single-use `consume_password_reset` database function required by the password-reset confirmation endpoint.

The API uses Supabase-backed Express sessions for members and Supabase Auth bearer sessions for administrators. Every protected admin API request checks the confirmed Auth email, active database role link, and AAL2 MFA. Administrator MFA is stored and verified by Supabase Auth; no application MFA encryption key is required. Admin actions are recorded in the append-only audit table. Members can read uploaded PDF and TXT files online while signed in; files are streamed privately through the API. The API stores accounts, digital catalogue metadata, login history, sessions, and audit data in Supabase. Set `SESSION_SECRET` to a stable random value of at least 32 characters and `SUPABASE_TIMEOUT_MS` to a value between 1000 and 60000 (default 20000). Add digital titles and upload their files in the admin catalogue.

### Administrator provisioning and reset

Public registration only creates member accounts. Administrator roles come only from a linked `public.users` profile provisioned by an authorized operator; Supabase user metadata, browser role values, and legacy admin passwords are not trusted. Apply the administrator Auth migration and deploy the API/frontend. Configure Render with server `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL`, and `PUBLIC_API_URL`, Gmail SMTP variables listed above, plus build-time `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The Vite key must be the Supabase anon/publishable key, never the secret/service-role key. Supabase Auth continues to handle administrator invitations, Auth email confirmation, and MFA; configure its Auth email provider separately, keep admin email confirmation enabled, set the Site URL, and allow the full deployed app redirect `https://<render-host>/static/react/**`. Supabase Auth sends admin invitations with its own configured mail settings; Nodemailer sends the custom reader emails and administrator recovery messages. Do not configure a second Supabase Auth flow for readers.

An authorized operator with access to a trusted server environment runs `npm run admin:provision`. It validates and normalizes the email, checks application-account conflicts, and sends a Supabase Auth invitation. For an already-confirmed Supabase identity with no conflicting application profile, it sends a password-recovery/setup email and links that existing identity rather than deleting/recreating it. After the invite is opened, the recipient sets a password and enrolls or verifies a Supabase TOTP factor. Every admin API request independently verifies the Auth token, `email_confirmed_at`, active linked database role, and `aal2`. An operator can retry an unconfirmed invitation with `npm run admin:resend-invite`; if Supabase rejects the repeated invite, use Authentication > Users > the pending user > Resend invitation. Delivery and Auth expiry follow the Supabase Auth SMTP and Email OTP Expiration settings. Never log or paste invitation links, OTPs, access tokens, or secret keys.

The administrator sign-in page's **Forgot admin password?** option sends a rate-limited Supabase Auth recovery email only for a confirmed, active, linked administrator profile. The recovery link redirects to the deployed app's `admin_recovery=1` flow, where the administrator sets a new password and completes MFA.

Before any reset, run `npm run admin:reset-preview` against the intended environment. It identifies only database rows assigned `role = 'admin'`, checks linked Supabase Auth records, counts custom sessions/dependent rows, and reports retained history. It does not delete Supabase Auth identities, members, reader data, or catalogue/storage data. No production reset was run for this change, and a reset must still be explicitly approved for the exact preview before an operator runs `npm run admin:reset`. Resetting an administrator removes its application Auth link, so a replacement can be invited or an already-confirmed identity can receive a password setup email. Ordinary members continue to use the existing member login and registration flow.

Use `npm test` for the backend validation unit tests and `npm run build` for the production frontend build. The opt-in real-service acceptance suite is documented in [SECURITY_STAGING_TESTS.md](SECURITY_STAGING_TESTS.md) and runs with `npm run test:security-staging`. Render uses `/api/health/ready/` as its health check; `/api/health/live/` is a lightweight process liveness endpoint. Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for reviewed findings and [RECOVERY_RUNBOOK.md](RECOVERY_RUNBOOK.md) for backup and recovery steps. These endpoints and local checks do not replace production Supabase policy review, authenticated staging tests, or a tested database and Storage restore.

Written with React, Vite, Express, Supabase, and bcrypt.

1. Methodologies/Project Management:

   - Agile

2. Coding Practices:

   - OOP (Object Oriented Programming)
   - MVC (Model View Controller)

3. Programming Languages/Frameworks:

   - JavaScript, React, Node.js, Express, Supabase

## Instructions

1. Make sure you have these installed

2. Clone `ONLY THE LATEST COMMIT` of this repository into your local machine using the terminal (mac) or
   [Gitbash (PC)](https://git-scm.com/download/win 'Gitbash (PC)') `to save storage space`

   ```sh
   git clone https://github.com/iammelvink/NPRT63.git --depth=1
   ```

## Author(s)

"Group members and lecturer"

[Melvin Kisten](https://github.com/iammelvink 'Melvin Kisten\'s GitHub page')

GitHub: @"Group members"

LinkedIn: [Melvin Kisten](https://www.linkedin.com/in/iammelvink 'Melvin Kisten\'s LinkedIn page')

## Acknowledgments

To my lecturer [Melvin Kisten](https://www.linkedin.com/in/iammelvink 'Melvin Kisten\'s LinkedIn page') for their guidance

## More Stuff

Check out some other stuff on
[Melvin Kisten](https://github.com/iammelvink 'Melvin Kisten\'s GitHub page')
