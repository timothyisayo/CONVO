-- Incognito directory discovery and explicit approved-person access.
alter table public.profiles add column if not exists profile_visibility jsonb not null default
  '{"programme": true, "college": true, "level": true, "bio": true, "incognito": false, "allow_exact_id_lookup": false}'::jsonb;

create table if not exists public.profile_approved_people (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  approved_user_id uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  primary key (profile_id, approved_user_id),
  check (profile_id <> approved_user_id)
);
alter table public.profile_approved_people enable row level security;
drop policy if exists "Users manage approved people" on public.profile_approved_people;
create policy "Users manage approved people" on public.profile_approved_people for all to authenticated
using (auth.uid() = profile_id and public.is_mtu_account())
with check (auth.uid() = profile_id and public.is_mtu_account());

create or replace function public.search_mtu_students(p_query text default '')
returns table (id uuid, display_name text, student_id text, is_self boolean, level text, department text, programme text, avatar_url text, bio text, status_text text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select p.id, p.display_name, p.student_id, p.id = auth.uid(), p.level, p.department, p.programme, p.avatar_url, p.bio, p.status_text
  from public.profiles p
  where public.is_mtu_account()
    and (p.id = auth.uid() or coalesce((p.profile_visibility ->> 'incognito')::boolean, false) = false
      or exists (select 1 from public.connection_requests accepted where accepted.status = 'accepted' and ((accepted.requester_id = auth.uid() and accepted.recipient_id = p.id) or (accepted.requester_id = p.id and accepted.recipient_id = auth.uid())))
      or exists (select 1 from public.profile_approved_people approved where approved.profile_id = p.id and approved.approved_user_id = auth.uid())
      or (coalesce((p.profile_visibility ->> 'incognito')::boolean, false) and coalesce((p.profile_visibility ->> 'allow_exact_id_lookup')::boolean, false) and lower(coalesce(p.student_id, '')) = lower(trim(p_query))))
    and (nullif(trim(p_query), '') is null or p.display_name ilike '%' || trim(p_query) || '%'
      or lower(coalesce(p.student_id, '')) = lower(trim(p_query))
      or coalesce(p.level, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.department, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.programme, '') ilike '%' || trim(p_query) || '%')
  order by (p.id = auth.uid()) desc, p.display_name asc limit 24;
$$;

create or replace function public.sync_my_mtu_profile()
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare metadata jsonb; public_name text; visibility jsonb;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Only verified MTU users can synchronize a public profile'; end if;
  select coalesce(raw_user_meta_data, '{}'::jsonb) into metadata from auth.users where id = auth.uid();
  public_name := nullif(trim(coalesce(metadata ->> 'nickname', metadata ->> 'display_name', '')), '');
  if public_name is null then return false; end if;
  visibility := jsonb_build_object(
    'programme', coalesce((metadata -> 'profile_visibility' ->> 'programme')::boolean, true),
    'college', coalesce((metadata -> 'profile_visibility' ->> 'college')::boolean, true),
    'level', coalesce((metadata -> 'profile_visibility' ->> 'level')::boolean, true),
    'bio', coalesce((metadata -> 'profile_visibility' ->> 'bio')::boolean, true),
    'incognito', coalesce((metadata -> 'profile_visibility' ->> 'incognito')::boolean, false),
    'allow_exact_id_lookup', coalesce((metadata -> 'profile_visibility' ->> 'allow_exact_id_lookup')::boolean, false));
  insert into public.profiles (id, display_name, student_id, level, department, programme, avatar_url, bio, profile_visibility)
  values (auth.uid(), public_name, coalesce(nullif(metadata ->> 'student_id', ''), 'MTU-' || upper(substr(replace(auth.uid()::text, '-', ''), 1, 8))),
    nullif(metadata ->> 'level', ''), nullif(coalesce(metadata ->> 'college', metadata ->> 'department'), ''),
    nullif(coalesce(metadata ->> 'programme', metadata ->> 'major'), ''), nullif(metadata ->> 'avatar_url', ''),
    nullif(metadata ->> 'bio', ''), visibility)
  on conflict (id) do update set display_name = excluded.display_name, student_id = coalesce(excluded.student_id, profiles.student_id),
    level = coalesce(excluded.level, profiles.level), department = coalesce(excluded.department, profiles.department),
    programme = coalesce(excluded.programme, profiles.programme), avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    bio = coalesce(excluded.bio, profiles.bio), profile_visibility = excluded.profile_visibility;
  return true;
end;
$$;

create or replace function public.send_connection_request(p_recipient_id uuid)
returns public.connection_requests
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.connection_requests;
begin
  if not public.is_mtu_account() or auth.uid() is null or auth.uid() = p_recipient_id then
    raise exception 'Only verified MTU users can send connection requests';
  end if;
  if not exists (select 1 from public.profiles where id = p_recipient_id) then
    raise exception 'This student is not available for connection requests';
  end if;
  if exists (
    select 1
    from public.profiles p
    where p.id = p_recipient_id
      and coalesce((p.profile_visibility ->> 'incognito')::boolean, false)
      and not exists (
        select 1
        from public.profile_approved_people approved
        where approved.profile_id = p.id
          and approved.approved_user_id = auth.uid()
      )
      and not exists (
        select 1
        from public.connection_requests accepted
        where accepted.status = 'accepted'
          and (
            (accepted.requester_id = auth.uid() and accepted.recipient_id = p.id)
            or (accepted.requester_id = p.id and accepted.recipient_id = auth.uid())
          )
      )
  ) then
    raise exception 'This student only accepts connection requests from approved people';
  end if;
  insert into public.connection_requests (requester_id, recipient_id) values (auth.uid(), p_recipient_id)
  on conflict (requester_id, recipient_id) do update set status = 'pending', updated_at = now() returning * into result;
  return result;
end;
$$;

create or replace function public.list_mtu_approved_people()
returns table(approved_id uuid, display_name text, student_id text, avatar_url text, approved_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select a.approved_user_id, p.display_name, p.student_id, p.avatar_url, a.approved_at
  from public.profile_approved_people a join public.profiles p on p.id = a.approved_user_id
  where a.profile_id = auth.uid() and public.is_mtu_account() order by a.approved_at desc;
$$;

create or replace function public.set_mtu_approved_person(p_student_id text, p_approved boolean default true)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare target_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Only verified MTU users can manage approved people'; end if;
  select id into target_id from public.profiles where lower(student_id) = lower(trim(p_student_id)) and id <> auth.uid();
  if target_id is null then raise exception 'Enter an exact public student ID'; end if;
  if p_approved then insert into public.profile_approved_people values (auth.uid(), target_id, now()) on conflict do nothing;
  else delete from public.profile_approved_people where profile_id = auth.uid() and approved_user_id = target_id; end if;
  return p_approved;
end;
$$;
revoke execute on function public.search_mtu_students(text), public.send_connection_request(uuid), public.list_mtu_approved_people(), public.set_mtu_approved_person(text, boolean) from public, anon;
grant execute on function public.search_mtu_students(text), public.send_connection_request(uuid), public.list_mtu_approved_people(), public.set_mtu_approved_person(text, boolean) to authenticated;
