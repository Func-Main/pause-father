import { auth } from "@clerk/nextjs/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  AUDIO_UPLOAD_CONTENT_TYPES,
  MAX_AUDIO_UPLOAD_BYTES,
} from "@/lib/audio-limits";

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Sign in to upload audio." }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [...AUDIO_UPLOAD_CONTENT_TYPES],
          maximumSizeInBytes: MAX_AUDIO_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId }),
        };
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Audio upload could not be prepared.",
      },
      { status: 400 },
    );
  }
}
