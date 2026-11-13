-- Immersa schema. Paste into Supabase > SQL Editor > Run. Safe to re-run.

-- A room is a named scan: `data` is our RoomScan JSON (the planes). Many rooms per user.
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Room',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Creation date of a room (older rooms get their last update as an approximation; safe to re-run).
alter table public.rooms add column if not exists created_at timestamptz;
update public.rooms set created_at = updated_at where created_at is null;
alter table public.rooms alter column created_at set default now();
alter table public.rooms alter column created_at set not null;

-- The scan replaced by the last automatic update (one backup).
alter table public.rooms add column if not exists previous_data jsonb;

-- The place a room belongs to (a house, a site): rooms of one place can be put in the same project and know where the others are.
alter table public.rooms add column if not exists place text;

alter table public.rooms enable row level security;

drop policy if exists "rooms: owner only" on public.rooms;
create policy "rooms: owner only" on public.rooms
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- A project = a named set of models placed in one or more rooms (e.g. a whole house).
-- room_ids lists its rooms (JSON array of room ids); room_id is just the first one.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  room_ids jsonb not null default '[]'::jsonb,
  name text not null,
  models jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists projects_room_idx on public.projects (room_id);

alter table public.projects enable row level security;

drop policy if exists "projects: owner only" on public.projects;
create policy "projects: owner only" on public.projects
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Walls and floors built in the PC editor (JSON list of structures; safe to re-run).
alter table public.projects add column if not exists structures jsonb not null default '[]'::jsonb;

-- Notes and rulers left in a project (JSON list of annotations; safe to re-run).
alter table public.projects add column if not exists annotations jsonb not null default '[]'::jsonb;

-- Migration to multi-room projects (safe to re-run).
-- The tile colour of each project (safe to re-run).
alter table public.projects add column if not exists tone smallint;

alter table public.projects add column if not exists room_ids jsonb not null default '[]'::jsonb;
update public.projects set room_ids = jsonb_build_array(room_id::text) where room_ids = '[]'::jsonb and room_id is not null;
alter table public.projects alter column room_id drop not null;
alter table public.projects drop constraint if exists projects_room_id_fkey;
alter table public.projects
  add constraint projects_room_id_fkey foreign key (room_id) references public.rooms (id) on delete set null;

-- Migration from the first single-room format (models used to live inside rooms.data).
insert into public.projects (owner, room_id, name, models)
select r.owner, r.id, 'Progetto importato', r.data -> 'models'
from public.rooms r
where jsonb_typeof(r.data -> 'models') = 'array'
  and jsonb_array_length(r.data -> 'models') > 0
  and not exists (select 1 from public.projects p where p.room_id = r.id);

update public.rooms
set data = data - 'models' - 'items',
    name = case when name = 'Room' then 'Stanza importata' else name end
where data ? 'models' or data ? 'items';

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

-- Codes that sign a headset in after the user approves them on the PC (used by the Edge Function "link-device", see
-- supabase/functions/link-device). Row level security without policies: only the function (service role) can read or write.
create table if not exists public.device_links (
  code text primary key,
  secret_hash text not null,
  token_hash text,
  user_id uuid references auth.users on delete cascade,
  expires_at timestamptz not null
);
alter table public.device_links add column if not exists ip text; -- the public address the headset asked from (the PC lists the requests from its own)
alter table public.device_links enable row level security;

-- Wrong codes typed by a user: after a few the function stops that user for a while (same rules: no policies, service role only).
create table if not exists public.device_link_failures (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
alter table public.device_link_failures enable row level security;

-- Reports sent from the headset (Account -> "Invia segnalazione"): the event log and a few facts about the session, to find out what
-- went wrong at a customer's. A user can only ADD rows for himself (nobody can read them back through the API: read them in the
-- dashboard's table editor, or with the service role).
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  app_version text,
  device text,
  note text,
  payload jsonb,
  constraint reports_size check (octet_length(coalesce(note, '')) <= 2000 and pg_column_size(payload) <= 300000)
);
alter table public.reports enable row level security;
drop policy if exists "reports: insert own" on public.reports;
create policy "reports: insert own" on public.reports for insert to authenticated with check (user_id = (select auth.uid()));

-- Make the API see the new tables right away.
notify pgrst, 'reload schema';
