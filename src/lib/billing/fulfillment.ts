import { clerkClient } from "@clerk/nextjs/server";
import Stripe from "stripe";

export async function fulfillCheckoutSession({
  session,
}: {
  session: Stripe.Checkout.Session;
}) {
  const sessionClerkUserId = session.metadata?.clerkUserId;

  if (!sessionClerkUserId) {
    console.warn("Skipping checkout fulfillment without Clerk user metadata", {
      sessionId: session.id,
    });
    return;
  }

  if (session.payment_status !== "paid") {
    console.warn("Skipping checkout fulfillment for unpaid session", {
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return;
  }

  const client = await clerkClient();

  await client.users.updateUserMetadata(sessionClerkUserId, {
    privateMetadata: {
      plan: "paid",
      paymentType: session.metadata?.paymentType ?? "giftware",
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : undefined,
      stripeCheckoutSessionId: session.id,
      giftwareAmountCents: session.amount_total ?? undefined,
      giftwareCurrency: session.currency ?? undefined,
      paidAt: new Date().toISOString(),
    },
  });

  console.info("Checkout session fulfilled in Clerk", {
    sessionId: session.id,
    amountTotal: session.amount_total,
  });
}
