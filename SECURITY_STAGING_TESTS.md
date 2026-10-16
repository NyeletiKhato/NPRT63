# Staging security acceptance tests

The automated end-to-end suite uses real Supabase Auth, database policies, Storage, email delivery, and the running API. Run it only against a dedicated staging project and API with disposable records. It changes reader data, toggles a staging member active/inactive, sends recovery messages, uploads files, and consumes one password-reset token. Rate-limit buckets remain active for 15 minutes, so run the suite no more than once per window from a given client IP.

## Prepare staging fixtures

1. Apply the current schema and all required migrations to a non-production Supabase project. Confirm the book and cover Storage buckets are private and direct anonymous Storage reads are denied.
2. Start the desktop project API against that staging database. The staging API must be reachable over HTTPS or localhost.
3. Create two active, confirmed member accounts dedicated to this suite. Create one confirmed, active administrator with enrolled MFA, plus test identities/tokens for an unconfirmed admin, inactive admin, non-admin, and admin session at AAL1.
4. Create a published book with a readable digital file and a separate disposable book with no digital file for upload checks. Record a known private object key in the books bucket for the direct-access denial check.
5. Request a member reset for a disposable recovery account. Copy the raw token from that controlled mailbox into `SECURITY_STAGING_FRESH_RESET_TOKEN`. Also prepare a syntactically valid but expired token for that same disposable account as `SECURITY_STAGING_EXPIRED_RESET_TOKEN`. This test consumes the fresh token and changes that account's password.
6. Request an admin recovery link for a different disposable administrator. Extract its Supabase `token_hash` and set it as `SECURITY_STAGING_ADMIN_FRESH_RECOVERY_TOKEN_HASH`. Provide an expired recovery `token_hash` for that same disposable identity as `SECURITY_STAGING_ADMIN_EXPIRED_RECOVERY_TOKEN_HASH`. The test exchanges the fresh OTP once and changes this test admin's password; it does not use the primary AAL2 admin account.
7. Set the variables below in the shell that runs the tests. Never commit these values or use production credentials.

Required variables:

| Variable | Purpose |
| --- | --- |
| `SECURITY_STAGING_ALLOW_MUTATIONS` | Must be exactly `yes`; set only after confirming all configured credentials and URLs point to disposable staging fixtures. |
| `SECURITY_STAGING_URL` | Base URL for the staging API. Its presence enables the suite. |
| `SECURITY_STAGING_MEMBER_A_USERNAME`, `SECURITY_STAGING_MEMBER_A_PASSWORD` | Disposable member A login. |
| `SECURITY_STAGING_MEMBER_B_USERNAME`, `SECURITY_STAGING_MEMBER_B_PASSWORD` | Disposable member B login. |
| `SECURITY_STAGING_READABLE_BOOK_ID` | Published book with an online file for reader checks. |
| `SECURITY_STAGING_DISPOSABLE_UPLOAD_BOOK_ID` | Empty book record reserved for uploads; its cover remains attached after the test. |
| `SECURITY_STAGING_ADMIN_AAL2_TOKEN` | Confirmed active admin access token with AAL2. |
| `SECURITY_STAGING_UNCONFIRMED_ADMIN_TOKEN` | Token for an Auth identity without confirmed email. |
| `SECURITY_STAGING_INACTIVE_ADMIN_TOKEN` | Confirmed admin identity linked to an inactive application profile. |
| `SECURITY_STAGING_NON_ADMIN_TOKEN` | Valid confirmed Auth token without an admin profile. |
| `SECURITY_STAGING_ADMIN_AAL1_TOKEN` | Confirmed active admin session that has not reached AAL2. |
| `SECURITY_STAGING_SUPABASE_URL`, `SECURITY_STAGING_SUPABASE_ANON_KEY` | Public Supabase project URL and anon/publishable key for direct-storage denial. |
| `SECURITY_STAGING_PRIVATE_STORAGE_OBJECT` | Existing private book object key, including any subfolders. |
| `SECURITY_STAGING_RECOVERY_USERNAME` | Disposable member whose reset token fixtures are used. |
| `SECURITY_STAGING_RECOVERY_NEW_PASSWORD` | New password set by the single-use reset test. |
| `SECURITY_STAGING_FRESH_RESET_TOKEN`, `SECURITY_STAGING_EXPIRED_RESET_TOKEN` | Raw tokens from the controlled mailbox and expired fixture. |
| `SECURITY_STAGING_ADMIN_EMAIL` | Confirmed active admin mailbox used to compare generic recovery responses. |
| `SECURITY_STAGING_ADMIN_FRESH_RECOVERY_TOKEN_HASH`, `SECURITY_STAGING_ADMIN_EXPIRED_RECOVERY_TOKEN_HASH` | Fresh and expired Supabase Auth recovery token hashes for a separate disposable administrator. |
| `SECURITY_STAGING_ADMIN_RECOVERY_NEW_PASSWORD` | New password set on that disposable admin during the one-time link check. |

Optionally set `SECURITY_STAGING_BOOKS_BUCKET` if the private book bucket has a name other than `private-books`.

## Run

From the project folder, run:

```sh
npm run test:security-staging
```

The suite checks anonymous route denials; member history, progress, bookmark, and highlight isolation; admin role, confirmation, active-state, and MFA denials; audited admin activity; valid and rejected upload cases; reader file access and anonymous Storage denial; generic recovery responses and member-token expiry/single use; and repeated login, recovery, search, and upload limits.

Admin recovery link expiry and single use must also be verified with the disposable admin's actual recovery link in its controlled mailbox and Supabase Auth configuration. The API intentionally never returns that link, so the test does not expose or log it. Afterward, archive the disposable upload book and recovery accounts or reset their fixtures before another run.
