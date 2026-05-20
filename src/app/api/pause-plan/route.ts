import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Pause, Transcript } from "@autopauser/engine-js";
import { getDecryptedProviderApiKey } from "@/lib/user-provider-keys/repository";

type PausePlanResponse = {
  pauses?: unknown;
};

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Sign in to auto time audio." }, { status: 401 });
  }

  const apiKey = await getDecryptedProviderApiKey({
    clerkUserId: userId,
    provider: "openai",
  });

  if (!apiKey) {
    return NextResponse.json(
      { error: "Add an OpenAI API key before auto timing audio." },
      { status: 400 },
    );
  }

  const { transcript } = (await request.json()) as { transcript?: Transcript };

  if (!transcript || !Array.isArray(transcript.words)) {
    return NextResponse.json({ error: "Missing transcript." }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_PAUSE_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You find places in narrated audio where silence should be inserted so the listener can think, answer, move, speak, write, search, choose, calculate, or act. Return only pauses that materially improve usability.",
        },
        {
          role: "user",
          content: JSON.stringify({
            transcript_text: transcript.text,
            words: transcript.words.map((word, fallbackIndex) => ({
              index: typeof word.index === "number" ? word.index : fallbackIndex,
              word: word.word,
              start: word.start,
              end: word.end,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pause_plan",
          strict: true,
          schema: pausePlanSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "OpenAI could not generate an auto timing plan." },
      { status: response.status },
    );
  }

  const body = await response.json();
  const parsed = parseOpenAiJson(body) as PausePlanResponse;
  const pauses = normalizePauses(parsed, transcript);

  return NextResponse.json({ pauses });
}

const pausePlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pauses"],
  properties: {
    pauses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "after_word_index",
          "pause_type",
          "duration_ms",
          "reason",
        ],
        properties: {
          after_word_index: { type: "integer" },
          pause_type: {
            type: "string",
            enum: ["micro", "beat", "section_break", "thinking", "interaction"],
          },
          duration_ms: { type: "integer", minimum: 300, maximum: 12000 },
          reason: { type: "string" },
        },
      },
    },
  },
};

function parseOpenAiJson(body: unknown): unknown {
  const response = body as { output_text?: unknown; output?: unknown };

  if (typeof response.output_text === "string") {
    return JSON.parse(response.output_text);
  }

  if (Array.isArray(response.output)) {
    for (const output of response.output) {
      const content = (output as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const item of content) {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string") {
          return JSON.parse(text);
        }
      }
    }
  }

  throw new Error("OpenAI response did not include JSON output.");
}

function normalizePauses(plan: PausePlanResponse, transcript: Transcript): Pause[] {
  if (!Array.isArray(plan.pauses)) {
    return [];
  }

  return plan.pauses.flatMap((pause) => {
    const candidate = pause as Partial<Pause>;
    const afterWordIndex = candidate.after_word_index;
    const word = transcript.words.find(
      (transcriptWord, fallbackIndex) =>
        (transcriptWord.index ?? fallbackIndex) === afterWordIndex,
    );

    if (
      typeof afterWordIndex !== "number" ||
      !word ||
      typeof candidate.duration_ms !== "number" ||
      typeof candidate.pause_type !== "string"
    ) {
      return [];
    }

    return [
      {
        after_word_index: afterWordIndex,
        after_segment_id: null,
        at_seconds: Number(word.end.toFixed(3)),
        pause_type: candidate.pause_type as Pause["pause_type"],
        duration_ms: Math.max(300, Math.min(12000, Math.round(candidate.duration_ms))),
        word: word.word,
        reason:
          typeof candidate.reason === "string"
            ? candidate.reason
            : "Auto-detected listener action point.",
        source: "model" as const,
      },
    ];
  });
}

