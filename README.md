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

Copy `.env.example` to `.env`, replace every placeholder with real values, and fill in your Supabase project URL and service role key. For a new Supabase project, run `supabase/schema.sql`, `supabase/admin_features_migration.sql`, `supabase/reader_features_migration.sql`, and `supabase/production_hardening_migration.sql` in that order. For an existing project, run any previously unapplied `supabase/email_verification_migration.sql` and `supabase/security_hardening_migration.sql`, then `supabase/read_only_digital_migration.sql`, `supabase/admin_features_migration.sql`, `supabase/reader_features_migration.sql`, and `supabase/production_hardening_migration.sql`. The read-only cleanup permanently removes loans, reservations, fines, circulation notifications, physical-only titles, and inventory fields; back up data first if you need it. The admin migration adds content organization, publishing, settings, analytics, and a private cover bucket. The reader migration adds private favourites, reading position, bookmarks, and history. The hardening migration removes direct browser-role access to app tables, protects private library Storage buckets even if permissive bucket policies already exist, and adds atomic password-reset consumption. If needed, run `supabase/fix_service_role_grants.sql` before the hardening migration to restore backend table access. Keep the service role key server-side and never use a `VITE_` prefix for it.

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

New member registrations require email confirmation. For local Gmail SMTP, use `smtp.gmail.com` with port `465` and `SMTP_SECURE=true` (or port `587` and `SMTP_SECURE=false` if the network allows STARTTLS). Set `SMTP_USER` and `MAIL_FROM` to the Gmail sender address and `SMTP_PASSWORD` to that account's Google App Password. Google requires 2-Step Verification for App Passwords. Set `PUBLIC_APP_URL` to the member portal URL and `PUBLIC_API_URL` to the publicly reachable API origin used by confirmation links. If the portal and API share an origin, `PUBLIC_API_URL` may match `PUBLIC_APP_URL`; local development uses the API at `http://127.0.0.1:3000`. Confirmation links expire after 24 hours; unverified members cannot sign in.

SMTP is used for account confirmation and password reset emails. The application no longer sends reservation, due-date, overdue, or fine emails because the system does not track loans or fines.

The Node/Express backend in `backend/server.js` is the active application backend. The Django directory and SQLite file are retained only as a legacy data source; they are not required to run the application.

### Password reset

Use **Forgot password?** on the member login screen and enter either the account username or registered email. The one-time reset code expires after 15 minutes and is emailed to the account address. Production requests fail clearly if SMTP is missing or cannot send; only local development may display a reset code in the interface. Configure Gmail SMTP before public deployment.

The API requires CSRF tokens, throttles sign-in/registration/reset/MFA attempts through Supabase, stores sessions in Supabase with an eight-hour expiry, and requires authenticator-based MFA for admins. This app currently uses its own `public.users` table, bcrypt hashes, and Express sessions; it does not use Supabase Auth. Admin actions are recorded in an append-only audit table; for independent tamper evidence, export these records to a separate protected logging account. The library portal sends security headers, and its network-address helper is disabled in production. Members can read uploaded PDF and TXT files online while signed in; files are streamed privately through the API. EPUB is not accepted by the current upload or reader implementation. There are no download controls, physical holdings, borrowing, returns, reservations, due dates, fines, or circulation alerts. The API stores accounts, digital catalogue metadata, login history, sessions, and audit data in Supabase. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and a stable random `MFA_ENCRYPTION_KEY` of at least 32 characters before deploying. Set `SUPABASE_TIMEOUT_MS` to a value between 1000 and 60000 (default 20000). Admins enroll an authenticator app at their next sign-in. Back up the MFA encryption key securely; losing it requires admins to enroll again through a trusted database operator. The legacy import script can retain member accounts and login history; add digital titles and upload their files in the admin catalogue. Django PBKDF2 passwords remain valid and are upgraded to bcrypt after a successful login.

Use `npm test` for the backend validation unit tests and `npm run build` for the production frontend build. Render uses `/api/health/ready/` as its health check; `/api/health/live/` is a lightweight process liveness endpoint. Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for reviewed findings and [RECOVERY_RUNBOOK.md](RECOVERY_RUNBOOK.md) for backup and recovery steps. These endpoints and local checks do not replace production Supabase policy review, authenticated staging tests, or a tested database and Storage restore.

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
