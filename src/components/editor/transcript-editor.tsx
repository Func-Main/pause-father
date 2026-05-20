"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import {
  AudioLines,
  Check,
  Clock3,
  Download,
  FileText,
  KeyRound,
  LoaderCircle,
  MousePointer2,
  Pause,
  Play,
  DollarSign,
  Settings,
  RotateCcw,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  formatDuration,
  formatSeconds,
  pauseAfterWord,
  retimeTranscript,
  sortPauses,
  upsertManualPause,
  wordIndex,
  type Pause as AutoPause,
  type Transcript,
} from "@autopauser/engine-js";
import samplePausePlan from "@/data/sample-pause-plan.json";
import sampleTranscript from "@/data/sample-transcript.json";
import {
  createBillingPortalSession,
  createCheckoutSession,
} from "@/app/actions/billing";
import {
  refreshProviderKeyStatuses,
  removeProviderApiKey,
  saveProviderApiKey,
} from "@/app/actions/provider-keys";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UserEntitlement } from "@/lib/billing/entitlements";
import type {
  ApiKeyProvider,
  ProviderKeyStatus,
} from "@/lib/user-provider-keys/types";
import { cn } from "@/lib/utils";

const demoTranscript = sampleTranscript as Transcript;
const demoModelPauses = (samplePausePlan as { pauses: AutoPause[] }).pauses.map(
  (pause) => ({ ...pause, source: "model" as const }),
);

const MAX_MANUAL_PAUSE_MS = 12000;
const DRAG_MS_PER_PIXEL = 35;
const NATURAL_GAP_HANDLE_THRESHOLD_MS = 350;
const DEMO_AUDIO_FILE_NAME = "interaction-demo.mp3";
const ORIGINAL_AUDIO_URL = "/audio/interaction-demo.mp3";
const UNLOCK_MESSAGE_AUDIO_URL = "/audio/unlock-message.m4a";
const ZERO_CROSSING_WINDOW_MS = 8;
const FORWARD_BOUNDARY_MS = 150;
const STABLE_SILENCE_MS = 60;
const ACOUSTIC_FRAME_MS = 5;
const SILENCE_THRESHOLD = 0.012;
const PREVIEW_FADE_MS = 20;
const ACTIVE_WORD_LOOKAHEAD_SECONDS = 0.035;
const ACTIVE_WORD_GRACE_SECONDS = 0.08;

