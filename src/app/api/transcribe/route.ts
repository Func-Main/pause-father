import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import type { Transcript } from "@autopauser/engine-js";
import {
  formatUploadLimit,
  isAllowedAudioFile,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_TRANSCRIPT_WORDS,
} from "@/lib/audio-limits";
import { getDecryptedProviderApiKey } from "@/lib/user-provider-keys/repository";

type ElevenLabsWord = {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  type?: unknown;
};

type ElevenLabsTranscript = {
  text?: unknown;
  words?: unknown;
};

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Sign in to transcribe audio." }, { status: 401 });
  }

  const apiKey = await getDecryptedProviderApiKey({
    clerkUserId: userId,
    provider: "elevenlabs",
  });

  if (!apiKey) {
    return NextResponse.json(
      { error: "Add an ElevenLabs API key before uploading audio." },
      { status: 400 },
    );
  }

  const upload = await transcribeUploadFromRequest(request);

  if (!upload) {
    return NextResponse.json({ error: "Upload an audio file." }, { status: 400 });
  }

  const validationError = validateAudioUpload(upload.file);
  if (validationError) {
    if (upload.blobUrl) {
      await deleteUploadedBlob(upload.blobUrl);
    }
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const upstreamFormData = new FormData();
  upstreamFormData.set("file", upload.file);
  upstreamFormData.set("model_id", "scribe_v2");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: upstreamFormData,
  });

  if (!response.ok) {
    if (upload.blobUrl) {
      await deleteUploadedBlob(upload.blobUrl);
    }
    const detail = await elevenLabsErrorDetail(response);
    return NextResponse.json(
      {
        error: [
          "ElevenLabs could not transcribe this audio.",
          detail,
        ].filter(Boolean).join(" "),
      },
      { status: response.status },
    );
  }

  const body = (await response.json()) as ElevenLabsTranscript;
  const transcript = elevenLabsToTranscript(body);

  if (upload.blobUrl) {
    await deleteUploadedBlob(upload.blobUrl);
  }

  if (transcript.words.length === 0) {
    return NextResponse.json(
      { error: "No timestamped words were returned for this audio." },
      { status: 422 },
    );
  }

  if (transcript.words.length > MAX_TRANSCRIPT_WORDS) {
    return NextResponse.json(
      {
        error: `This transcript is ${transcript.words.length.toLocaleString()} words. Upload audio with ${MAX_TRANSCRIPT_WORDS.toLocaleString()} words or fewer.`,
      },
      { status: 413 },
    );
  }

  return NextResponse.json({ transcript });
}

async function transcribeUploadFromRequest(
  request: Request,
): Promise<{ file: File; blobUrl?: string } | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    return file instanceof File ? { file } : null;
  }

  const { blobUrl, fileName } = (await request.json()) as {
    blobUrl?: unknown;
    fileName?: unknown;
  };

  if (typeof blobUrl !== "string") {
    return null;
  }

  const blob = await get(blobUrl, { access: "private" });

  if (!blob?.stream) {
    return null;
  }

  const audioBlob = await new Response(blob.stream).blob();

  return {
    blobUrl,
    file: new File(
      [audioBlob],
      typeof fileName === "string" ? fileName : "audio-upload",
      {
        type: blob.blob.contentType ?? audioBlob.type,
      },
    ),
  };
}

function validateAudioUpload(file: File): string | null {
  if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
    return `Upload audio files up to ${formatUploadLimit()}.`;
  }

  if (!isAllowedAudioFile(file)) {
    return "Upload a supported audio file: MP3, M4A, WAV, WebM, Ogg, AAC, or FLAC.";
  }

  return null;
}

async function deleteUploadedBlob(blobUrl: string) {
  await del(blobUrl).catch((error) => {
    console.error("Failed to delete uploaded audio blob", error);
  });
}

async function elevenLabsErrorDetail(response: Response): Promise<string> {
  const fallback = `Status ${response.status}. Check your API key, STT permissions, usage limits, and audio format.`;

  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const detail = errorText(body.detail) ?? errorText(body.message) ?? errorText(body.error);
    return detail ? `ElevenLabs said: ${detail}` : fallback;
  } catch {
    return fallback;
  }
}

function errorText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  return null;
}

function elevenLabsToTranscript(body: ElevenLabsTranscript): Transcript {
  const words = Array.isArray(body.words)
    ? body.words.flatMap((word, index) => normalizeWord(word, index))
    : [];
  const duration = words.reduce((max, word) => Math.max(max, word.end), 0);
  const text =
    typeof body.text === "string"
      ? body.text
      : words.map((word) => word.word).join(" ");

  return {
    task: "transcribe",
    source: "elevenlabs",
    duration,
    text,
    segments: [
      {
        id: 0,
        start: words[0]?.start ?? 0,
        end: duration,
        text,
      },
    ],
    words,
  };
}

function normalizeWord(word: unknown, index: number): Transcript["words"] {
  const candidate = word as ElevenLabsWord;

  if (
    typeof candidate.text !== "string" ||
    typeof candidate.start !== "number" ||
    typeof candidate.end !== "number" ||
    candidate.type === "spacing"
  ) {
    return [];
  }

  return [
    {
      index,
      word: candidate.text,
      start: candidate.start,
      end: candidate.end,
    },
  ];
}
