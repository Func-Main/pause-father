import { TranscriptEditor } from "@/components/editor/transcript-editor";
import { getCurrentEntitlement } from "@/lib/billing/entitlements";

export default async function Home() {
  const entitlement = await getCurrentEntitlement();

  return <TranscriptEditor entitlement={entitlement} />;
}
