Description: Implements real-time user presence (online/offline) and typing indicators using Supabase Realtime.

• Purpose: To enhance the interactive and dynamic feel of the chat experience.

• Inputs: chatRoomId (string), userId (string), targetComponents (e.g., ChatRoom.tsx, ChatView.tsx).

• Outputs: React component code for presence tracking and typing event handling.

• Workflow:

1. Subscribe to Supabase Realtime channel for chatRoomId.

2. Broadcast user presence status (online/offline).

3. Broadcast typing events when user types in input field.

4. Listen for presence and typing events from other users and update UI accordingly.
