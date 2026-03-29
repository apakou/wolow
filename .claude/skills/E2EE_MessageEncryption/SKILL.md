Description: Encrypts a plaintext message using a recipient's public key, preparing it for secure transmission.

• Purpose: To ensure message confidentiality before sending.

• Inputs: plaintextMessage (string), recipientPublicKey (JsonWebKey).

• Outputs: Base64 encoded encrypted message (string).

• Workflow:

1. Convert plaintextMessage to ArrayBuffer.

2. Use window.crypto.subtle.encrypt with RSA-OAEP and recipientPublicKey.

3. Convert the resulting ArrayBuffer to a base64 string.
