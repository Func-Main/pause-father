"use server";

import { auth } from "@clerk/nextjs/server";
import {
  deleteProviderApiKey,
  getProviderKeyStatuses,
  parseProvider,
  upsertProviderApiKey,
} from "@/lib/user-provider-keys/repository";
import type { ApiKeyProvider } from "@/lib/user-provider-keys/types";

export type ProviderKeyActionResult = {
  ok: boolean;
  message: string;
};

export async function saveProviderApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<ProviderKeyActionResult> {
  const { userId } = await auth();
  const parsedProvider = parseProvider(provider);
  const trimmedKey = apiKey.trim();

  if (!userId) {
    return { ok: false, message: "Sign in before saving API keys." };
  }

  if (!parsedProvider) {
    return { ok: false, message: "Unknown provider." };
  }

  if (trimmedKey.length < 12) {
    return { ok: false, message: "Enter the full API key before saving." };
  }

  try {
    await upsertProviderApiKey({
      clerkUserId: userId,
      provider: parsedProvider,
      apiKey: trimmedKey,
    });
  } catch (error) {
    console.error("Failed to save provider API key", error);
    return {
      ok: false,
      message:
        "API key storage is not configured yet. Add DATABASE_URL and KEY_ENCRYPTION_SECRET.",
    };
  }

  return { ok: true, message: "API key saved." };
}

export async function removeProviderApiKey(
  provider: ApiKeyProvider,
): Promise<ProviderKeyActionResult> {
  const { userId } = await auth();
  const parsedProvider = parseProvider(provider);

  if (!userId) {
    return { ok: false, message: "Sign in before removing API keys." };
  }

  if (!parsedProvider) {
    return { ok: false, message: "Unknown provider." };
  }

  try {
    await deleteProviderApiKey({
      clerkUserId: userId,
      provider: parsedProvider,
    });
  } catch (error) {
    console.error("Failed to remove provider API key", error);
    return {
      ok: false,
      message:
        "API key storage is not configured yet. Add DATABASE_URL and KEY_ENCRYPTION_SECRET.",
    };
  }

  return { ok: true, message: "API key removed." };
}

export async function refreshProviderKeyStatuses() {
  const { userId } = await auth();

  if (!userId) {
    return [];
  }

  return getProviderKeyStatuses(userId).catch(() => []);
}
