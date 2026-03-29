Description: Decrypts an encrypted message using the user's private key.

• Purpose: To restore the original plaintext message for the intended recipient.

• Inputs: encryptedMessageBase64 (string), userPrivateKey (JsonWebKey).

• Outputs: Original plaintext message (string).

• Workflow:

1. Convert encryptedMessageBase64 from base64 string to ArrayBuffer.

2. Use window.crypto.subtle.decrypt with RSA-OAEP and userPrivateKey.

3. Convert the resulting ArrayBuffer to a UTF-8 string.
