Description: Implements functionality for users to upload media files to Supabase Storage and display them in the chat interface.

• Purpose: To enable sharing of images, videos, and other files within conversations.

• Inputs: fileType (e.g., image, video), targetComponent (e.g., ChatRoom.tsx, ChatView.tsx).

• Outputs: React component code for file input, upload logic, and display logic.

• Workflow:

1. Create file input element.

2. Write function to upload selected file to Supabase Storage, retrieve public URL.

3. Modify message display component to render media based on URL.
