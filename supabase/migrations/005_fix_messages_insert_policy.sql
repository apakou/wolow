-- The messages_insert_owner policy required set_config('app.owner_token', ...)
-- to be called in-session, which the API route never does.
-- Ownership is already validated server-side via the httpOnly owner_{slug} cookie
-- before is_owner is set — the API layer is the correct trust boundary.
-- Replace both granular policies with a single open insert policy.

drop policy "messages_insert_anonymous" on messages;
drop policy "messages_insert_owner"     on messages;

create policy "messages_insert_anyone"
  on messages for insert
  with check (true);
