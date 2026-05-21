![Pause Father](public/pause-father.png)

# The Pausefather

The Pausefather fixes a real problem in voice AI: voices are great at speaking,
but bad at leaving space for people to think, answer, move, write, search,
choose, calculate, or act.

It turns silence from dead air into an intentional design layer.

Creators can reshape the timing of spoken experiences so listeners have room to
actually do what the voice asks.

Built for the ElevenLabs V3 workflow and monetized with Stripe, it is both a
production technique for real voice products and a focused tool people can pay
for when timing matters.

## Getting Started

Create `.env.local` with the existing Clerk/Stripe values plus these values if
you want per-user provider key storage:

```bash
DATABASE_URL="postgresql://..."
KEY_ENCRYPTION_SECRET="generate-a-long-random-secret"
```

The app creates the `user_provider_keys` table on first use. The same schema is
also available at `db/migrations/001_user_provider_keys.sql` if you prefer to
run migrations explicitly in Neon.

For local development without Vercel Blob, add:

```bash
NEXT_PUBLIC_AUDIO_UPLOAD_MODE="direct"
```

Production should omit that value, or set it to `blob`, so browser uploads go
through Vercel Blob before transcription.

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

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
