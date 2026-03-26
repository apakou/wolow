-- ============================================================
-- 007_enforce_single_reaction_per_actor.sql
-- Ensures each actor type (owner or sender) can have only one
-- emoji reaction per message.
-- ============================================================

with ranked_reactions as (
  select
    id,
    row_number() over (
      partition by message_id, is_owner
      order by created_at desc, id desc
    ) as row_num
  from reactions
)
delete from reactions r
using ranked_reactions rr
where r.id = rr.id
  and rr.row_num > 1;

alter table reactions
  drop constraint if exists reactions_unique;

alter table reactions
  add constraint reactions_message_actor_unique unique (message_id, is_owner);