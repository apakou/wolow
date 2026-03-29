Description: Develops a server-side function (e.g., Supabase Edge Function or Node.js backend) that triggers web push notifications to specific users based on application events.

• Purpose: To send notifications for new messages, mentions, or other relevant events.

• Inputs: recipientUserId (string), notificationPayload (JSON object with title, body, url, etc.), eventContext (e.g., messageId, roomId).

• Outputs: Confirmation of notification sent or error message.

• Workflow:

1. Fetch PushSubscription objects for recipientUserId from the database.

2. Construct the notification payload (e.g., encrypted message content, sender info).

3. Use a web push library (e.g., web-push npm package) to send the notification to each subscription endpoint.

4. Handle potential errors (e.g., expired subscriptions).
