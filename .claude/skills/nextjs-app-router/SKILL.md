* Server Components vs Client Components boundaries (`'use client'` directive)
* Route handlers in `app/api/` for room creation and any server logic
* Dynamic routes: `app/[slug]/page.tsx` for chat rooms
* Metadata generation for link previews (critical for a share-link app)
* `generateStaticParams` is NOT appropriate here (rooms are dynamic)
