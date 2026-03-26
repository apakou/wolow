-- ============================================================
-- 002_add_conversations.sql
-- Adds per-sender conversation threads so each anonymous
-- visitor has a private 1-on-1 chat with the room owner.
-- ============================================================

-- ──────────────────────────────────────────
-- New table: conversations
-- ──────────────────────────────────────────

create table conversations (
  id           uuid        primary key default gen_random_uuid(),
  room_id      uuid        not null references rooms (id) on delete cascade,
  sender_token text        not null,
  created_at   timestamptz not null default now(),

  -- One conversation per sender per room
  constraint conversations_room_sender_unique unique (room_id, sender_token)
);

create index conversations_room_id_idx on conversations (room_id);

-- ──────────────────────────────────────────
-- Alter messages: link to conversation
-- ──────────────────────────────────────────

alter table messages
  add column conversation_id uuid references conversations (id) on delete cascade;

create index messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at);

-- ──────────────────────────────────────────
-- RLS for conversations
-- ──────────────────────────────────────────

alter table conversations enable row level security;

-- Anyone can read conversations (owner inbox needs to list them)
create policy "conversations_select_all"
  on conversations for select
  using (true);

-- Anyone can insert a conversation (anonymous sender auto-creates on first message)
create policy "conversations_insert_all"
  on conversations for insert
  with check (true);

-- ──────────────────────────────────────────
-- Realtime: add conversations table
-- ──────────────────────────────────────────

alter publication supabase_realtime add table conversations;
