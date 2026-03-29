Description: Manages the secure storage of private keys locally (e.g., IndexedDB) and uploads public keys to a designated Supabase table.

• Purpose: To persist cryptographic keys securely and make public keys discoverable by other users.

• Inputs: privateKey (JsonWebKey), publicKey (JsonWebKey), userId (string).

• Outputs: Confirmation of successful storage/upload or error message.

• Workflow:

1. Store privateKey in IndexedDB (or similar secure local storage) for the given userId.

2. Upload publicKey to the user_public_keys Supabase table, linking it to userId.
