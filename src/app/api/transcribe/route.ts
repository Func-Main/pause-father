import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Transcript } from "@autopauser/engine-js";
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

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload an audio file." }, { status: 400 });
  }

  const upstreamFormData = new FormData();
  upstreamFormData.set("file", file);
  upstreamFormData.set("model_id", "scribe_v2");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: upstreamFormData,
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "ElevenLabs could not transcribe this audio." },
      { status: response.status },
    );
  }

  const body = (await response.json()) as ElevenLabsTranscript;
  const transcript = elevenLabsToTranscript(body);

  if (transcript.words.length === 0) {
    return NextResponse.json(
      { error: "No timestamped words were returned for this audio." },
      { status: 422 },
    );
  }

  return NextResponse.json({ transcript });
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

