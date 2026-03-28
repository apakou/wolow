Description: Generates an asymmetric cryptographic key pair (public and private keys) suitable for RSA-OAEP encryption/decryption using the Web Crypto API.

• Purpose: To establish the foundational cryptographic keys for E2EE communication.

• Inputs: None (or optional key parameters like modulusLength, publicExponent).

• Outputs: A JavaScript object containing the generated CryptoKeyPair (with publicKey and privateKey in JsonWebKey format).

• Workflow: Call window.crypto.subtle.generateKey with appropriate parameters for RSA-OAEP.
