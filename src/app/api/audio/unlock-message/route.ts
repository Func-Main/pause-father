import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  const audioPath = path.resolve(process.cwd(), "../../1_dollar.m4a");
  const audio = await readFile(audioPath);

  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mp4",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
