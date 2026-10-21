revoke update on public.mtu_notifications from public, anon, authenticated;
grant update (read_at) on public.mtu_notifications to authenticated;
revoke insert on public.mtu_notifications from public, anon, authenticated;

create or replace function public.dedupe_mtu_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.entity_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.recipient_id::text || ':' || new.notification_type || ':' || new.entity_id::text,
    0
  ));

  if exists (
    select 1
    from public.mtu_notifications notification
    where notification.recipient_id = new.recipient_id
      and notification.notification_type = new.notification_type
      and notification.entity_id = new.entity_id
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.dedupe_mtu_notification() from public, anon, authenticated;

drop trigger if exists mtu_notifications_deduplicate on public.mtu_notifications;
create trigger mtu_notifications_deduplicate
  before insert on public.mtu_notifications
  for each row execute function public.dedupe_mtu_notification();

notify pgrst, 'reload schema';
