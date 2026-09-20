create table if not exists public.convo_vault_notebooks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notebook_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.convo_vault_notebooks enable row level security;

revoke all on table public.convo_vault_notebooks from public, anon;
grant select, insert on table public.convo_vault_notebooks to authenticated;

drop policy if exists "Users can read their own Vault notebook" on public.convo_vault_notebooks;
create policy "Users can read their own Vault notebook"
  on public.convo_vault_notebooks for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own Vault notebook" on public.convo_vault_notebooks;
create policy "Users can create their own Vault notebook"
  on public.convo_vault_notebooks for insert to authenticated
  with check (auth.uid() = user_id);
