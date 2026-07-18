-- 030: Give rooms.owner_token a server-side default.
--
-- The column is NOT NULL with no default (001), but the first-sign-in room
-- insert in /auth/callback does not provide a value, which violates the
-- constraint on a freshly-migrated database. A default makes room creation
-- safe regardless of the caller.
alter table rooms
  alter column owner_token set default gen_random_uuid()::text;
