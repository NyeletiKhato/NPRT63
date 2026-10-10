-- Apply after physical_approvals_migration.sql in the Supabase SQL Editor.
begin;
alter table public.borrow_records add column if not exists stock_reserved boolean not null default false;
update public.books set available_copies=least(available_copies,quantity) where available_copies>quantity;
alter table public.books drop constraint if exists books_available_not_over_quantity;
alter table public.books add constraint books_available_not_over_quantity check (available_copies<=quantity);

create or replace function public.borrow_book(p_user_id bigint, p_book_id bigint, p_format text)
returns setof public.borrow_records language plpgsql security definer set search_path = public as $$
declare b public.books%rowtype; ready public.reservations%rowtype; new_record public.borrow_records%rowtype; new_status text;
begin
  if p_format not in ('physical','virtual') then raise exception 'Choose a physical or virtual book format.'; end if;
  perform 1 from users where id=p_user_id and is_active=true for update;
  if not found then raise exception 'Member account not found.'; end if;
  select * into b from books where id=p_book_id for update;
  if not found then raise exception 'Book not found.'; end if;
  if exists(select 1 from borrow_records where user_id=p_user_id and book_id=p_book_id and status in ('pending_approval','borrowed','overdue')) then raise exception 'You already have an active or pending request for this book.'; end if;
  if (select count(*) from borrow_records where user_id=p_user_id and status in ('pending_approval','borrowed','overdue')) >= 3 then raise exception 'You can borrow up to 3 books at a time, including requests awaiting approval.'; end if;
  if p_format='virtual' and b.virtual_file_path='' then raise exception 'This book has no virtual version available.'; end if;
  if p_format='physical' then
    if b.available_copies <= 0 then raise exception 'This physical copy is not available right now. Reserve it to join the collection queue.'; end if;
    select * into ready from reservations where book_id=p_book_id and status='ready' order by ready_at,id limit 1 for update;
    if found and ready.user_id<>p_user_id then raise exception 'This copy is reserved for the next person in the queue.'; end if;
    update books set available_copies=available_copies-1 where id=p_book_id;
  end if;
  new_status := case when p_format='physical' then 'pending_approval' else 'borrowed' end;
  insert into borrow_records(user_id,book_id,borrow_date,due_date,book_format,status,stock_reserved) values(p_user_id,p_book_id,current_date,current_date+7,p_format,new_status,p_format='physical') returning * into new_record;
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
  if exists(select 1 from borrow_records where user_id=p_user_id and book_id=p_book_id and status in ('pending_approval','borrowed','overdue')) then raise exception 'You already have an active or pending request for this book.'; end if;
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
    if not r.stock_reserved and b.available_copies<=0 then raise exception 'No copies are currently available to approve this request.'; end if;
    select * into ready from reservations where book_id=r.book_id and status='ready' order by ready_at,id limit 1 for update;
    if found and ready.user_id<>r.user_id then raise exception 'This copy is reserved for the next person in the queue.'; end if;
    if (select count(*) from borrow_records where user_id=r.user_id and status in ('borrowed','overdue'))>=3 then raise exception 'This member already has the maximum number of active books.'; end if;
    if not r.stock_reserved then update books set available_copies=available_copies-1 where id=b.id; end if;
    if ready.id is not null then update reservations set status='fulfilled',fulfilled_at=now() where id=ready.id; end if;
    update borrow_records set status='borrowed',borrow_date=current_date,due_date=current_date+7,stock_reserved=false where id=r.id returning * into r;
  else
    if r.stock_reserved then update books set available_copies=least(available_copies+1,quantity) where id=b.id; end if;
    update borrow_records set status='rejected',stock_reserved=false where id=r.id returning * into r;
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

create or replace function public.admin_update_book_inventory(p_book_id bigint, p_quantity integer, p_available_copies integer)
returns setof public.books language plpgsql security definer set search_path = public as $$
declare b public.books%rowtype; allocated integer;
begin
  if p_quantity<0 or p_available_copies<0 or p_available_copies>p_quantity then raise exception 'Available copies must be between zero and total quantity.'; end if;
  select * into b from books where id=p_book_id for update;
  if not found then raise exception 'Book not found.'; end if;
  select count(*) into allocated from borrow_records where book_id=p_book_id and book_format='physical' and (status in ('borrowed','overdue') or (status='pending_approval' and stock_reserved));
  if p_quantity < allocated + p_available_copies then raise exception 'Quantity and available copies must account for the % copies already borrowed or reserved.', allocated; end if;
  update books set quantity=p_quantity,available_copies=p_available_copies where id=p_book_id returning * into b;
  return next b;
end $$;


revoke all on function public.borrow_book(bigint,bigint,text) from public, anon, authenticated;
revoke all on function public.reserve_book(bigint,bigint) from public, anon, authenticated;
revoke all on function public.return_book(bigint,bigint) from public, anon, authenticated;
revoke all on function public.admin_decide_borrow(bigint,boolean) from public, anon, authenticated;
revoke all on function public.admin_decide_return(bigint,boolean) from public, anon, authenticated;
revoke all on function public.admin_update_book_inventory(bigint,integer,integer) from public, anon, authenticated;
grant execute on function public.borrow_book(bigint,bigint,text) to service_role;
grant execute on function public.reserve_book(bigint,bigint) to service_role;
grant execute on function public.return_book(bigint,bigint) to service_role;
grant execute on function public.admin_decide_borrow(bigint,boolean) to service_role;
grant execute on function public.admin_decide_return(bigint,boolean) to service_role;
grant execute on function public.admin_update_book_inventory(bigint,integer,integer) to service_role;
commit;
