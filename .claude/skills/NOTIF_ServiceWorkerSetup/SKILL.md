Description: Creates and configures the service-worker.js file for a React/Next.js application, including handling push events and displaying notifications.

• Purpose: To enable background processing for push notifications and display them to the user.

• Inputs: appName (string), iconUrl (URL for notification icon).

• Outputs: service-worker.js file content.

• Workflow:

1. Create a basic service-worker.js file.

2. Add an event listener for push events.

3. Within the push event, parse the notification payload.

4. Use self.registration.showNotification to display the notification with appName, iconUrl, and payload data.

5. Add an event listener for notificationclick to handle user interaction with the notification.
