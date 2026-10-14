-- Require a single reader account per email, ignoring case and surrounding
-- whitespace. Administrator emails are not included in this reader constraint.
-- Resolve any existing duplicate reader emails before applying this migration.
do $$
begin
  if exists (
    select 1
    from public.users
    where role = 'user' and btrim(email) <> ''
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Duplicate reader email addresses exist. Resolve them before applying reader_email_uniqueness_migration.sql.';
  end if;
end
$$;

create unique index if not exists users_reader_email_unique_idx
  on public.users (lower(btrim(email)))
  where role = 'user' and btrim(email) <> '';
