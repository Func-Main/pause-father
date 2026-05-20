export const PROVIDERS = ["openai", "elevenlabs"] as const;

export type ApiKeyProvider = (typeof PROVIDERS)[number];

export type ProviderKeyStatus = {
  provider: ApiKeyProvider;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
};

