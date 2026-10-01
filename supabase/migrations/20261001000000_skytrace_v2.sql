-- SkyTrace V2 schema — Supabase PostgreSQL with Row Level Security.
-- Users can read/write only their own rows. Public reference data is read-only.
-- Never stored: satellite positions per second, computed trajectories, camera frames,
-- continuous location, orientation history.

create extension if not exists "pgcrypto";

-- ───────────── users (profile mirror of auth.users) ─────────────
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text check (char_length(display_name) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── saved satellites ─────────────
create table if not exists public.saved_satellites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  norad_id integer not null check (norad_id > 0),
  satellite_name text not null check (char_length(satellite_name) between 1 and 64),
  alerts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists saved_satellites_user on public.saved_satellites (user_id, updated_at);

-- ───────────── saved locations (always explicit, optional) ─────────────
create table if not exists public.saved_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  altitude double precision not null default 0 check (altitude between -500 and 9000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists saved_locations_user on public.saved_locations (user_id, updated_at);

-- ───────────── observation history ─────────────
create table if not exists public.observation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  norad_id integer not null check (norad_id > 0),
  satellite_name text check (char_length(satellite_name) <= 64),
  observed_at timestamptz not null,
  latitude double precision check (latitude between -90 and 90),     -- null unless the user opted in
  longitude double precision check (longitude between -180 and 180),
  azimuth double precision not null check (azimuth >= 0 and azimuth < 360),
  elevation double precision not null check (elevation between -90 and 90),
  match_confidence text not null check (match_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  notes text check (char_length(notes) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists observation_history_user on public.observation_history (user_id, updated_at);

-- ───────────── trace history ─────────────
create table if not exists public.trace_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trace_id text not null check (char_length(trace_id) <= 64),
  trace_time timestamptz not null,
  latitude double precision check (latitude between -90 and 90),     -- optional
  longitude double precision check (longitude between -180 and 180),
  target_azimuth double precision not null check (target_azimuth >= 0 and target_azimuth < 360),
  target_elevation double precision not null check (target_elevation between -90 and 90),
  field_radius double precision not null check (field_radius between 0.5 and 30),
  time_window integer not null check (time_window between 1 and 1440),
  match_count integer not null default 0 check (match_count >= 0),
  selected_norad_id integer,
  sensor_accuracy double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists trace_history_user on public.trace_history (user_id, updated_at);

-- ───────────── pass alerts ─────────────
create table if not exists public.pass_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  norad_id integer not null check (norad_id > 0),
  satellite_name text check (char_length(satellite_name) <= 64),
  location_id uuid references public.saved_locations (id) on delete set null,
  minimum_elevation double precision not null default 10 check (minimum_elevation between 0 and 80),
  visibility_only boolean not null default true,
  notify_minutes_before integer not null default 10 check (notify_minutes_before in (5, 10, 15, 30)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists pass_alerts_user on public.pass_alerts (user_id, updated_at);
create index if not exists pass_alerts_enabled on public.pass_alerts (enabled) where enabled and not deleted;

-- ───────────── notification preferences (one row per user) ─────────────
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  push_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  visible_pass_only boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── web push subscriptions (written only by the Edge Function) ─────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null,
  auth text not null,
  timezone text,
  created_at timestamptz not null default now()
);

-- sent alerts (dedupe) + simple rate limiting for server functions
create table if not exists public.sent_alerts (
  key text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);
create table if not exists public.function_calls (
  user_id uuid not null,
  fn text not null,
  called_at timestamptz not null default now()
);
create index if not exists function_calls_recent on public.function_calls (user_id, fn, called_at);

-- ───────────── public reference data (read-only for clients) ─────────────
create table if not exists public.satellite_metadata (
  norad_id integer primary key,
  name text not null,
  object_type text,
  owner text,
  launch_date date,
  category text,
  updated_at timestamptz not null default now()
);

create table if not exists public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_name text not null,
  version text not null,
  source text,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (dataset_name, version)
);

-- ───────────── updated_at maintenance ─────────────
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  -- keep client timestamps for sync (last-write-wins), but never accept the future
  if new.updated_at is null or new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['users','saved_satellites','saved_locations','observation_history','trace_history','pass_alerts','notification_preferences'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ───────────── Row Level Security ─────────────
alter table public.users enable row level security;
alter table public.saved_satellites enable row level security;
alter table public.saved_locations enable row level security;
alter table public.observation_history enable row level security;
alter table public.trace_history enable row level security;
alter table public.pass_alerts enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.sent_alerts enable row level security;
alter table public.function_calls enable row level security;
alter table public.satellite_metadata enable row level security;
alter table public.dataset_versions enable row level security;

-- own rows only
create policy "users: own profile" on public.users for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['saved_satellites','saved_locations','observation_history','trace_history','pass_alerts','notification_preferences'] loop
    execute format('drop policy if exists "%1$s: own rows" on public.%1$s', t);
    execute format('create policy "%1$s: own rows" on public.%1$s for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- push subscriptions: users may see/delete their own; inserts go through the Edge Function (service role)
create policy "push_subscriptions: read own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "push_subscriptions: delete own" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
-- sent_alerts / function_calls: no client policies (service role only)

-- public satellite metadata & dataset versions: read-only for everyone
create policy "satellite_metadata: public read" on public.satellite_metadata for select to anon, authenticated using (true);
create policy "dataset_versions: public read" on public.dataset_versions for select to anon, authenticated using (true);

-- seed: bundled star catalogue version
insert into public.dataset_versions (dataset_name, version, source)
values ('stars', 'stars-2026.10-1', 'Hipparcos via d3-celestial (BSD-3-Clause)')
on conflict do nothing;

-- ───────────── scheduled pass-alert dispatch (every 5 minutes) ─────────────
-- Requires the pg_cron + pg_net extensions and two secrets in Vault:
--   project_url  (https://<ref>.supabase.co)   cron_secret (same value as the CRON_SECRET function secret)
-- select cron.schedule('skytrace-pass-alerts', '*/5 * * * *', $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-pass-alerts',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
--     body := '{}'::jsonb);
-- $$);
