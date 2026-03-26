* Data model: `rooms(id, slug, owner_token, created_at)`, `messages(id, room_id, content, is_owner, created_at)`
* Room access pattern: slug in URL = read/write for anonymous, owner_token in cookie = can reply
* Message flow: insert to Supabase → realtime broadcast → UI update
* Rate limiting rules (messages per minute per IP/session)
* Content validation: max length, sanitization, no HTML
