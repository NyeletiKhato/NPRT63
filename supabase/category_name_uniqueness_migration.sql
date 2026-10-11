-- Prevent duplicate categories that differ only by case or spacing.
-- Run in the Supabase SQL Editor after resolving any existing duplicate names.
begin;

do $$
begin
  if exists (
    select 1
    from public.categories
    group by lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception 'Resolve duplicate category names (ignoring case and extra spaces) before applying this migration.';
  end if;
end;
$$;

create unique index if not exists categories_normalized_name_unique_idx
  on public.categories (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

commit;
