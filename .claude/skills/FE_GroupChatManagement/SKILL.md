Description: Develops the user interface and logic for creating and managing group chats.

• Purpose: To extend communication beyond one-on-one conversations.

• Inputs: existingUsersList (array of user objects), targetComponent (e.g., a new GroupChatCreationForm.tsx).

• Outputs: React component code for group chat creation and member selection.

• Workflow:

1. Create a form for group name and description.

2. Implement a multi-select component for adding members from existingUsersList.

3. Write logic to submit group creation data to a Supabase function or API route.
