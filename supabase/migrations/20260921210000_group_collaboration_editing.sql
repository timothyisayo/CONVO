  -- Secured edit/close/delete RPCs for group collaboration data.
  -- Tables remain inaccessible directly; every operation is membership and role checked.

  create or replace function public.update_mtu_group_poll(
    p_poll_id uuid,
    p_question text,
    p_options text[],
    p_closes_at timestamptz default null,
    p_anonymous_voters boolean default false
  )
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare poll_record public.group_polls; role_value text; option_count integer; option_value text; option_position integer := 0;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to edit a poll'; end if;
    select * into poll_record from public.group_polls where id = p_poll_id;
    if poll_record.id is null then raise exception 'This poll is unavailable'; end if;
    select group_role into role_value from public.conversation_members where conversation_id = poll_record.conversation_id and user_id = auth.uid();
    if role_value is null then raise exception 'You are not a member of this group'; end if;
    if poll_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the poll author or a group admin can edit this poll'; end if;
    if char_length(trim(coalesce(p_question, ''))) not between 1 and 240 then raise exception 'A poll question must be between 1 and 240 characters'; end if;
    option_count := coalesce(array_length(p_options, 1), 0);
    if option_count < 2 or option_count > 8 then raise exception 'A poll needs between 2 and 8 options'; end if;
    if exists (select 1 from unnest(p_options) option_value where char_length(trim(coalesce(option_value, ''))) not between 1 and 100) then raise exception 'Each poll option must be between 1 and 100 characters'; end if;
    if p_closes_at is not null and p_closes_at <= now() then raise exception 'Choose a future poll deadline'; end if;
    select count(*) into option_count from public.group_poll_options where poll_id = p_poll_id;
    if option_count <> coalesce(array_length(p_options, 1), 0) and exists (select 1 from public.group_poll_votes where poll_id = p_poll_id) then
      raise exception 'Poll options cannot be added or removed after voting begins';
    end if;
    update public.group_polls
      set question = trim(p_question), closes_at = p_closes_at, anonymous_voters = coalesce(p_anonymous_voters, false)
      where id = p_poll_id;
    update public.messages set body = 'Poll: ' || trim(p_question) where id = poll_record.message_id;
    if option_count <> coalesce(array_length(p_options, 1), 0) then
      delete from public.group_poll_options where poll_id = p_poll_id;
      option_position := 0;
      foreach option_value in array p_options loop
        option_position := option_position + 1;
        insert into public.group_poll_options(poll_id, position, label) values (p_poll_id, option_position, trim(option_value));
      end loop;
    else
      foreach option_value in array p_options loop
        option_position := option_position + 1;
        update public.group_poll_options set label = trim(option_value) where poll_id = p_poll_id and position = option_position;
      end loop;
    end if;
    return true;
  end;
  $$;

  create or replace function public.close_mtu_group_poll(p_poll_id uuid)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare conversation_id_value uuid; role_value text; creator_id uuid;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to close a poll'; end if;
    select conversation_id, created_by into conversation_id_value, creator_id from public.group_polls where id = p_poll_id;
    select group_role into role_value from public.conversation_members where conversation_id = conversation_id_value and user_id = auth.uid();
    if conversation_id_value is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if creator_id <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the poll author or a group admin can close this poll'; end if;
    update public.group_polls set closes_at = least(coalesce(closes_at, now()), now()) where id = p_poll_id;
    return found;
  end;
  $$;

  create or replace function public.delete_mtu_group_poll(p_poll_id uuid)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare conversation_id_value uuid; creator_id uuid; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to delete a poll'; end if;
    select conversation_id, created_by into conversation_id_value, creator_id from public.group_polls where id = p_poll_id;
    select group_role into role_value from public.conversation_members where conversation_id = conversation_id_value and user_id = auth.uid();
    if conversation_id_value is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if creator_id <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the poll author or a group admin can delete this poll'; end if;
    delete from public.group_polls where id = p_poll_id;
    return found;
  end;
  $$;

  create or replace function public.update_mtu_group_task(p_task_id uuid, p_title text, p_assignee_id uuid default null, p_due_at timestamptz default null)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare task_record public.group_tasks; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to edit a task'; end if;
    select * into task_record from public.group_tasks where id = p_task_id;
    select group_role into role_value from public.conversation_members where conversation_id = task_record.conversation_id and user_id = auth.uid();
    if task_record.id is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if task_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the task creator or a group admin can edit this task'; end if;
    if char_length(trim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'A task must be between 1 and 240 characters'; end if;
    if p_due_at is not null and p_due_at <= now() then raise exception 'Choose a future task deadline'; end if;
    if p_assignee_id is not null and not exists (select 1 from public.conversation_members where conversation_id = task_record.conversation_id and user_id = p_assignee_id) then raise exception 'Assign tasks only to current group members'; end if;
    update public.group_tasks set title = trim(p_title), assignee_id = p_assignee_id, due_at = p_due_at, updated_at = now() where id = p_task_id;
    return found;
  end;
  $$;

  create or replace function public.delete_mtu_group_task(p_task_id uuid)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare task_record public.group_tasks; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to delete a task'; end if;
    select * into task_record from public.group_tasks where id = p_task_id;
    select group_role into role_value from public.conversation_members where conversation_id = task_record.conversation_id and user_id = auth.uid();
    if task_record.id is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if task_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the task creator or a group admin can delete this task'; end if;
    delete from public.group_tasks where id = p_task_id;
    return found;
  end;
  $$;

  create or replace function public.update_mtu_group_event(p_event_id uuid, p_title text, p_description text default '', p_starts_at timestamptz default null, p_location text default '')
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare event_record public.group_events; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to edit an event'; end if;
    select * into event_record from public.group_events where id = p_event_id;
    select group_role into role_value from public.conversation_members where conversation_id = event_record.conversation_id and user_id = auth.uid();
    if event_record.id is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if event_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the event creator or a group admin can edit this event'; end if;
    if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future event time'; end if;
    update public.group_events set title = trim(p_title), description = trim(coalesce(p_description, '')), starts_at = p_starts_at, location = trim(coalesce(p_location, '')) where id = p_event_id;
    return found;
  end;
  $$;

  create or replace function public.delete_mtu_group_event(p_event_id uuid)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare event_record public.group_events; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to delete an event'; end if;
    select * into event_record from public.group_events where id = p_event_id;
    select group_role into role_value from public.conversation_members where conversation_id = event_record.conversation_id and user_id = auth.uid();
    if event_record.id is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if event_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the event creator or a group admin can delete this event'; end if;
    delete from public.group_events where id = p_event_id;
    return found;
  end;
  $$;

  create or replace function public.update_mtu_group_announcement(p_announcement_id uuid, p_title text, p_body text, p_expires_at timestamptz default null)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare announcement_record public.group_announcements; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to edit an announcement'; end if;
    select * into announcement_record from public.group_announcements where id = p_announcement_id;
    select group_role into role_value from public.conversation_members where conversation_id = announcement_record.conversation_id and user_id = auth.uid();
    if announcement_record.id is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if announcement_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the announcement author or a group admin can edit this announcement'; end if;
    if p_expires_at is not null and p_expires_at <= announcement_record.publish_at then raise exception 'Announcement expiry must be after publication'; end if;
    update public.group_announcements set title = trim(p_title), body = trim(p_body), expires_at = p_expires_at where id = p_announcement_id;
    return found;
  end;
  $$;

  create or replace function public.delete_mtu_group_announcement(p_announcement_id uuid)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public, auth
  as $$
  declare announcement_record public.group_announcements; role_value text;
  begin
    if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to delete an announcement'; end if;
    select * into announcement_record from public.group_announcements where id = p_announcement_id;
    select group_role into role_value from public.conversation_members where conversation_id = announcement_record.conversation_id and user_id = auth.uid();
    if announcement_record.id is null or role_value is null then raise exception 'You are not a member of this group'; end if;
    if announcement_record.created_by <> auth.uid() and role_value not in ('owner','admin') then raise exception 'Only the announcement author or a group admin can delete this announcement'; end if;
    delete from public.group_announcements where id = p_announcement_id;
    return found;
  end;
  $$;

  revoke execute on function public.update_mtu_group_poll(uuid,text,text[],timestamptz,boolean), public.close_mtu_group_poll(uuid), public.delete_mtu_group_poll(uuid), public.update_mtu_group_task(uuid,text,uuid,timestamptz), public.delete_mtu_group_task(uuid), public.update_mtu_group_event(uuid,text,text,timestamptz,text), public.delete_mtu_group_event(uuid), public.update_mtu_group_announcement(uuid,text,text,timestamptz), public.delete_mtu_group_announcement(uuid) from public, anon;
  grant execute on function public.update_mtu_group_poll(uuid,text,text[],timestamptz,boolean), public.close_mtu_group_poll(uuid), public.delete_mtu_group_poll(uuid), public.update_mtu_group_task(uuid,text,uuid,timestamptz), public.delete_mtu_group_task(uuid), public.update_mtu_group_event(uuid,text,text,timestamptz,text), public.delete_mtu_group_event(uuid), public.update_mtu_group_announcement(uuid,text,text,timestamptz), public.delete_mtu_group_announcement(uuid) to authenticated;

  do $$
  declare table_name text;
  begin
    foreach table_name in array array['group_polls','group_poll_options','group_poll_votes','group_tasks','group_events','group_event_attendees','group_announcements'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end;
  $$;
