-- Remove circulation and physical inventory from an existing library database.
-- This permanently deletes all loan/reservation history, fine balances and
-- catalogue entries that do not have an uploaded digital book file.
begin;

drop function if exists public.borrow_book(bigint,bigint,text) cascade;
drop function if exists public.reserve_book(bigint,bigint) cascade;
drop function if exists public.return_book(bigint,bigint) cascade;
drop function if exists public.admin_decide_borrow(bigint,boolean) cascade;
drop function if exists public.admin_decide_return(bigint,boolean) cascade;
drop function if exists public.admin_update_book_inventory(bigint,integer,integer) cascade;

drop table if exists public.borrow_records cascade;
drop table if exists public.reservations cascade;

-- Remove titles that were only present as physical holdings. Digital titles
-- and their private files remain in the catalogue.
delete from public.books where coalesce(virtual_file_path, '') = '';
alter table public.books drop column if exists quantity cascade;
alter table public.books drop column if exists available_copies cascade;

drop table if exists public.notifications cascade;

commit;
