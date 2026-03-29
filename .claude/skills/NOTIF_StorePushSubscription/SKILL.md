Description: Handles the server-side (or Supabase Edge Function) logic for securely storing a user's PushSubscription object in the database.

• Purpose: To persist push subscription details so that notifications can be sent to the correct endpoint later.

• Inputs: userId (string), pushSubscription (JSON object containing endpoint, keys.p256dh, keys.auth).

• Outputs: Confirmation of successful storage or error message.

• Workflow:

1. Receive userId and pushSubscription from the client.

2. Store these details in a dedicated Supabase table (e.g., user_push_subscriptions), linked to the userId.

3. Ensure appropriate RLS policies are in place for this table.
