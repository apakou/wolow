## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes -- don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -- then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to tasks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to tasks/todo.md
6. **Capture Lessons**: Update tasks/lessons.md after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Only touch what's necessary. No side effects with new bugs.

## Security

### Never Do
- Expose secrets, API keys, or credentials in code, logs, or error messages
- Commit `.env` files or any file containing secrets
- Trust user-supplied input without validation/sanitization
- Use `eval()`, `exec()`, or dynamic code execution on user input
- Build SQL/shell commands via string concatenation (use parameterized queries / `execFile`)
- Disable security headers, CORS restrictions, or CSRF protection
- Store passwords in plaintext — always hash with bcrypt/argon2
- Use `dangerouslySetInnerHTML` or equivalent without explicit sanitization

### Always Do
- Validate and sanitize all input at system boundaries (forms, APIs, query params)
- Use HTTPS and enforce `Strict-Transport-Security`
- Set security headers: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`
- Apply least-privilege: only request/grant permissions actually needed
- Keep dependencies up to date; audit with `npm audit` before shipping
- Rate-limit authentication endpoints and sensitive mutations
- Log security-relevant events (auth failures, permission denials) without leaking PII

### OWASP Top 10 Watchlist
- **Injection**: parameterize every query and shell call
- **Broken Auth**: enforce session expiry, rotate tokens, invalidate on logout
- **XSS**: escape output; use CSP; avoid raw HTML injection
- **IDOR**: authorize every resource access by the requesting user, not just by ID
- **Security Misconfiguration**: remove debug endpoints and default credentials before deploy
- **Vulnerable Dependencies**: flag any `npm audit` high/critical finding before marking a task done
