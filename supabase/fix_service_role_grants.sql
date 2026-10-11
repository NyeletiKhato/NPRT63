-- Run in Supabase SQL Editor if account creation or sign-in returns an
-- unexpected server error because the service_role cannot access tables.
drop index if exists public.users_email_unique;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
