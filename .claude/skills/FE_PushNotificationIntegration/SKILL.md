Description: Sets up web push notifications for new messages in a React application.

• Purpose: To keep users engaged by notifying them of new messages even when inactive.

• Inputs: vapidPublicKey (string), backendEndpoint (URL for subscription storage).

• Outputs: Client-side JavaScript for service worker registration and push subscription.

• Workflow:

1. Register a service worker.

2. Request notification permission.

3. Subscribe to push notifications using PushManager.subscribe.

4. Send the PushSubscription object to backendEndpoint for storage.
