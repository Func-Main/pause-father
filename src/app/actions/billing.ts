"use server";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getStripe } from "@/lib/billing/stripe";

type BillingMetadata = {
  stripeCustomerId?: unknown;
};

const MIN_GIFTWARE_AMOUNT_CENTS = 100;

export async function createCheckoutSession(formData: FormData) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL");
  }

  const amountCents = giftwareAmountCents(formData.get("amountDollars"));
  const user = await currentUser();
  const metadata = user?.privateMetadata as BillingMetadata | undefined;
  const existingCustomerId =
    typeof metadata?.stripeCustomerId === "string"
      ? metadata.stripeCustomerId
      : undefined;
  const stripe = getStripe();
  const customerId =
    existingCustomerId ??
    (
      await stripe.customers.create({
        email: user?.primaryEmailAddress?.emailAddress,
        name: user?.fullName ?? undefined,
        metadata: {
          clerkUserId: userId,
        },
      })
    ).id;

  if (!existingCustomerId) {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      privateMetadata: {
        stripeCustomerId: customerId,
      },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: "The Pausefather giftware unlock",
            description: "Unlock full-length The Pausefather exports.",
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    metadata: {
      clerkUserId: userId,
      paymentType: "giftware",
      amountCents: amountCents.toString(),
    },
  });

  redirect(session.url ?? "/");
}

export async function createBillingPortalSession() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL");
  }

  const user = await currentUser();
  const metadata = user?.privateMetadata as BillingMetadata | undefined;
  const customerId =
    typeof metadata?.stripeCustomerId === "string"
      ? metadata.stripeCustomerId
      : undefined;

  if (!customerId) {
    redirect("/");
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: appUrl,
  });

  redirect(session.url);
}

function giftwareAmountCents(value: FormDataEntryValue | null): number {
  const numericValue =
    typeof value === "string" ? Number(value.replace(",", ".")) : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return MIN_GIFTWARE_AMOUNT_CENTS;
  }

  return Math.max(
    MIN_GIFTWARE_AMOUNT_CENTS,
    Math.round(numericValue * 100),
  );
}