export function TranscriptEditor({
  entitlement,
  providerKeyStatuses,
}: {
  entitlement: UserEntitlement;
  providerKeyStatuses: ProviderKeyStatus[];
}) {
  const [transcript, setTranscript] = useState<Transcript>(demoTranscript);
  const [pauses, setPauses] = useState<AutoPause[]>(demoModelPauses);
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  const [sourceAudioUrl, setSourceAudioUrl] = useState(ORIGINAL_AUDIO_URL);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState(ORIGINAL_AUDIO_URL);
  const [previewSignature, setPreviewSignature] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExportGateOpen, setIsExportGateOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutoTiming, setIsAutoTiming] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const [keyStatuses, setKeyStatuses] = useState(providerKeyStatuses);
  const [hasTweakedGaps, setHasTweakedGaps] = useState(false);
  const { isSignedIn } = useUser();
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(Number(demoTranscript.duration ?? 0));
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const originalAudioRef = useRef<AudioBuffer | null>(null);
  const unlockMessageAudioRef = useRef<AudioBuffer | null>(null);
  const uploadedAudioUrlRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const manualEditIdRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  const sortedPauses = useMemo(() => sortPauses(pauses), [pauses]);
  const pauseSignature = useMemo(
    () =>
      JSON.stringify(
        sortedPauses.map((pause) => [
          pause.after_word_index,
          pause.at_seconds,
          pause.duration_ms,
        ]),
      ),
    [sortedPauses],
  );
  const previewState =
    sortedPauses.length === 0
      ? "original"
      : previewSignature === pauseSignature
        ? "ready"
        : "rendering";
  const isDemoContentLoaded = !uploadedFileName && sourceAudioUrl === ORIGINAL_AUDIO_URL;
  const loadedAudioFileName = uploadedFileName ?? (isDemoContentLoaded ? DEMO_AUDIO_FILE_NAME : null);
  const primaryWorkflowStep =
    !isDemoContentLoaded && !uploadedFileName
      ? "demo"
      : sortedPauses.length === 0
        ? "auto"
        : "tweak";
  const retimedTranscript = useMemo(
    () => retimeTranscript(transcript, sortedPauses),
    [sortedPauses, transcript],
  );
  const selectedPause =
    selectedWordIndex === null
      ? undefined
      : pauseAfterWord(sortedPauses, selectedWordIndex);
  const selectedWordPosition =
    selectedWordIndex === null
      ? -1
      : transcript.words.findIndex(
          (word, fallbackIndex) =>
            wordIndex(word, fallbackIndex) === selectedWordIndex,
        );
  const selectedWord =
    selectedWordPosition >= 0 ? transcript.words[selectedWordPosition] : undefined;
  const selectedPauseDurationMs = selectedPause?.duration_ms ?? 0;
  const selectedPauseDurationSeconds = selectedPauseDurationMs / 1000;
  const activeWordIndex = useMemo(() => {
    return activeWordIndexAtTime(retimedTranscript.words, currentTime);
  }, [currentTime, retimedTranscript.words]);
  const activePauseProgress = useMemo(
    () => activePauseProgressByWord(sortedPauses, currentTime),
    [currentTime, sortedPauses],
  );
  const exportLimitSeconds = entitlement.exportLimitSeconds;
  const isExportLimited =
    typeof exportLimitSeconds === "number" && !entitlement.isPaid;
  const hasElevenLabsKey = keyStatuses.some(
    (status) => status.provider === "elevenlabs" && status.hasKey,
  );
  const hasOpenAiKey = keyStatuses.some(
    (status) => status.provider === "openai" && status.hasKey,
  );

  useEffect(() => {
    let isCancelled = false;
    const timeout = window.setTimeout(async () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }

      if (sortedPauses.length === 0) {
        setAudioUrl(sourceAudioUrl);
        setPreviewSignature("");
        return;
      }

      try {
        const originalAudio = await loadOriginalAudio(
          originalAudioRef,
          sourceAudioUrl,
        );
        if (isCancelled) {
          return;
        }
        const blob = renderPausedPreview(originalAudio, sortedPauses);
        const nextUrl = URL.createObjectURL(blob);
        previewObjectUrlRef.current = nextUrl;
        setAudioUrl(nextUrl);
        setPreviewSignature(pauseSignature);
      } catch (error) {
        console.error("Failed to render paused preview", error);
        setAudioUrl(sourceAudioUrl);
        setPreviewSignature("");
      }
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeout);
    };
  }, [pauseSignature, sortedPauses, sourceAudioUrl]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
      if (uploadedAudioUrlRef.current) {
        URL.revokeObjectURL(uploadedAudioUrlRef.current);
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !selectedPause ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      setHasTweakedGaps(true);
      setPauses((currentPauses) =>
        currentPauses.filter(
          (pause) => pause.after_word_index !== selectedWordIndex,
        ),
      );
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPause, selectedWordIndex]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    function updatePlaybackTime() {
      const audio = audioElementRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);
      }
      animationFrameRef.current = requestAnimationFrame(updatePlaybackTime);
    }

    animationFrameRef.current = requestAnimationFrame(updatePlaybackTime);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying]);

  async function applyAutoTiming() {
    setHasTweakedGaps(false);
    setSelectedWordIndex(null);

    if (isDemoContentLoaded) {
      setPauses(demoModelPauses);
      return;
    }

    setIsAutoTiming(true);
    setWorkflowMessage(null);

    try {
      const response = await fetch("/api/pause-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transcript }),
      });
      const body = (await response.json()) as {
        pauses?: AutoPause[];
        error?: string;
      };

      if (!response.ok || !Array.isArray(body.pauses)) {
        throw new Error(body.error ?? "Auto timing failed.");
      }

      setPauses(body.pauses);
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error
          ? error.message
          : "Auto timing failed. Check your OpenAI key and try again.",
      );
    } finally {
      setIsAutoTiming(false);
    }
  }

  function openUploadPicker() {
    uploadInputRef.current?.click();
  }

  async function uploadAudio(file: File | undefined) {
    if (!file) {
      return;
    }

    if (uploadedAudioUrlRef.current) {
      URL.revokeObjectURL(uploadedAudioUrlRef.current);
    }
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }

    const nextUrl = URL.createObjectURL(file);
    uploadedAudioUrlRef.current = nextUrl;
    originalAudioRef.current = null;
    pendingSeekTimeRef.current = null;
    setSourceAudioUrl(nextUrl);
    setUploadedFileName(file.name);
    setAudioUrl(nextUrl);
    setTranscript(emptyTranscript(file.name));
    setAudioDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPreviewSignature("");
    setHasTweakedGaps(false);
    setWorkflowMessage(null);
    setIsTranscribing(true);
    clearTiming();

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        transcript?: Transcript;
        error?: string;
      };

      if (!response.ok || !body.transcript) {
        throw new Error(body.error ?? "Transcription failed.");
      }

      setTranscript(body.transcript);
      setAudioDuration(Number(body.transcript.duration ?? 0));
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error
          ? error.message
          : "Transcription failed. Check your ElevenLabs key and try again.",
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  function clearTiming() {
    setHasTweakedGaps(false);
    setPauses([]);
    setSelectedWordIndex(null);
  }

  function clearAudioUrls() {
    if (uploadedAudioUrlRef.current) {
      URL.revokeObjectURL(uploadedAudioUrlRef.current);
      uploadedAudioUrlRef.current = null;
    }
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }

  function loadDemoContent() {
    clearAudioUrls();
    originalAudioRef.current = null;
    pendingSeekTimeRef.current = null;
    setSourceAudioUrl(ORIGINAL_AUDIO_URL);
    setUploadedFileName(null);
    setAudioUrl(ORIGINAL_AUDIO_URL);
    setTranscript(demoTranscript);
    setAudioDuration(Number(demoTranscript.duration ?? 0));
    setCurrentTime(0);
    setIsPlaying(false);
    setPreviewSignature("");
    setWorkflowMessage(null);
    setHasTweakedGaps(false);
    setPauses(demoModelPauses);
    setSelectedWordIndex(null);
  }

  function resetWorkspace() {
    clearAudioUrls();
    originalAudioRef.current = null;
    pendingSeekTimeRef.current = null;
    setSourceAudioUrl("");
    setUploadedFileName(null);
    setAudioUrl("");
    setTranscript(demoTranscript);
    setAudioDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPreviewSignature("");
    setIsExportGateOpen(false);
    setIsResetConfirmOpen(false);
    setWorkflowMessage(null);
    clearTiming();
  }

  function setPauseDuration(afterWordIndex: number, durationMs: number) {
    setHasTweakedGaps(true);
    const editId = manualEditIdRef.current + 1;
    manualEditIdRef.current = editId;
    const clampedDuration = clampDuration(durationMs);
    setPauses((currentPauses) =>
      upsertManualPause(
        currentPauses,
        transcript,
        afterWordIndex,
        clampedDuration,
      ),
    );
    setSelectedWordIndex(afterWordIndex);

    if (clampedDuration <= 0) {
      return;
    }

    void adjustManualPauseBoundary(afterWordIndex, clampedDuration, editId);
  }

  async function adjustManualPauseBoundary(
    afterWordIndex: number,
    durationMs: number,
    editId: number,
  ) {
    try {
      const audio = await loadOriginalAudio(originalAudioRef, sourceAudioUrl);
      if (manualEditIdRef.current !== editId) {
        return;
      }

      const words = transcript.words;
      const wordPosition = words.findIndex(
        (word, fallbackIndex) => wordIndex(word, fallbackIndex) === afterWordIndex,
      );
      const word = words[wordPosition];
      if (!word) {
        return;
      }
      const nextWord = words[wordPosition + 1];
      const requestedAtSeconds = word.end;
      const adjustedAtSeconds = findCleanManualCutTime(
        audio,
        requestedAtSeconds,
        nextWord?.start,
      );

      setPauses((currentPauses) =>
        sortPauses(
          currentPauses.map((pause) =>
            pause.after_word_index === afterWordIndex &&
            pause.duration_ms === durationMs
              ? {
                  ...pause,
                  requested_at_seconds: Number(requestedAtSeconds.toFixed(6)),
                  at_seconds: adjustedAtSeconds,
                  zero_crossing_shift_ms: Number(
                    ((adjustedAtSeconds - requestedAtSeconds) * 1000).toFixed(3),
                  ),
                }
              : pause,
          ),
        ),
      );
    } catch (error) {
      console.error("Failed to acoustically adjust manual pause", error);
    }
  }

  function removeSelectedPause() {
    if (selectedWordIndex === null) {
      return;
    }
    setPauses((currentPauses) =>
      currentPauses.filter((pause) => pause.after_word_index !== selectedWordIndex),
    );
    setHasTweakedGaps(true);
  }

  function togglePlayback() {
    const audio = audioElementRef.current;
    if (!audio || previewState === "rendering") {
      return;
    }
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  function seekTo(value: number) {
    const audio = audioElementRef.current;
    pendingSeekTimeRef.current = value;
    if (previewState === "rendering") {
      setCurrentTime(value);
      return;
    }
    if (!audio) {
      return;
    }
    const nextTime = Math.min(value, audio.duration || value);
    audio.currentTime = nextTime;
    pendingSeekTimeRef.current = null;
    setCurrentTime(nextTime);
  }

  function selectWordAndSeek(index: number) {
    setSelectedWordIndex(index);
    const word = retimedTranscript.words.find(
      (candidate, fallbackIndex) => wordIndex(candidate, fallbackIndex) === index,
    );
    if (word) {
      seekTo(word.start);
    }
  }

  async function downloadCurrentAudio() {
    if (previewState === "rendering") {
      return;
    }

    if (isExportLimited) {
      await downloadAudio({ limited: true });
      setIsExportGateOpen(true);
      return;
    }

    await downloadAudio({ limited: false });
  }

  async function downloadLimitedAudio() {
    await downloadAudio({ limited: true });
    setIsExportGateOpen(false);
  }

  async function downloadAudio({ limited }: { limited: boolean }) {
    const downloadUrl = limited
      ? URL.createObjectURL(
          renderPausedPreview(
            await loadOriginalAudio(originalAudioRef, sourceAudioUrl),
            sortedPauses,
            exportLimitSeconds ?? undefined,
            await loadUnlockMessageAudio(unlockMessageAudioRef),
          ),
        )
      : audioUrl;

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = sortedPauses.length > 0
      ? limited
        ? "pausefather-rendered-preview.wav"
        : "pausefather-rendered.wav"
      : limited
        ? "pausefather-original-preview.wav"
        : "pausefather-original.mp3";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (downloadUrl !== audioUrl) {
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col">
        <header className="border-b bg-background/95">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-emerald-600 text-white">
                <AudioLines className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">The Pausefather</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {entitlement.isPaid ? (
                <form action={createBillingPortalSession}>
                  <Button type="submit" variant="outline">
                    <Settings className="size-4" />
                    Billing
                  </Button>
                </form>
              ) : null}
              {isSignedIn ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSettingsOpen(true)}
                  >
                    <KeyRound className="size-4" />
                    API keys
                  </Button>
                  <UserButton />
                </>
              ) : (
                <Link
                  href="/sign-in"
                  className={buttonVariants({ variant: "outline" })}
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-0 flex-col gap-4">
            <div className="rounded-md border bg-card px-4 py-3">
              <audio
                ref={audioElementRef}
                src={audioUrl}
                preload="metadata"
                onLoadedMetadata={(event) => {
                  setAudioDuration(event.currentTarget.duration || 0);
                  const pendingSeekTime = pendingSeekTimeRef.current;
                  if (pendingSeekTime !== null) {
                    event.currentTarget.currentTime = Math.min(
                      pendingSeekTime,
                      event.currentTarget.duration || pendingSeekTime,
                    );
                    pendingSeekTimeRef.current = null;
                  }
                  setCurrentTime(event.currentTarget.currentTime || 0);
                  setIsPlaying(false);
                }}
                onTimeUpdate={(event) => {
                  if (!isPlaying) {
                    setCurrentTime(event.currentTarget.currentTime);
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
              <CustomPlayer
                currentTime={currentTime}
                duration={Number(retimedTranscript.duration ?? audioDuration)}
                isPlaying={isPlaying}
                pauses={sortedPauses}
                previewState={previewState}
                onSeek={seekTo}
                onTogglePlayback={togglePlayback}
              />
            </div>

            <Card className="min-h-0 flex-1 rounded-md">
              <CardHeader className="border-b py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base">Transcript</CardTitle>
                  <div className="flex flex-wrap items-center divide-x divide-border rounded-md border bg-muted/20 text-sm text-muted-foreground">
                    <TranscriptMetric
                      icon={FileText}
                      value={transcript.words.length.toString()}
                      label="words"
                    />
                    <TranscriptMetric
                      icon={Pause}
                      value={sortedPauses.length.toString()}
                      label="pauses"
                    />
                    <TranscriptMetric
                      icon={Timer}
                      value={formatDuration(
                        retimedTranscript.autopauser_retiming.inserted_silence_ms,
                      )}
                      label="inserted"
                    />
                    <TranscriptMetric
                      icon={Clock3}
                      value={formatSeconds(Number(retimedTranscript.duration ?? 0))}
                      label="duration"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-260px)] min-h-[420px]">
                  <div className="p-5">
                    <TranscriptWords
                      activePauseProgress={activePauseProgress}
                      pauses={sortedPauses}
                      words={retimedTranscript.words}
                      activeWordIndex={activeWordIndex}
                      selectedWordIndex={selectedWordIndex}
                      onSelectWord={selectWordAndSeek}
                      onSetPauseDuration={setPauseDuration}
                    />
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-h-0 flex-col gap-4">
            <div className="rounded-md border bg-card">
              <WorkflowStep
                icon={FileText}
                label="Load demo content"
                description={
                  isDemoContentLoaded
                    ? "Sample narration loaded"
                    : "Return to the sample narration"
                }
                actionLabel={isDemoContentLoaded ? "Reload" : "Load"}
                complete={isDemoContentLoaded}
                primary={primaryWorkflowStep === "demo"}
                onClick={loadDemoContent}
              />
            </div>

            <div className="rounded-md border bg-card">
              <input
                ref={uploadInputRef}
                className="hidden"
                type="file"
                accept="audio/*"
                onChange={(event) => {
                  uploadAudio(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <WorkflowStep
                step="1"
                icon={Upload}
                label="Upload audio"
                description={
                  hasElevenLabsKey
                    ? isTranscribing
                      ? "Transcribing with ElevenLabs"
                      : loadedAudioFileName ?? "Choose your own file"
                    : "Needs ElevenLabs API key"
                }
                actionLabel={
                  hasElevenLabsKey
                    ? isTranscribing
                      ? "Working"
                      : loadedAudioFileName
                      ? "Change"
                      : "Choose"
                    : "Locked"
                }
                complete={Boolean(loadedAudioFileName)}
                disabled={!hasElevenLabsKey || isTranscribing || isAutoTiming}
                onClick={openUploadPicker}
              />
              <WorkflowStep
                step="2"
                icon={Sparkles}
                label="Auto time"
                description={
                  !hasOpenAiKey
                    ? "Needs OpenAI API key"
                    : isAutoTiming
                      ? "Finding pause points with OpenAI"
                    : isTranscribing
                      ? "Transcribe audio first"
                    : sortedPauses.length > 0
                    ? `${sortedPauses.length} pauses suggested`
                    : "Place natural pauses automatically"
                }
                actionLabel={
                  hasOpenAiKey
                    ? isAutoTiming
                      ? "Working"
                      : sortedPauses.length > 0
                      ? "Rerun"
                      : "Run"
                    : "Locked"
                }
                complete={sortedPauses.length > 0}
                primary={primaryWorkflowStep === "auto"}
                disabled={
                  !hasOpenAiKey ||
                  !loadedAudioFileName ||
                  isTranscribing ||
                  isAutoTiming ||
                  transcript.words.length === 0
                }
                onClick={applyAutoTiming}
              />
              <WorkflowStep
                step="3"
                icon={MousePointer2}
                label="Tweak gaps"
                description={
                  hasTweakedGaps
                    ? "Pull pauses by hand on the transcript"
                    : sortedPauses.length > 0
                      ? "Ready for manual fine-tuning"
                      : "Fine-tune after auto timing"
                }
                complete={hasTweakedGaps}
                primary={primaryWorkflowStep === "tweak"}
              />
              <WorkflowStep
                step="4"
                icon={Download}
                label="Download audio"
                description={
                  entitlement.isPaid
                    ? "Full export unlocked"
                    : "Render your finished audio"
                }
                actionLabel={previewState === "rendering" ? "Rendering" : "Export"}
                disabled={
                  previewState === "rendering" ||
                  !loadedAudioFileName ||
                  isTranscribing ||
                  isAutoTiming
                }
                onClick={downloadCurrentAudio}
              />
            </div>
            {workflowMessage ? (
              <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {workflowMessage}
              </div>
            ) : null}
            {selectedWordIndex !== null ? (
              <Card className="animate-in fade-in-0 slide-in-from-right-2 rounded-md duration-200">
                <CardHeader className="border-b py-3">
                  <CardTitle className="space-y-1 text-base">
                    <span className="block text-xs font-normal text-muted-foreground">
                      Selected word
                    </span>
                    <span className="block truncate">
                      {selectedWord?.word ?? `Word ${selectedWordIndex}`}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 pt-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="pause-duration">Pause</Label>
                      <div className="relative">
                        <Input
                          id="pause-duration"
                          className="h-8 w-24 pr-7"
                          aria-label="Pause duration in seconds"
                          inputMode="numeric"
                          value={selectedPauseDurationSeconds.toFixed(1)}
                          onChange={(event) => {
                            if (selectedWordIndex === null) {
                              return;
                            }
                            setPauseDuration(
                              selectedWordIndex,
                              (Number(event.currentTarget.value) || 0) * 1000,
                            );
                          }}
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          s
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Slider
                        value={[selectedPauseDurationSeconds]}
                        min={0}
                        max={MAX_MANUAL_PAUSE_MS / 1000}
                        step={0.1}
                        disabled={selectedWordIndex === null}
                        onValueChange={(value) => {
                          if (selectedWordIndex === null) {
                            return;
                          }
                          const nextValue = Array.isArray(value) ? value[0] : value;
                          setPauseDuration(
                            selectedWordIndex,
                            (nextValue ?? 0) * 1000,
                          );
                        }}
                      />
                      <div className="flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
                        <span>0.0s</span>
                        <span>{(MAX_MANUAL_PAUSE_MS / 1000).toFixed(1)}s</span>
                      </div>
                    </div>
                  </div>

                  {selectedPause ? (
                    <div className="flex justify-end">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={removeSelectedPause}
                        aria-label="Delete selected pause"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : null}

                </CardContent>
              </Card>
            ) : null}

            <Button
              className="h-20 w-full justify-start border-destructive/35 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
              variant="outline"
              onClick={() => setIsResetConfirmOpen(true)}
            >
              <RotateCcw className="size-4" />
              Reset everything
            </Button>
          </aside>
        </section>
      </div>
      {isExportGateOpen ? (
        <ExportGate
          exportLimitSeconds={exportLimitSeconds ?? 10}
          isSignedIn={Boolean(isSignedIn)}
          onClose={() => setIsExportGateOpen(false)}
          onExportPreview={downloadLimitedAudio}
        />
      ) : null}
      {isResetConfirmOpen ? (
        <ResetConfirmDialog
          onCancel={() => setIsResetConfirmOpen(false)}
          onConfirm={resetWorkspace}
        />
      ) : null}
      {isSettingsOpen ? (
        <ProviderSettingsDialog
          statuses={keyStatuses}
          onClose={() => setIsSettingsOpen(false)}
          onStatusesChange={setKeyStatuses}
        />
      ) : null}
    </main>
  );
}

function ProviderSettingsDialog({
  statuses,
  onClose,
  onStatusesChange,
}: {
  statuses: ProviderKeyStatus[];
  onClose: () => void;
  onStatusesChange: (statuses: ProviderKeyStatus[]) => void;
}) {
  const [openAiKey, setOpenAiKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<ApiKeyProvider | null>(null);
  const [isPending, startTransition] = useTransition();
  const statusByProvider = useMemo(
    () => new Map(statuses.map((status) => [status.provider, status])),
    [statuses],
  );

  function handleSave(provider: ApiKeyProvider, apiKey: string) {
    setPendingProvider(provider);
    setMessage(null);
    startTransition(async () => {
      const result = await saveProviderApiKey(provider, apiKey);
      setMessage(result.message);

      if (result.ok) {
        onStatusesChange(await refreshProviderKeyStatuses());
        if (provider === "openai") {
          setOpenAiKey("");
        } else {
          setElevenLabsKey("");
        }
      }

      setPendingProvider(null);
    });
  }

  function handleDelete(provider: ApiKeyProvider) {
    setPendingProvider(provider);
    setMessage(null);
    startTransition(async () => {
      const result = await removeProviderApiKey(provider);
      setMessage(result.message);

      if (result.ok) {
        onStatusesChange(await refreshProviderKeyStatuses());
      }

      setPendingProvider(null);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-md border bg-card p-5 text-card-foreground shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id="provider-settings-title" className="text-lg font-semibold">
              API key settings
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Keys are encrypted before storage. Because this is a quick hack
              project, set sensible limits on your keys and use carefully.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-5 space-y-4">
          <ProviderKeyForm
            provider="elevenlabs"
            label="ElevenLabs"
            description="Used for speech-to-text only. Only STT permission is needed."
            placeholder="Paste ElevenLabs API key"
            value={elevenLabsKey}
            status={statusByProvider.get("elevenlabs")}
            disabled={isPending}
            isPending={isPending && pendingProvider === "elevenlabs"}
            onChange={setElevenLabsKey}
            onDelete={() => handleDelete("elevenlabs")}
            onSave={() => handleSave("elevenlabs", elevenLabsKey)}
          />
          <ProviderKeyForm
            provider="openai"
            label="OpenAI"
            description="Used to auto-detect where to insert pauses into the audio."
            placeholder="sk-..."
            value={openAiKey}
            status={statusByProvider.get("openai")}
            disabled={isPending}
            isPending={isPending && pendingProvider === "openai"}
            onChange={setOpenAiKey}
            onDelete={() => handleDelete("openai")}
            onSave={() => handleSave("openai", openAiKey)}
          />
        </div>

        {message ? (
          <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProviderKeyForm({
  label,
  description,
  placeholder,
  value,
  status,
  disabled,
  isPending,
  onChange,
  onDelete,
  onSave,
}: {
  provider: ApiKeyProvider;
  label: string;
  description: string;
  placeholder: string;
  value: string;
  status?: ProviderKeyStatus;
  disabled: boolean;
  isPending: boolean;
  onChange: (value: string) => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  return (
    <section className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
          <p className="text-xs text-muted-foreground">
            {status?.hasKey
              ? `Saved as ${status.keyHint ?? "encrypted key"}`
              : "No key saved"}
          </p>
        </div>
        {status?.hasKey ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        ) : null}
      </div>

      {!status?.hasKey ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Label className="sr-only" htmlFor={`${label}-api-key`}>
            {label} API key
          </Label>
          <Input
            id={`${label}-api-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          <Button
            type="button"
            className="shrink-0"
            disabled={disabled || value.trim().length === 0}
            onClick={onSave}
          >
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Save
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ResetConfirmDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-md border bg-card p-5 text-card-foreground shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-confirm-title"
        aria-describedby="reset-confirm-description"
      >
        <div className="space-y-2">
          <h2 id="reset-confirm-title" className="text-lg font-semibold">
            Reset everything?
          </h2>
          <p
            id="reset-confirm-description"
            className="text-sm leading-6 text-muted-foreground"
          >
            This unloads the current audio, removes all timing, and clears your
            current selection.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExportGate({
  exportLimitSeconds,
  isSignedIn,
  onClose,
  onExportPreview,
}: {
  exportLimitSeconds: number;
  isSignedIn: boolean;
  onClose: () => void;
  onExportPreview: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-md border bg-card p-5 text-card-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Unlock full export</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              The Pausefather is giftware. Create an account and unlock
              full-length exports with a minimum $1 payment.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close export unlock panel"
          >
            Close
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {isSignedIn ? (
            <form
              action={createCheckoutSession}
              className="flex items-center gap-2 rounded-md border bg-background px-2 py-2"
            >
              <Label htmlFor="export-giftware-amount" className="sr-only">
                Giftware amount
              </Label>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <DollarSign className="size-4 text-muted-foreground" />
                <Input
                  id="export-giftware-amount"
                  name="amountDollars"
                  className="h-8 border-0 px-1 shadow-none focus-visible:ring-0"
                  type="number"
                  min="1"
                  step="0.5"
                  defaultValue="1"
                />
              </div>
              <Button type="submit">Unlock</Button>
            </form>
          ) : (
            <>
              <Link
                href="/sign-up"
                className={buttonVariants({ className: "w-full" })}
              >
                Create account to unlock
              </Link>
              <Link
                href="/sign-in"
                className={buttonVariants({
                  variant: "outline",
                  className: "w-full",
                })}
              >
                Sign in
              </Link>
            </>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onExportPreview}
          >
            Export {exportLimitSeconds}-second preview again
          </Button>
        </div>
      </div>
    </div>
  );
}

function TranscriptWords({
  activeWordIndex,
  activePauseProgress,
  pauses,
  selectedWordIndex,
  words,
  onSelectWord,
  onSetPauseDuration,
}: {
  activeWordIndex: number | null;
  activePauseProgress: Map<number, number>;
  pauses: AutoPause[];
  selectedWordIndex: number | null;
  words: Transcript["words"];
  onSelectWord: (index: number) => void;
  onSetPauseDuration: (index: number, durationMs: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-y-4 text-lg leading-10">
      {words.map((word, fallbackIndex) => {
        const index = wordIndex(word, fallbackIndex);
        const nextWord = words[fallbackIndex + 1];
        const pause = pauseAfterWord(pauses, index);
        const gapMs = nextWord
          ? Math.max(0, (nextWord.start - word.end) * 1000)
          : 0;
        const naturalGapMs = Math.max(0, gapMs - (pause?.duration_ms ?? 0));

        return (
          <span key={`${index}-${word.word}`} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onSelectWord(index)}
              className={[
                "rounded px-1.5 py-0.5 transition-colors",
                selectedWordIndex === index
                  ? "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-400"
                  : activeWordIndex === index
                    ? "bg-blue-100 text-blue-950"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              {word.word}
            </button>
            <GapHandle
              activeProgress={activePauseProgress.get(index) ?? 0}
              index={index}
              naturalGapMs={naturalGapMs}
              pause={pause}
              onSelectWord={onSelectWord}
              onSetPauseDuration={onSetPauseDuration}
            />
          </span>
        );
      })}
    </div>
  );
}

function CustomPlayer({
  currentTime,
  duration,
  isPlaying,
  pauses,
  previewState,
  onSeek,
  onTogglePlayback,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  pauses: AutoPause[];
  previewState: "original" | "rendering" | "ready";
  onSeek: (value: number) => void;
  onTogglePlayback: () => void;
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progress = safeDuration > 0 ? (currentTime / safeDuration) * 100 : 0;
  const pauseMarkers = useMemo(() => {
    return pauses.map((pause, index) => {
      const insertedSeconds = pauses
        .slice(0, index)
        .reduce((total, previousPause) => total + previousPause.duration_ms / 1000, 0);
      const start = pause.at_seconds + insertedSeconds;
      return {
        key: `${pause.after_word_index ?? pause.after_segment_id}-${pause.duration_ms}`,
        left: safeDuration > 0 ? (start / safeDuration) * 100 : 0,
        width:
          safeDuration > 0
            ? Math.max(0.6, (pause.duration_ms / 1000 / safeDuration) * 100)
            : 0,
      };
    });
  }, [pauses, safeDuration]);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="outline"
          disabled={previewState === "rendering"}
          onClick={onTogglePlayback}
          aria-label={
            previewState === "rendering"
              ? "Rendering audio"
              : isPlaying
                ? "Pause audio"
                : "Play audio"
          }
        >
          {previewState === "rendering" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : isPlaying ? (
            <Square className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </Button>
        <div className="w-28 font-mono text-sm tabular-nums">
          {formatSeconds(currentTime)}
        </div>
      </div>

      <div className="relative flex h-10 min-w-0 flex-1 items-center">
        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute left-0 top-1/2 z-0 h-2 -translate-y-1/2 rounded-l-full bg-blue-500"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
        {pauseMarkers.map((marker) => (
          <div
            key={marker.key}
            className="absolute top-1/2 z-10 h-5 -translate-y-1/2 rounded-sm bg-orange-400/80"
            style={{
              left: `${marker.left}%`,
              width: `${marker.width}%`,
            }}
          />
        ))}
        <input
          className="relative z-20 h-10 w-full cursor-pointer opacity-0"
          type="range"
          min={0}
          max={safeDuration || 0}
          step={0.01}
          value={Math.min(currentTime, safeDuration)}
          disabled={safeDuration === 0 || previewState === "rendering"}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
          aria-label="Audio timeline"
        />
      </div>

      <div className="flex items-center justify-between gap-3 md:justify-start">
        <div className="w-24 text-right font-mono text-sm tabular-nums text-muted-foreground">
          {formatSeconds(safeDuration)}
        </div>
      </div>
    </div>
  );
}

function GapHandle({
  activeProgress,
  index,
  naturalGapMs,
  pause,
  onSelectWord,
  onSetPauseDuration,
}: {
  activeProgress: number;
  index: number;
  naturalGapMs: number;
  pause?: AutoPause;
  onSelectWord: (index: number) => void;
  onSetPauseDuration: (index: number, durationMs: number) => void;
}) {
  const hasNaturalGapHandle = !pause && naturalGapMs >= NATURAL_GAP_HANDLE_THRESHOLD_MS;
  const width = gapWidthForMs(naturalGapMs, pause?.duration_ms ?? 0);
  const showDurationLabel = pause && width >= 44;

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={[
          "relative mx-0.5 inline-flex h-11 cursor-grab items-center justify-center overflow-hidden rounded border transition-colors active:cursor-grabbing",
          pause
            ? "border-orange-500/70 bg-orange-100 text-orange-950"
            : hasNaturalGapHandle
              ? "border-orange-300/60 bg-orange-50/70 hover:border-orange-500/60 hover:bg-orange-100/80"
              : "border-transparent bg-transparent hover:border-border hover:bg-muted",
        ].join(" ")}
        style={{ width }}
        onClick={() => onSelectWord(index)}
        onPointerDown={(event) => {
          const startX = event.clientX;
          const baseDuration = pause?.duration_ms ?? 0;
          event.currentTarget.setPointerCapture(event.pointerId);

          function handlePointerMove(moveEvent: PointerEvent) {
            const nextDuration =
              baseDuration + (moveEvent.clientX - startX) * DRAG_MS_PER_PIXEL;
            onSetPauseDuration(index, nextDuration);
          }

          function handlePointerUp() {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
          }

          window.addEventListener("pointermove", handlePointerMove);
          window.addEventListener("pointerup", handlePointerUp);
        }}
        aria-label={
          pause
            ? `Pause after word ${index}`
            : hasNaturalGapHandle
              ? `Natural gap after word ${index}`
              : `No pause after word ${index}`
        }
      >
        {pause && activeProgress > 0 ? (
          <span
            className="absolute inset-y-0 left-0 bg-orange-500/45"
            style={{ width: `${Math.min(100, Math.max(0, activeProgress * 100))}%` }}
          />
        ) : null}
        {showDurationLabel ? (
          <span className="relative z-10 flex items-center gap-1 px-1.5 text-xs font-medium tabular-nums text-orange-700">
            <Clock3 className="size-3" />
            {(pause.duration_ms / 1000).toFixed(1)}s
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>
        {pause
          ? `${formatDuration(pause.duration_ms)} after word ${index}`
          : hasNaturalGapHandle
            ? `${formatDuration(Math.round(naturalGapMs))} natural gap after word ${index}`
            : `No pause after word ${index}`}
      </TooltipContent>
    </Tooltip>
  );
}

function activePauseProgressByWord(
  pauses: AutoPause[],
  currentTime: number,
): Map<number, number> {
  const progressByWord = new Map<number, number>();
  let insertedSeconds = 0;

  for (const pause of pauses) {
    if (typeof pause.after_word_index !== "number") {
      insertedSeconds += pause.duration_ms / 1000;
      continue;
    }
    const pauseStart = pause.at_seconds + insertedSeconds;
    const pauseDurationSeconds = pause.duration_ms / 1000;
    const pauseEnd = pauseStart + pauseDurationSeconds;

    if (currentTime >= pauseStart && currentTime <= pauseEnd) {
      progressByWord.set(
        pause.after_word_index,
        pauseDurationSeconds > 0
          ? (currentTime - pauseStart) / pauseDurationSeconds
          : 1,
      );
      break;
    }

    insertedSeconds += pauseDurationSeconds;
  }

  return progressByWord;
}

function activeWordIndexAtTime(
  words: Transcript["words"],
  currentTime: number,
): number | null {
  const adjustedTime = currentTime + ACTIVE_WORD_LOOKAHEAD_SECONDS;
  let closestWordIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const startsBeforeWindowEnd = word.start <= adjustedTime + ACTIVE_WORD_GRACE_SECONDS;
    const endsAfterWindowStart = word.end >= adjustedTime - ACTIVE_WORD_GRACE_SECONDS;

    if (startsBeforeWindowEnd && endsAfterWindowStart) {
      const center = (word.start + word.end) / 2;
      const distance = Math.abs(center - adjustedTime);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestWordIndex = wordIndex(word, index);
      }
    }

    if (word.start > adjustedTime + ACTIVE_WORD_GRACE_SECONDS) {
      break;
    }
  }

  return closestWordIndex;
}

function gapWidthForMs(naturalGapMs: number, insertedPauseMs: number): number {
  const baseNaturalWidth = Math.min(28, Math.max(6, 6 + naturalGapMs / 90));
  const naturalWidth =
    naturalGapMs >= NATURAL_GAP_HANDLE_THRESHOLD_MS
      ? Math.max(18, baseNaturalWidth)
      : baseNaturalWidth;
  const insertedWidth = insertedPauseMs > 0 ? Math.min(220, insertedPauseMs / 28) : 0;
  return naturalWidth + insertedWidth;
}

function TranscriptMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="flex h-8 items-center gap-1.5 px-2.5">
      <Icon className="size-3.5" />
      <span className="font-mono text-xs tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs">{label}</span>
    </div>
  );
}

function WorkflowStep({
  step,
  icon: Icon,
  label,
  description,
  actionLabel,
  complete = false,
  primary = false,
  disabled,
  onClick,
}: {
  step?: string;
  icon: LucideIcon;
  label: string;
  description: string;
  actionLabel?: string;
  complete?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-20 items-center gap-3 border-b px-3 py-3 last:border-b-0",
        primary && "bg-muted/35",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-xs tabular-nums text-foreground",
          primary && "border-foreground bg-foreground text-background",
          complete && !primary && "border-foreground bg-foreground text-background",
        )}
      >
        {complete ? <Check className="size-4" /> : step ? step : <Icon className="size-4" />}
      </span>
      {step ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      {actionLabel && onClick ? (
        <Button
          className="h-8 shrink-0 px-3"
          size="sm"
          variant={primary ? "default" : "outline"}
          disabled={disabled}
          onClick={onClick}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
    ),
  );
}

function emptyTranscript(fileName: string): Transcript {
  return {
    task: "transcribe",
    source: "pending-upload",
    text: fileName,
    duration: 0,
    segments: [],
    words: [],
  };
}

function clampDuration(durationMs: number): number {
  return Math.max(
    0,
    Math.min(MAX_MANUAL_PAUSE_MS, Math.round(durationMs / 100) * 100),
  );
}

async function loadOriginalAudio(
  audioRef: React.MutableRefObject<AudioBuffer | null>,
  url: string,
): Promise<AudioBuffer> {
  return loadAudioFromUrl(url, audioRef);
}

async function loadUnlockMessageAudio(
  audioRef: React.MutableRefObject<AudioBuffer | null>,
): Promise<AudioBuffer> {
  return loadAudioFromUrl(UNLOCK_MESSAGE_AUDIO_URL, audioRef);
}

async function loadAudioFromUrl(
  url: string,
  audioRef: React.MutableRefObject<AudioBuffer | null>,
): Promise<AudioBuffer> {
  if (audioRef.current) {
    return audioRef.current;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio from ${url}: ${response.status}`);
  }
  const encodedAudio = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const decodedAudio = await context.decodeAudioData(encodedAudio.slice(0));
    audioRef.current = decodedAudio;
    return decodedAudio;
  } finally {
    await context.close();
  }
}

function renderPausedPreview(
  audio: AudioBuffer,
  pauses: AutoPause[],
  maxDurationSeconds?: number,
  appendAudio?: AudioBuffer,
): Blob {
  const sortedPauses = sortPauses(pauses).filter((pause) => pause.duration_ms > 0);
  const sampleRate = audio.sampleRate;
  const channelCount = audio.numberOfChannels;
  const insertedSamples = sortedPauses.reduce(
    (total, pause) => total + Math.round((pause.duration_ms / 1000) * sampleRate),
    0,
  );
  const unrestrictedOutputLength = audio.length + insertedSamples;
  const cappedOutputLength =
    typeof maxDurationSeconds === "number"
      ? Math.max(
          1,
          Math.min(
            unrestrictedOutputLength,
            Math.round(maxDurationSeconds * sampleRate),
          ),
        )
      : unrestrictedOutputLength;
  const appendedSamples = appendAudio
    ? Math.round(appendAudio.duration * sampleRate)
    : 0;
  const outputLength = cappedOutputLength + appendedSamples;
  const outputChannels = Array.from(
    { length: channelCount },
    () => new Float32Array(outputLength),
  );

  let inputPosition = 0;
  let outputPosition = 0;

  for (const pause of sortedPauses) {
    const cutPosition = Math.max(
      inputPosition,
      Math.min(audio.length, Math.round(pause.at_seconds * sampleRate)),
    );
    const chunkLength = cutPosition - inputPosition;
    const copiedLength = copyAudioChunk(
      audio,
      outputChannels,
      inputPosition,
      outputPosition,
      chunkLength,
      cappedOutputLength,
    );
    if (inputPosition > 0) {
      applyFadeIn(outputChannels, outputPosition, copiedLength, sampleRate);
    }
    applyFadeOut(outputChannels, outputPosition, copiedLength, sampleRate);
    outputPosition += chunkLength;
    outputPosition += Math.round((pause.duration_ms / 1000) * sampleRate);
    inputPosition = cutPosition;

    if (outputPosition >= cappedOutputLength) {
      appendExternalAudioChunk(
        appendAudio,
        outputChannels,
        cappedOutputLength,
        appendedSamples,
        sampleRate,
      );
      return encodeWav(outputChannels, sampleRate);
    }
  }

  const finalOutputPosition = outputPosition;
  const copiedFinalLength = copyAudioChunk(
    audio,
    outputChannels,
    inputPosition,
    outputPosition,
    audio.length - inputPosition,
    cappedOutputLength,
  );
  applyFadeIn(
    outputChannels,
    finalOutputPosition,
    copiedFinalLength,
    sampleRate,
  );

  appendExternalAudioChunk(
    appendAudio,
    outputChannels,
    cappedOutputLength,
    appendedSamples,
    sampleRate,
  );

  return encodeWav(outputChannels, sampleRate);
}

function copyAudioChunk(
  audio: AudioBuffer,
  outputChannels: Float32Array[],
  inputStart: number,
  outputStart: number,
  length: number,
  maxOutputEnd?: number,
): number {
  const availableOutputLength = Math.min(
    outputChannels[0]?.length ?? 0,
    maxOutputEnd ?? Number.POSITIVE_INFINITY,
  );
  const clippedLength = Math.max(
    0,
    Math.min(length, availableOutputLength - outputStart),
  );

  if (clippedLength <= 0) {
    return 0;
  }

  for (let channel = 0; channel < outputChannels.length; channel += 1) {
    const inputChannel = audio.getChannelData(channel);
    outputChannels[channel].set(
      inputChannel.subarray(inputStart, inputStart + clippedLength),
      outputStart,
    );
  }

  return clippedLength;
}

function appendExternalAudioChunk(
  audio: AudioBuffer | undefined,
  outputChannels: Float32Array[],
  outputStart: number,
  length: number,
  outputSampleRate: number,
) {
  if (!audio || length <= 0) {
    return;
  }

  for (let channel = 0; channel < outputChannels.length; channel += 1) {
    const outputChannel = outputChannels[channel];
    for (let offset = 0; offset < length; offset += 1) {
      const sourceIndex = Math.min(
        audio.length - 1,
        Math.floor((offset / outputSampleRate) * audio.sampleRate),
      );
      outputChannel[outputStart + offset] = audioSampleAt(
        audio,
        sourceIndex,
        channel,
        outputChannels.length,
      );
    }
  }
}

function audioSampleAt(
  audio: AudioBuffer,
  index: number,
  outputChannel: number,
  outputChannelCount: number,
): number {
  if (audio.numberOfChannels === 1) {
    return audio.getChannelData(0)[index] ?? 0;
  }

  if (outputChannelCount === 1) {
    let total = 0;
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      total += audio.getChannelData(channel)[index] ?? 0;
    }
    return total / audio.numberOfChannels;
  }

  const sourceChannel = Math.min(outputChannel, audio.numberOfChannels - 1);
  return audio.getChannelData(sourceChannel)[index] ?? 0;
}

function applyFadeOut(
  channels: Float32Array[],
  chunkOutputStart: number,
  chunkLength: number,
  sampleRate: number,
) {
  const fadeLength = Math.min(
    Math.round((PREVIEW_FADE_MS / 1000) * sampleRate),
    Math.floor(chunkLength / 2),
  );
  if (fadeLength <= 0) {
    return;
  }
  const fadeStart = chunkOutputStart + chunkLength - fadeLength;
  for (const channel of channels) {
    for (let offset = 0; offset < fadeLength; offset += 1) {
      channel[fadeStart + offset] *= 1 - offset / fadeLength;
    }
  }
}

function applyFadeIn(
  channels: Float32Array[],
  chunkOutputStart: number,
  chunkLength: number,
  sampleRate: number,
) {
  const fadeLength = Math.min(
    Math.round((PREVIEW_FADE_MS / 1000) * sampleRate),
    Math.floor(chunkLength / 2),
  );
  if (fadeLength <= 0) {
    return;
  }
  for (const channel of channels) {
    for (let offset = 0; offset < fadeLength; offset += 1) {
      channel[chunkOutputStart + offset] *= offset / fadeLength;
    }
  }
}

function findCleanManualCutTime(
  audio: AudioBuffer,
  requestedAtSeconds: number,
  nextWordStartSeconds?: number,
): number {
  const forwardSearchMs =
    typeof nextWordStartSeconds === "number"
      ? Math.max(
          0,
          Math.min(
            FORWARD_BOUNDARY_MS,
            (nextWordStartSeconds - requestedAtSeconds) * 1000,
          ),
        )
      : FORWARD_BOUNDARY_MS;
  const boundarySeconds =
    forwardSearchMs >= ACOUSTIC_FRAME_MS
      ? findForwardAcousticBoundary(audio, requestedAtSeconds, forwardSearchMs)
      : requestedAtSeconds;
  return findNearestZeroCrossing(audio, boundarySeconds, ZERO_CROSSING_WINDOW_MS);
}

function findNearestZeroCrossing(
  audio: AudioBuffer,
  targetSeconds: number,
  windowMs: number,
): number {
  const sampleRate = audio.sampleRate;
  const sampleCount = audio.length;
  const centerIndex = clampSampleIndex(
    Math.round(targetSeconds * sampleRate),
    sampleCount,
  );
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const startIndex = Math.max(0, centerIndex - windowSamples);
  const endIndex = Math.min(sampleCount - 1, centerIndex + windowSamples);

  let bestIndex = centerIndex;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAmplitude = Number.POSITIVE_INFINITY;

  for (let index = Math.max(1, startIndex + 1); index <= endIndex; index += 1) {
    const previousSample = monoSampleAt(audio, index - 1);
    const currentSample = monoSampleAt(audio, index);
    const crossesZero =
      previousSample === 0 ||
      currentSample === 0 ||
      (previousSample < 0 && currentSample > 0) ||
      (previousSample > 0 && currentSample < 0);
    if (!crossesZero) {
      continue;
    }

    const distance = Math.abs(index - centerIndex);
    const amplitude = Math.min(Math.abs(previousSample), Math.abs(currentSample));
    if (
      distance < bestDistance ||
      (distance === bestDistance && amplitude < bestAmplitude)
    ) {
      bestIndex = index;
      bestDistance = distance;
      bestAmplitude = amplitude;
    }
  }

  if (!Number.isFinite(bestDistance)) {
    bestIndex = centerIndex;
    bestAmplitude = Math.abs(monoSampleAt(audio, centerIndex));
    for (let index = startIndex; index <= endIndex; index += 1) {
      const amplitude = Math.abs(monoSampleAt(audio, index));
      const distance = Math.abs(index - centerIndex);
      if (
        amplitude < bestAmplitude ||
        (amplitude === bestAmplitude && distance < Math.abs(bestIndex - centerIndex))
      ) {
        bestIndex = index;
        bestAmplitude = amplitude;
      }
    }
  }

  return Number((bestIndex / sampleRate).toFixed(6));
}

function findForwardAcousticBoundary(
  audio: AudioBuffer,
  targetSeconds: number,
  searchMs: number,
): number {
  const sampleRate = audio.sampleRate;
  const startIndex = clampSampleIndex(
    Math.round(targetSeconds * sampleRate),
    audio.length,
  );
  const searchSamples = Math.max(1, Math.round((searchMs / 1000) * sampleRate));
  const stopIndex = Math.min(audio.length, startIndex + searchSamples);
  const frameSize = Math.max(1, Math.round((ACOUSTIC_FRAME_MS / 1000) * sampleRate));
  const stableFrameCount = Math.max(
    1,
    Math.ceil(STABLE_SILENCE_MS / ACOUSTIC_FRAME_MS),
  );

  const framePeaks: Array<{ start: number; peak: number }> = [];
  for (let start = startIndex; start < stopIndex; start += frameSize) {
    let peak = 0;
    for (let index = start; index < Math.min(stopIndex, start + frameSize); index += 1) {
      peak = Math.max(peak, Math.abs(monoSampleAt(audio, index)));
    }
    framePeaks.push({ start, peak });
  }

  if (framePeaks.length === 0) {
    return targetSeconds;
  }

  let bestFrame = framePeaks.reduce((best, frame) =>
    frame.peak < best.peak ? frame : best,
  );
  for (let index = 0; index < framePeaks.length; index += 1) {
    const stableFrames = framePeaks.slice(index, index + stableFrameCount);
    if (stableFrames.length < stableFrameCount) {
      break;
    }
    if (stableFrames.every((frame) => frame.peak <= SILENCE_THRESHOLD)) {
      bestFrame = framePeaks[index];
      break;
    }
  }

  return bestFrame.start / sampleRate;
}

function monoSampleAt(audio: AudioBuffer, index: number): number {
  const clampedIndex = clampSampleIndex(index, audio.length);
  let total = 0;
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    total += audio.getChannelData(channel)[clampedIndex] ?? 0;
  }
  return total / audio.numberOfChannels;
}

function clampSampleIndex(index: number, sampleCount: number): number {
  return Math.max(0, Math.min(sampleCount - 1, index));
}

function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length;
  const sampleCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = sampleCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < sampleCount; index += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][index] ?? 0));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
