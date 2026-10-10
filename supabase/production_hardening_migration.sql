-- Apply after schema.sql, security_hardening_migration.sql,
-- admin_features_migration.sql, and reader_features_migration.sql.
-- This is additive and preserves existing accounts, catalogue, and reader data.
begin;

alter table public.users enable row level security;
alter table public.books enable row level security;
alter table public.login_activities enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.email_verification_tokens enable row level security;
alter table public.newsletter_subscriptions enable row level security;
alter table public.app_sessions enable row level security;
alter table public.security_rate_limits enable row level security;
alter table public.security_audit_logs enable row level security;
alter table public.categories enable row level security;
alter table public.authors enable row level security;
alter table public.book_authors enable row level security;
alter table public.book_open_events enable row level security;
alter table public.library_settings enable row level security;
alter table public.reader_favourites enable row level security;
alter table public.reader_progress enable row level security;
alter table public.reader_bookmarks enable row level security;
alter table public.reader_history enable row level security;

-- The application uses its Node API with service_role. No browser uses the
-- Supabase Data API directly, so anon/authenticated receive no table access.
revoke all on table
  public.users, public.books, public.login_activities,
  public.password_reset_tokens, public.email_verification_tokens,
  public.newsletter_subscriptions, public.app_sessions,
  public.security_rate_limits, public.security_audit_logs,
  public.categories, public.authors, public.book_authors,
  public.book_open_events, public.library_settings,
  public.reader_favourites, public.reader_progress,
  public.reader_bookmarks, public.reader_history
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.users, public.books, public.login_activities,
  public.password_reset_tokens, public.email_verification_tokens,
  public.newsletter_subscriptions, public.app_sessions,
  public.security_rate_limits, public.security_audit_logs,
  public.categories, public.authors, public.book_authors,
  public.book_open_events, public.library_settings,
  public.reader_favourites, public.reader_progress,
  public.reader_bookmarks, public.reader_history
to service_role;

revoke all on sequence
  public.users_id_seq, public.books_id_seq, public.login_activities_id_seq,
  public.password_reset_tokens_id_seq, public.email_verification_tokens_id_seq,
  public.newsletter_subscriptions_id_seq, public.security_audit_logs_id_seq,
  public.categories_id_seq, public.authors_id_seq, public.book_open_events_id_seq,
  public.reader_bookmarks_id_seq
from public, anon, authenticated;
grant usage, select on sequence
  public.users_id_seq, public.books_id_seq, public.login_activities_id_seq,
  public.password_reset_tokens_id_seq, public.email_verification_tokens_id_seq,
  public.newsletter_subscriptions_id_seq, public.security_audit_logs_id_seq,
  public.categories_id_seq, public.authors_id_seq, public.book_open_events_id_seq,
  public.reader_bookmarks_id_seq
to service_role;

alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

revoke all on function public.consume_security_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_security_rate_limit(text) from public, anon, authenticated;
revoke all on function public.admin_library_analytics(timestamptz) from public, anon, authenticated;
revoke all on function public.block_audit_mutation() from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, integer, integer) to service_role;
grant execute on function public.clear_security_rate_limit(text) to service_role;
grant execute on function public.admin_library_analytics(timestamptz) to service_role;

-- Restrictive policies prevent any existing permissive Storage policy from
-- exposing the two private library buckets to direct browser roles. The API
-- uses service_role, which bypasses RLS by design.
drop policy if exists library_private_buckets_deny_browser on storage.objects;
create policy library_private_buckets_deny_browser
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id not in ('private-books', 'private-book-covers'))
  with check (bucket_id not in ('private-books', 'private-book-covers'));
update storage.buckets set public = false
where id in ('private-books', 'private-book-covers');

-- Serialize password-reset confirmation and consume all outstanding codes in
-- one transaction so a concurrent replay cannot update the password twice.
create or replace function public.consume_password_reset(
  p_username text,
  p_token_hash text,
  p_password_hash text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  matched_user_id bigint;
begin
  if p_username is null or length(p_username) > 64
     or p_token_hash is null or length(p_token_hash) <> 64
     or p_password_hash is null or length(p_password_hash) > 100 then
    return null;
  end if;

  select u.id into matched_user_id
  from public.users u
  join public.password_reset_tokens t on t.user_id = u.id
  where u.username = p_username
    and t.token_hash = p_token_hash
    and t.used_at is null
    and t.expires_at > clock_timestamp()
  order by t.id desc
  limit 1
  for update of u, t;

  if matched_user_id is null then return null; end if;

  update public.users set password_hash = p_password_hash where id = matched_user_id;
  update public.password_reset_tokens set used_at = clock_timestamp()
  where user_id = matched_user_id and used_at is null;
  delete from public.app_sessions
  where session_data ->> 'userId' = matched_user_id::text
     or session_data ->> 'pendingMfaUserId' = matched_user_id::text;
  return matched_user_id;
end;
$$;
revoke all on function public.consume_password_reset(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_password_reset(text, text, text) to service_role;

commit;
