import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await syncCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
  }

  return NextResponse.json({ received: true });
}

async function syncCheckoutSession(session: Stripe.Checkout.Session) {
  const clerkUserId = session.metadata?.clerkUserId;

  if (!clerkUserId) {
    return;
  }

  if (session.payment_status !== "paid") {
    return;
  }

  await updateUserBillingMetadata({
    clerkUserId,
    stripeCustomerId:
      typeof session.customer === "string" ? session.customer : undefined,
    stripeCheckoutSessionId: session.id,
    amountTotal: session.amount_total ?? undefined,
    currency: session.currency ?? undefined,
  });
}

async function updateUserBillingMetadata({
  clerkUserId,
  stripeCustomerId,
  stripeCheckoutSessionId,
  amountTotal,
  currency,
}: {
  clerkUserId: string;
  stripeCustomerId?: string;
  stripeCheckoutSessionId: string;
  amountTotal?: number;
  currency?: string;
}) {
  const client = await clerkClient();

  await client.users.updateUserMetadata(clerkUserId, {
    privateMetadata: {
      plan: "paid",
      paymentType: "giftware",
      stripeCustomerId,
      stripeCheckoutSessionId,
      giftwareAmountCents: amountTotal,
      giftwareCurrency: currency,
      paidAt: new Date().toISOString(),
    },
  });
}
