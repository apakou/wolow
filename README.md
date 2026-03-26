This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Database Migrations

Migrations live in `supabase/migrations/`. They are plain SQL files and are applied in filename order.

### Prerequisites

Install the Supabase CLI (if you haven't already):

```bash
npm install -g supabase
# or via Homebrew
brew install supabase/tap/supabase
```

### Running migrations against your hosted project

```bash
# 1. Link to your Supabase project (one-time setup)
supabase link --project-ref <your-project-ref>

# 2. Push all pending migrations
supabase db push
```

`supabase db push` applies every file in `supabase/migrations/` that hasn't been recorded in the remote migration history yet.

### Running migrations locally (with Docker)

```bash
# Start a local Supabase stack
supabase start

# Apply migrations
supabase db push --local
```

### What `001_initial_schema.sql` creates

| Object | Description |
|---|---|
| `rooms` | One row per chat room; `slug` is the public URL key, `owner_token` is a secret used to authorize owner actions |
| `messages` | All chat messages; `is_owner` flags messages from the room creator |
| `messages_room_id_created_at_idx` | Fast chronological message fetches per room |
| `rooms_slug_idx` | Fast room lookups by slug |
| RLS on `rooms` | Public SELECT; UPDATE guarded by `app.owner_token` session variable |
| RLS on `messages` | Public SELECT & anonymous INSERT; owner INSERT guarded by `app.owner_token` |
| Realtime publication | `messages` added to `supabase_realtime` for live subscriptions |

> **Owner token pattern:** before any privileged write, call
> `select set_config('app.owner_token', '<token>', true)` in the same transaction
> so the RLS policies can verify the caller is the room owner.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
