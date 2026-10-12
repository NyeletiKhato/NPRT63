-- Prevent duplicate authors that differ only by case or extra whitespace.
-- Resolve existing duplicate names before applying this migration.
begin;

do $$
begin
  if exists (
    select 1
    from public.authors
    group by lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception 'Resolve duplicate author names (ignoring case and extra spaces) before applying this migration.';
  end if;
end;
$$;

create unique index if not exists authors_normalized_name_unique_idx
  on public.authors (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

commit;
