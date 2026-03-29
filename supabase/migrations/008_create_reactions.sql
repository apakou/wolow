-- ============================================================
-- 008_create_reactions.sql
-- Creates the reactions table for emoji reactions on messages.
-- ============================================================

create table reactions (
  id         uuid        primary key default gen_random_uuid(),
  message_id uuid        not null references messages (id) on delete cascade,
  emoji      text        not null,
  is_owner   boolean     not null default false,
  created_at timestamptz not null default now()
);

create index reactions_message_id_idx on reactions (message_id);

alter table reactions enable row level security;

-- Anyone can read reactions
create policy "reactions_select_all"
  on reactions for select
  using (true);

-- Anyone can insert reactions (auth checked in API layer)
create policy "reactions_insert_all"
  on reactions for insert
  with check (true);

-- Anyone can delete reactions (auth checked in API layer)
create policy "reactions_delete_all"
  on reactions for delete
  using (true);

-- Add reactions to realtime
alter publication supabase_realtime add table reactions;
