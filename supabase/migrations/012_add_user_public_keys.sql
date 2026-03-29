-- user_public_keys: stores each user's E2EE public key (one key per user)
create table if not exists user_public_keys (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  public_key jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast lookup by user_id (unique constraint already creates one,
-- but explicit for clarity)
comment on table user_public_keys is 'Stores one E2EE RSA-OAEP public key per authenticated user';

-- Enable RLS
alter table user_public_keys enable row level security;

-- Anyone can read public keys (they're public by definition)
create policy "user_public_keys_select_all"
  on user_public_keys for select
  using (true);

-- Users can only insert their own key
create policy "user_public_keys_insert_own"
  on user_public_keys for insert
  with check (auth.uid() = user_id);

-- Users can only update their own key
create policy "user_public_keys_update_own"
  on user_public_keys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can only delete their own key
create policy "user_public_keys_delete_own"
  on user_public_keys for delete
  using (auth.uid() = user_id);

-- Auto-update the updated_at timestamp
create or replace function update_user_public_keys_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_public_keys_updated_at
  before update on user_public_keys
  for each row
  execute function update_user_public_keys_updated_at();
