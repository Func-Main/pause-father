import { auth, currentUser } from "@clerk/nextjs/server";

export const FREE_EXPORT_LIMIT_SECONDS = 5;

const PAID_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export type BillingPlan = "free" | "paid";

export interface UserEntitlement {
  plan: BillingPlan;
  isPaid: boolean;
  exportLimitSeconds: number | null;
  stripeCustomerId?: string;
  paymentType?: string;
  subscriptionStatus?: string;
}

type BillingMetadata = {
  plan?: unknown;
  paymentType?: unknown;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  subscriptionStatus?: unknown;
};

export async function getCurrentEntitlement(): Promise<UserEntitlement> {
  const { userId } = await auth();

  if (!userId) {
    return freeEntitlement();
  }

  const user = await currentUser();
  const metadata = user?.privateMetadata as BillingMetadata | undefined;
  const subscriptionStatus =
    typeof metadata?.subscriptionStatus === "string"
      ? metadata.subscriptionStatus
      : undefined;
  const isPaid =
    metadata?.plan === "paid" ||
    (subscriptionStatus !== undefined &&
      PAID_SUBSCRIPTION_STATUSES.has(subscriptionStatus));

  if (!isPaid) {
    return {
      ...freeEntitlement(),
      stripeCustomerId:
        typeof metadata?.stripeCustomerId === "string"
          ? metadata.stripeCustomerId
          : undefined,
      paymentType:
        typeof metadata?.paymentType === "string"
          ? metadata.paymentType
          : undefined,
      subscriptionStatus,
    };
  }

  return {
    plan: "paid",
    isPaid: true,
    exportLimitSeconds: null,
    stripeCustomerId:
      typeof metadata?.stripeCustomerId === "string"
        ? metadata.stripeCustomerId
        : undefined,
    paymentType:
      typeof metadata?.paymentType === "string"
        ? metadata.paymentType
        : undefined,
    subscriptionStatus,
  };
}

function freeEntitlement(): UserEntitlement {
  return {
    plan: "free",
    isPaid: false,
    exportLimitSeconds: FREE_EXPORT_LIMIT_SECONDS,
  };
}
