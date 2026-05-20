# Vercel User Uploads Plan

## Goal

Let users upload narration audio in the hosted Vercel app, then run the same auto-pausing flow against that uploaded file.

The hosted app should not send large audio files through ordinary Next.js API routes or Server Actions. Vercel Functions have a small request body limit, so production uploads need object storage.

## Constraints

- Vercel Functions have a 4.5 MB request and response payload limit.
- Narration audio can easily exceed that size.
- Local browser-only previews are fine for the current proof of concept, but transcription, durable projects, and server-side rendering need a persistent file URL.
- User uploads should not be stored in the app filesystem. Vercel deployments are not a durable file store.

## Recommended Architecture

Use Vercel Blob client uploads.

1. The browser requests permission to upload a specific audio file.
2. The browser uploads the file directly to Vercel Blob.
3. The app stores the returned Blob URL and metadata.
4. Transcription and render jobs read the audio from Blob.
5. Rendered output is written back to Blob for playback and download.

This keeps large audio bytes out of Vercel Function request bodies.

## Implementation Steps

1. Add Vercel Blob
   - Install `@vercel/blob` in `apps/web`.
   - Create a Blob store in Vercel and connect it to the project environments.
   - Add local development env vars for the Blob token.

2. Add an upload token route
   - Create a server endpoint for `handleUpload`.
   - Restrict uploads to audio MIME types.
   - Set a maximum file size appropriate for the MVP.
   - Use user identity when available to namespace uploads.

3. Replace local-only upload state
   - Keep local object URLs for instant preview while upload is pending.
   - After upload completes, store the Blob URL in editor state.
   - Show upload progress and failure states.

4. Add durable project metadata
   - Store at least: user id, original filename, Blob URL, size, MIME type, created timestamp, transcript URL, pause plan URL, rendered audio URL.
   - For the first pass, this can be a simple database table once we choose the app database.

5. Move server work to Blob URLs
   - Transcription should read the source audio from Blob.
   - Pause analysis should store `transcript.json` and `pauses.json`.
   - Rendering should read the source audio plus pause plan and write the final audio back to Blob.

6. Add cleanup policy
   - Decide whether free users' uploads expire.
   - Delete orphaned blobs if upload succeeds but project creation fails.
   - Give users a way to delete uploaded files.

## MVP Behavior

- Demo content remains available as a separate proof-of-concept launcher.
- Uploading a real file creates a Blob-backed source audio asset.
- The UI can keep offering immediate local preview, but the durable project should reference Blob.
- Auto time should run after upload only when the transcript/render pipeline is ready for uploaded files.

## Open Decisions

- Maximum upload size for the first hosted MVP.
- Whether uploads require sign-in.
- Whether rendered audio is public, private, or signed URL only.
- Which database stores project metadata.
- Whether long-running transcription/rendering runs inside Vercel Functions, Vercel Queues/Workflow, or a separate worker.

## References

- Vercel Functions payload limit: https://vercel.com/docs/functions/limitations
- Vercel Blob client uploads: https://vercel.com/docs/vercel-blob/client-upload
- Vercel Blob server uploads: https://vercel.com/docs/vercel-blob/server-upload
