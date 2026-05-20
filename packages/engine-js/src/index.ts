export type PauseType =
  | "micro"
  | "beat"
  | "section_break"
  | "thinking"
  | "interaction";

export type PauseSource = "model" | "manual";

export interface TranscriptWord {
  index?: number;
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

export interface Transcript {
  duration?: number;
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  [key: string]: unknown;
}

export interface Pause {
  after_word_index?: number;
  after_segment_id?: number | null;
  at_seconds: number;
  pause_type: PauseType;
  duration_ms: number;
  word?: string;
  reason?: string;
  requested_at_seconds?: number;
  zero_crossing_shift_ms?: number;
  source?: PauseSource;
}

export interface RetimingMetadata {
  inserted_silence_ms: number;
  pause_count: number;
  source: string;
  pauses: Array<{
    at_seconds: number;
    duration_ms: number;
    after_word_index?: number;
    after_segment_id?: number | null;
  }>;
}

export type RetimedTranscript = Transcript & {
  autopauser_retiming: RetimingMetadata;
};

const TIMING_EPSILON_SECONDS = 0.001;

export function wordIndex(word: TranscriptWord, fallbackIndex: number): number {
  return typeof word.index === "number" ? word.index : fallbackIndex;
}

export function pauseKey(pause: Pick<Pause, "after_word_index" | "after_segment_id">): string {
  if (typeof pause.after_word_index === "number") {
    return `word:${pause.after_word_index}`;
  }
  return `segment:${pause.after_segment_id ?? "unknown"}`;
}

export function sortPauses(pauses: Pause[]): Pause[] {
  return [...pauses].sort((left, right) => left.at_seconds - right.at_seconds);
}

export function pauseAfterWord(pauses: Pause[], afterWordIndex: number): Pause | undefined {
  return pauses.find((pause) => pause.after_word_index === afterWordIndex);
}

export function upsertManualPause(
  pauses: Pause[],
  transcript: Transcript,
  afterWordIndex: number,
  durationMs: number,
): Pause[] {
  const words = transcript.words;
  const word = words.find((candidate, fallbackIndex) => wordIndex(candidate, fallbackIndex) === afterWordIndex);
  if (!word) {
    return pauses;
  }

  const nextPauses = pauses.filter((pause) => pause.after_word_index !== afterWordIndex);
  if (durationMs <= 0) {
    return sortPauses(nextPauses);
  }

  return sortPauses([
    ...nextPauses,
    {
      after_word_index: afterWordIndex,
      at_seconds: Number(word.end.toFixed(3)),
      pause_type: "interaction",
      duration_ms: Math.round(durationMs),
      word: word.word.trim(),
      reason: "Manual silence extension.",
      source: "manual",
    },
  ]);
}

export function shiftForTime(
  seconds: number,
  pauses: Pause[],
  includeBoundary: boolean,
): number {
  return pauses.reduce((shiftSeconds, pause) => {
    const pauseTime = pause.at_seconds;
    const shouldShift = includeBoundary
      ? seconds + TIMING_EPSILON_SECONDS >= pauseTime
      : seconds > pauseTime + TIMING_EPSILON_SECONDS;
    return shouldShift ? shiftSeconds + pause.duration_ms / 1000 : shiftSeconds;
  }, 0);
}

export function retimeInterval(
  start: number,
  end: number,
  pauses: Pause[],
): [number, number] {
  const retimedStart = start + shiftForTime(start, pauses, true);
  const retimedEnd = Math.max(
    retimedStart,
    end + shiftForTime(end, pauses, false),
  );
  return [roundSeconds(retimedStart), roundSeconds(retimedEnd)];
}

export function retimeTranscript(
  transcript: Transcript,
  pauses: Pause[],
): RetimedTranscript {
  const sortedPauses = sortPauses(pauses);
  const retimed = structuredClone(transcript) as RetimedTranscript;

  retimed.segments = retimed.segments.map((segment) => {
    const [start, end] = retimeInterval(segment.start, segment.end, sortedPauses);
    return { ...segment, start, end };
  });

  retimed.words = retimed.words.map((word) => {
    const [start, end] = retimeInterval(word.start, word.end, sortedPauses);
    return { ...word, start, end };
  });

  if (typeof transcript.duration === "number") {
    retimed.duration = roundSeconds(
      transcript.duration +
        sortedPauses.reduce((total, pause) => total + pause.duration_ms, 0) / 1000,
    );
  }

  retimed.autopauser_retiming = {
    inserted_silence_ms: sortedPauses.reduce((total, pause) => total + pause.duration_ms, 0),
    pause_count: sortedPauses.length,
    source: "derived_from_original_transcript_and_pause_plan",
    pauses: sortedPauses.map((pause) => ({
      at_seconds: pause.at_seconds,
      duration_ms: pause.duration_ms,
      after_word_index: pause.after_word_index,
      after_segment_id: pause.after_segment_id,
    })),
  };

  return retimed;
}

export function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(3).padStart(6, "0")}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}
