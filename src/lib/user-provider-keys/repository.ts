import { getSql } from "@/lib/db/neon";
import { decryptSecret, encryptSecret } from "@/lib/user-provider-keys/crypto";
import {
  PROVIDERS,
  type ApiKeyProvider,
  type ProviderKeyStatus,
} from "@/lib/user-provider-keys/types";

type ProviderKeyRow = {
  provider: ApiKeyProvider;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  key_hint: string | null;
  updated_at: string;
};

export async function getProviderKeyStatuses(
  clerkUserId: string,
): Promise<ProviderKeyStatus[]> {
  await ensureUserProviderKeysTable();
  const sql = getSql();
  const rows = (await sql`
    select provider, key_hint, updated_at
    from user_provider_keys
    where clerk_user_id = ${clerkUserId}
  `) as Array<Pick<ProviderKeyRow, "provider" | "key_hint" | "updated_at">>;
  const rowByProvider = new Map(rows.map((row) => [row.provider, row]));

  return PROVIDERS.map((provider) => {
    const row = rowByProvider.get(provider);

    return {
      provider,
      hasKey: Boolean(row),
      keyHint: row?.key_hint ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export async function upsertProviderApiKey({
  clerkUserId,
  provider,
  apiKey,
}: {
  clerkUserId: string;
  provider: ApiKeyProvider;
  apiKey: string;
}) {
  await ensureUserProviderKeysTable();
  const encrypted = encryptSecret(apiKey);
  const keyHint = maskApiKey(apiKey);
  const sql = getSql();

  await sql`
    insert into user_provider_keys (
      clerk_user_id,
      provider,
      encrypted_key,
      iv,
      auth_tag,
      key_hint
    )
    values (
      ${clerkUserId},
      ${provider},
      ${encrypted.encryptedKey},
      ${encrypted.iv},
      ${encrypted.authTag},
      ${keyHint}
    )
    on conflict (clerk_user_id, provider)
    do update set
      encrypted_key = excluded.encrypted_key,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      key_hint = excluded.key_hint,
      updated_at = now()
  `;
}

export async function deleteProviderApiKey({
  clerkUserId,
  provider,
}: {
  clerkUserId: string;
  provider: ApiKeyProvider;
}) {
  await ensureUserProviderKeysTable();
  const sql = getSql();

  await sql`
    delete from user_provider_keys
    where clerk_user_id = ${clerkUserId}
      and provider = ${provider}
  `;
}

export async function getDecryptedProviderApiKey({
  clerkUserId,
  provider,
}: {
  clerkUserId: string;
  provider: ApiKeyProvider;
}): Promise<string | null> {
  await ensureUserProviderKeysTable();
  const sql = getSql();
  const rows = (await sql`
    select provider, encrypted_key, iv, auth_tag, key_hint, updated_at
    from user_provider_keys
    where clerk_user_id = ${clerkUserId}
      and provider = ${provider}
    limit 1
  `) as ProviderKeyRow[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  return decryptSecret({
    encryptedKey: row.encrypted_key,
    iv: row.iv,
    authTag: row.auth_tag,
  });
}

export function parseProvider(value: unknown): ApiKeyProvider | null {
  return PROVIDERS.find((provider) => provider === value) ?? null;
}

function maskApiKey(apiKey: string): string {
  const trimmedKey = apiKey.trim();

  if (trimmedKey.length <= 8) {
    return "saved key";
  }

  return `${trimmedKey.slice(0, 4)}...${trimmedKey.slice(-4)}`;
}

let hasEnsuredTable = false;

async function ensureUserProviderKeysTable() {
  if (hasEnsuredTable) {
    return;
  }

  const sql = getSql();

  await sql`
    create table if not exists user_provider_keys (
      id uuid primary key default gen_random_uuid(),
      clerk_user_id text not null,
      provider text not null check (provider in ('openai', 'elevenlabs')),
      encrypted_key text not null,
      iv text not null,
      auth_tag text not null,
      key_hint text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (clerk_user_id, provider)
    )
  `;

  hasEnsuredTable = true;
}

