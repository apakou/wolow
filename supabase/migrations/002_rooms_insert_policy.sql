-- Allow anyone to insert a new room.
-- Creation is rate-limited and validated at the API layer.
create policy "rooms_insert_anyone"
  on rooms for insert
  with check (true);
