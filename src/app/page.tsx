import { TranscriptEditor } from "@/components/editor/transcript-editor";
import { getCurrentEntitlement } from "@/lib/billing/entitlements";
import { auth } from "@clerk/nextjs/server";
import { getProviderKeyStatuses } from "@/lib/user-provider-keys/repository";
import { PROVIDERS, type ProviderKeyStatus } from "@/lib/user-provider-keys/types";

export default async function Home() {
  const entitlement = await getCurrentEntitlement();
  const { userId } = await auth();
  const providerKeyStatuses = userId
    ? await getProviderKeyStatuses(userId).catch(() => defaultProviderKeyStatuses())
    : defaultProviderKeyStatuses();

  return (
    <TranscriptEditor
      entitlement={entitlement}
      providerKeyStatuses={providerKeyStatuses}
    />
  );
}

function defaultProviderKeyStatuses(): ProviderKeyStatus[] {
  return PROVIDERS.map((provider) => ({
    provider,
    hasKey: false,
    keyHint: null,
    updatedAt: null,
  }));
}
