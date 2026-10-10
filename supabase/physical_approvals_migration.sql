-- Apply this migration in the Supabase SQL Editor for an existing installation.
begin;
alter table public.borrow_records add column if not exists return_requested_at timestamptz;
alter table public.borrow_records drop constraint if exists borrow_records_status_check;
alter table public.borrow_records add constraint borrow_records_status_check check (status in ('pending_approval','borrowed','returned','overdue','rejected'));
alter table public.notifications add column if not exists book_id bigint references public.books(id) on delete cascade;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('due_soon','overdue','reservation_ready','low_stock','borrow_pending','return_pending'));

create or replace function public.borrow_book(p_user_id bigint, p_book_id bigint, p_format text)
returns setof public.borrow_records language plpgsql security definer set search_path = public as $$
declare b public.books%rowtype; new_record public.borrow_records%rowtype; new_status text;
begin
  if p_format not in ('physical','virtual') then raise exception 'Choose a physical or virtual book format.'; end if;
  perform 1 from users where id=p_user_id and is_active=true for update;
  if not found then raise exception 'Member account not found.'; end if;
  select * into b from books where id=p_book_id for update;
  if not found then raise exception 'Book not found.'; end if;
  if exists(select 1 from borrow_records where user_id=p_user_id and book_id=p_book_id and status in ('pending_approval','borrowed','overdue')) then raise exception 'You already have an active or pending request for this book.'; end if;
  if (select count(*) from borrow_records where user_id=p_user_id and status in ('pending_approval','borrowed','overdue')) >= 3 then raise exception 'You can borrow up to 3 books at a time, including requests awaiting approval.'; end if;
  if p_format='virtual' and b.virtual_file_path='' then raise exception 'This book has no virtual version available.'; end if;
  if p_format='physical' and b.available_copies <= 0 then raise exception 'This physical copy is not available right now. Reserve it to join the collection queue.'; end if;
  new_status := case when p_format='physical' then 'pending_approval' else 'borrowed' end;
  insert into borrow_records(user_id,book_id,borrow_date,due_date,book_format,status) values(p_user_id,p_book_id,current_date,current_date+7,p_format,new_status) returning * into new_record;
  return next new_record;
end $$;

create or replace function public.reserve_book(p_user_id bigint, p_book_id bigint)
returns setof public.reservations language plpgsql security definer set search_path = public as $$
declare b public.books%rowtype; r public.reservations%rowtype;
begin
  perform 1 from books where id=p_book_id for update;
  if not found then raise exception 'Book not found.'; end if;
  select * into b from books where id=p_book_id;
  if not found then raise exception 'Book not found.'; end if;
  if b.available_copies>0 then raise exception 'This book is available now. Borrow it instead of reserving it.'; end if;
  if exists(select 1 from borrow_records where user_id=p_user_id and book_id=p_book_id and status in ('borrowed','overdue')) then raise exception 'You already borrowed this book.'; end if;
  if exists(select 1 from reservations where user_id=p_user_id and book_id=p_book_id and status in ('waiting','ready')) then raise exception 'You already have an active reservation for this book.'; end if;
  insert into reservations(user_id,book_id,status) values(p_user_id,p_book_id,'waiting') returning * into r;
  return next r;
end $$;

create or replace function public.return_book(p_user_id bigint, p_record_id bigint)
returns setof public.borrow_records language plpgsql security definer set search_path = public as $$
declare r public.borrow_records%rowtype;
begin
  select * into r from borrow_records where id=p_record_id and user_id=p_user_id for update;
  if not found then raise exception 'Borrow record not found.'; end if;
  if r.status not in ('borrowed','overdue') then raise exception 'This book is not currently borrowed.'; end if;
  if r.book_format='physical' then
    if r.collected_at is null then raise exception 'An administrator must confirm that you collected this physical book before you can return it.'; end if;
    if r.return_requested_at is not null then raise exception 'A return request is already awaiting approval.'; end if;
    update borrow_records set return_requested_at=now() where id=r.id returning * into r;
  else
    update borrow_records set return_date=current_date,status='returned' where id=r.id returning * into r;
  end if;
  return next r;
end $$;

create or replace function public.admin_decide_borrow(p_record_id bigint, p_approve boolean)
returns setof public.borrow_records language plpgsql security definer set search_path = public as $$
declare r public.borrow_records%rowtype; b public.books%rowtype; ready public.reservations%rowtype;
begin
  select * into r from borrow_records where id=p_record_id for update;
  if not found or r.book_format<>'physical' or r.status<>'pending_approval' then raise exception 'This physical book request is no longer awaiting approval.'; end if;
  select * into b from books where id=r.book_id for update;
  if p_approve then
    if b.available_copies<=0 then raise exception 'No copies are currently available to approve this request.'; end if;
    select * into ready from reservations where book_id=r.book_id and status='ready' order by ready_at,id limit 1 for update;
    if found and ready.user_id<>r.user_id then raise exception 'This copy is reserved for the next person in the queue.'; end if;
    if (select count(*) from borrow_records where user_id=r.user_id and status in ('borrowed','overdue'))>=3 then raise exception 'This member already has the maximum number of active books.'; end if;
    update books set available_copies=available_copies-1 where id=b.id;
    if ready.id is not null then update reservations set status='fulfilled',fulfilled_at=now() where id=ready.id; end if;
    update borrow_records set status='borrowed',borrow_date=current_date,due_date=current_date+7 where id=r.id returning * into r;
  else update borrow_records set status='rejected' where id=r.id returning * into r;
  end if;
  return next r;
end $$;

create or replace function public.admin_decide_return(p_record_id bigint, p_approve boolean)
returns setof public.borrow_records language plpgsql security definer set search_path = public as $$
declare r public.borrow_records%rowtype;
begin
  select * into r from borrow_records where id=p_record_id for update;
  if not found or r.book_format<>'physical' or r.status not in ('borrowed','overdue') or r.return_requested_at is null then raise exception 'This physical book return is no longer awaiting approval.'; end if;
  if p_approve then
    update borrow_records set return_date=current_date,status='returned',return_requested_at=null where id=r.id returning * into r;
    update books set available_copies=least(available_copies+1,quantity) where id=r.book_id;
  else update borrow_records set return_requested_at=null where id=r.id returning * into r;
  end if;
  return next r;
end $$;


revoke all on function public.borrow_book(bigint,bigint,text) from public, anon, authenticated;
revoke all on function public.reserve_book(bigint,bigint) from public, anon, authenticated;
revoke all on function public.return_book(bigint,bigint) from public, anon, authenticated;
revoke all on function public.admin_decide_borrow(bigint,boolean) from public, anon, authenticated;
revoke all on function public.admin_decide_return(bigint,boolean) from public, anon, authenticated;
grant execute on function public.borrow_book(bigint,bigint,text) to service_role;
grant execute on function public.reserve_book(bigint,bigint) to service_role;
grant execute on function public.return_book(bigint,bigint) to service_role;
grant execute on function public.admin_decide_borrow(bigint,boolean) to service_role;
grant execute on function public.admin_decide_return(bigint,boolean) to service_role;
commit;
