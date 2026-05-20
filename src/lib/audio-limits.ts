export const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_TRANSCRIPT_WORDS = 5000;

export const AUDIO_UPLOAD_CONTENT_TYPES = [
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/wave",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
] as const;

const AUDIO_UPLOAD_EXTENSIONS = [
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
];

const AUDIO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

export const AUDIO_UPLOAD_ACCEPT = [
  ...AUDIO_UPLOAD_CONTENT_TYPES,
  ...AUDIO_UPLOAD_EXTENSIONS,
].join(",");

export function isAllowedAudioFile(file: Pick<File, "name" | "type">): boolean {
  const type = file.type.toLowerCase();

  if (
    AUDIO_UPLOAD_CONTENT_TYPES.some(
      (allowedType) => type === allowedType || type.startsWith(`${allowedType};`),
    )
  ) {
    return true;
  }

  const name = file.name.toLowerCase();
  return AUDIO_UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function audioContentTypeForFile(file: Pick<File, "name" | "type">): string {
  if (file.type) {
    return file.type;
  }

  const name = file.name.toLowerCase();
  const extension = AUDIO_UPLOAD_EXTENSIONS.find((candidate) =>
    name.endsWith(candidate),
  );

  return extension ? AUDIO_CONTENT_TYPE_BY_EXTENSION[extension] : "audio/mpeg";
}

export function formatUploadLimit(bytes = MAX_AUDIO_UPLOAD_BYTES): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}
