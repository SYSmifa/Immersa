-- Immersa schema. Paste into Supabase > SQL Editor > Run. Safe to re-run.

-- One row per room: `data` is our RoomFile JSON (planes, items, model placement).
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Room',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

drop policy if exists "rooms: owner only" on public.rooms;
create policy "rooms: owner only" on public.rooms
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Private bucket for 3D models; each user only touches files under "<user id>/".
insert into storage.buckets (id, name, public)
values ('models', 'models', false)
on conflict (id) do nothing;

drop policy if exists "models: owner read" on storage.objects;
create policy "models: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'models' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "models: owner insert" on storage.objects;
create policy "models: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'models' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "models: owner update" on storage.objects;
create policy "models: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'models' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "models: owner delete" on storage.objects;
create policy "models: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'models' and (storage.foldername(name))[1] = (select auth.uid())::text);
