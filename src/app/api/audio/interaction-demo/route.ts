import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  const audioPath = path.resolve(
    process.cwd(),
    "public/audio/interaction-demo.mp3",
  );
  const audio = await readFile(audioPath);

  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
