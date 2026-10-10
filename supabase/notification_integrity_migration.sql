-- Run after the other existing-project migrations. Removes duplicate event
-- notifications before adding indexes that prevent concurrent duplicate alerts.
begin;

delete from public.notifications newer
using public.notifications older
where newer.id > older.id
  and newer.user_id = older.user_id
  and newer.type = older.type
  and (
    (newer.borrow_record_id is not null and newer.borrow_record_id = older.borrow_record_id)
    or (newer.reservation_id is not null and newer.reservation_id = older.reservation_id)
    or (newer.book_id is not null and newer.book_id = older.book_id)
  );

create unique index if not exists notifications_borrow_event_unique
  on public.notifications(user_id,type,borrow_record_id) where borrow_record_id is not null;
create unique index if not exists notifications_reservation_event_unique
  on public.notifications(user_id,type,reservation_id) where reservation_id is not null;
create unique index if not exists notifications_book_event_unique
  on public.notifications(user_id,type,book_id) where book_id is not null;

commit;
