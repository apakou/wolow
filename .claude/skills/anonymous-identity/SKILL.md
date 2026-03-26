* Room owner: `crypto.randomUUID()` token stored in httpOnly cookie on room creation
* Anonymous sender: no identity needed, just rate-limit by IP/fingerprint
* Never expose owner tokens in URLs or client-side JS
* Session cookie settings: `httpOnly`, `secure`, `sameSite: 'lax'`, short-lived
