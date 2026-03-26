-- ============================================================
-- 001_initial_schema.sql
-- ============================================================

-- ──────────────────────────────────────────
-- Tables
-- ──────────────────────────────────────────

create table rooms (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique,
  owner_token  text        not null,
  display_name text        not null default 'Anonymous',
  created_at   timestamptz not null default now()
);

create table messages (
  id         uuid        primary key default gen_random_uuid(),
  room_id    uuid        not null references rooms (id) on delete cascade,
  content    text        not null,
  is_owner   boolean     not null default false,
  created_at timestamptz not null default now(),

  constraint messages_content_length check (
    char_length(content) between 1 and 1000
  )
);

-- ──────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────

create index messages_room_id_created_at_idx on messages (room_id, created_at);
create index rooms_slug_idx                  on rooms (slug);

-- ──────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────

alter table rooms    enable row level security;
alter table messages enable row level security;

-- rooms: public read by slug
create policy "rooms_select_by_slug"
  on rooms for select
  using (true);

-- rooms: only the owner_token holder may update their own room.
-- The app must pass the token via a session variable:
--   select set_config('app.owner_token', '<token>', true);
-- before issuing the UPDATE.
create policy "rooms_update_owner_only"
  on rooms for update
  using (owner_token = current_setting('app.owner_token', true));

-- messages: anyone can read messages in any room
create policy "messages_select_all"
  on messages for select
  using (true);

-- messages: anyone may insert a non-owner message
create policy "messages_insert_anonymous"
  on messages for insert
  with check (is_owner = false);

-- messages: only the room owner may insert a message flagged is_owner=true.
-- The app must set app.owner_token before the insert (same as rooms update).
create policy "messages_insert_owner"
  on messages for insert
  with check (
    is_owner = true
    and exists (
      select 1
      from rooms r
      where r.id = room_id
        and r.owner_token = current_setting('app.owner_token', true)
    )
  );

-- ──────────────────────────────────────────
-- Realtime
-- ──────────────────────────────────────────

-- Add the messages table to the supabase_realtime publication so
-- clients can subscribe to new rows via Supabase Realtime channels.
alter publication supabase_realtime add table messages;
