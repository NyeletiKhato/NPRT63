# NPRT63

## NPRT63 - Project

[![Code License](https://img.shields.io/badge/Code%20License-GPLv2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Follow%20%40iammelvink-blue.svg?style=social&logo=linkedin)](https://www.linkedin.com/in/iammelvink)

## Overview

This is a Library Management System with a React/Vite frontend and a Node.js/Express API. Supabase PostgreSQL stores application data and Supabase Storage stores private virtual book files.

## Run locally

```sh
npm install
npm run dev       # React development server and Node API
```

Copy `.env.example` to `.env`, replace every placeholder with real values, fill in your Supabase project URL and service role key, and run `supabase/schema.sql` once in the Supabase SQL Editor. For an existing project, also run `supabase/email_verification_migration.sql`, `supabase/physical_approvals_migration.sql`, `supabase/inventory_concurrency_migration.sql`, `supabase/security_hardening_migration.sql`, and `supabase/notification_integrity_migration.sql` (in that order). If needed, run `supabase/fix_service_role_grants.sql` there to grant the Node API access to the tables. Keep the service role key server-side and never use a `VITE_` prefix for it.

Open `http://127.0.0.1:5173/static/react/`. The development command starts both
the React site and the borrowing API, so catalogue actions such as **Borrow** work
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

New member registrations require email confirmation. For Gmail, use `smtp.gmail.com` with port `587` and TLS. Set `SMTP_USER` and `MAIL_FROM` to the Gmail sender address and `SMTP_PASSWORD` to that account's Google App Password. Google requires 2-Step Verification for App Passwords. Set `PUBLIC_APP_URL` to the deployed app URL. Confirmation links expire after 24 hours; unverified members cannot sign in.

The Node/Express backend in `backend/server.js` is the active application backend. The Django directory and SQLite file are retained only as a legacy data source; they are not required to run the application.

### Password reset

Use **Forgot password?** on the member login screen. The one-time reset code expires after 15 minutes. It is emailed when SMTP is configured; only local development may display it in the interface. Configure Gmail SMTP before public deployment.

The API requires CSRF tokens, throttles sign-in/registration/reset/MFA attempts through Supabase, stores sessions in Supabase with an eight-hour expiry, and requires authenticator-based MFA for admins. Admin actions are recorded in a database append-only audit table; for independent tamper evidence, export these records to a separate protected logging account. The library portal sends security headers, and its network-address helper is disabled in production. Physical borrowing and returns wait for admin approval and generate in-app admin notifications. Borrow requests reserve an available copy atomically, so concurrent requests cannot claim the same last copy. Inventory edits are checked against borrowed and reserved copies, and available copies cannot exceed total quantity. Admins also receive low-stock alerts when available copies reach `LOW_STOCK_THRESHOLD` (defaults to 2). The admin notification bell refreshes every minute. Physical loans are no longer auto-returned; admins approve each physical return request. The API uses cookie sessions and stores its user, catalogue, lending, reservation, notification, report, and audit data in Supabase. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and a stable random `MFA_ENCRYPTION_KEY` of at least 32 characters before deploying. Admins enroll an authenticator app at their next sign-in. Back up the MFA encryption key securely; losing it requires admins to enroll again through a trusted database operator. To retain existing Django records, run `npm run migrate-django-data` after applying the schema and setting the Supabase environment variables. Django PBKDF2 passwords remain valid and are upgraded to bcrypt after a successful login.

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
