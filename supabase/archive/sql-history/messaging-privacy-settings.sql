-- CONVO PRIVACY SETTINGS
-- Run after the base Convo messaging SQL. Safe to rerun.
-- Values are private per-user controls; no legal names or emails are exposed.

create table if not exists public.mtu_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  allow_messages text not null default 'connections' check (allow_messages in ('everyone', 'connections', 'nobody')),
  allow_calls text not null default 'connections' check (allow_calls in ('everyone', 'connections', 'nobody')),
  show_read_receipts boolean not null default true,
  show_online_status boolean not null default true,
  allow_group_invites boolean not null default true,
  disappearing_messages_seconds integer not null default 0 check (disappearing_messages_seconds in (0, 86400, 604800, 2592000)),
  updated_at timestamptz not null default now()
);

alter table public.mtu_privacy_settings enable row level security;

create or replace function public.get_mtu_privacy_settings()
returns jsonb
language plpgsql security definer volatile set search_path = pg_catalog, public, auth
as $$
declare settings public.mtu_privacy_settings;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Verified MTU access required'; end if;
  insert into public.mtu_privacy_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into settings from public.mtu_privacy_settings where user_id = auth.uid();
  return jsonb_build_object(
    'allow_messages', settings.allow_messages,
    'allow_calls', settings.allow_calls,
    'show_read_receipts', settings.show_read_receipts,
    'show_online_status', settings.show_online_status,
    'allow_group_invites', settings.allow_group_invites,
    'disappearing_messages_seconds', settings.disappearing_messages_seconds
  );
end;
$$;

create or replace function public.set_mtu_privacy_settings(
  p_allow_messages text,
  p_allow_calls text,
  p_show_read_receipts boolean,
  p_show_online_status boolean,
  p_allow_group_invites boolean,
  p_disappearing_messages_seconds integer default 0
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare settings public.mtu_privacy_settings;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Verified MTU access required'; end if;
  if p_allow_messages not in ('everyone', 'connections', 'nobody') or p_allow_calls not in ('everyone', 'connections', 'nobody') then raise exception 'Invalid privacy audience'; end if;
  if p_disappearing_messages_seconds not in (0, 86400, 604800, 2592000) then raise exception 'Invalid disappearing-message duration'; end if;
  insert into public.mtu_privacy_settings (user_id, allow_messages, allow_calls, show_read_receipts, show_online_status, allow_group_invites, disappearing_messages_seconds, updated_at)
  values (auth.uid(), p_allow_messages, p_allow_calls, p_show_read_receipts, p_show_online_status, p_allow_group_invites, p_disappearing_messages_seconds, now())
  on conflict (user_id) do update set
    allow_messages = excluded.allow_messages,
    allow_calls = excluded.allow_calls,
    show_read_receipts = excluded.show_read_receipts,
    show_online_status = excluded.show_online_status,
    allow_group_invites = excluded.allow_group_invites,
    disappearing_messages_seconds = excluded.disappearing_messages_seconds,
    updated_at = now();
  select * into settings from public.mtu_privacy_settings where user_id = auth.uid();
  return jsonb_build_object(
    'allow_messages', settings.allow_messages,
    'allow_calls', settings.allow_calls,
    'show_read_receipts', settings.show_read_receipts,
    'show_online_status', settings.show_online_status,
    'allow_group_invites', settings.allow_group_invites,
    'disappearing_messages_seconds', settings.disappearing_messages_seconds
  );
end;
$$;

revoke all on public.mtu_privacy_settings from anon, authenticated;
revoke execute on function public.get_mtu_privacy_settings(), public.set_mtu_privacy_settings(text,text,boolean,boolean,boolean,integer) from public, anon;
grant execute on function public.get_mtu_privacy_settings(), public.set_mtu_privacy_settings(text,text,boolean,boolean,boolean,integer) to authenticated;
