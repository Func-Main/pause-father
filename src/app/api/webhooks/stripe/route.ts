import { NextResponse } from "next/server";
import Stripe from "stripe";
import { fulfillCheckoutSession } from "@/lib/billing/fulfillment";
import { getStripe } from "@/lib/billing/stripe";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error("Stripe webhook configuration missing", {
      hasSignature: Boolean(signature),
      hasWebhookSecret: Boolean(webhookSecret),
    });
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
  } catch (error) {
    console.error("Stripe webhook signature verification failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.info("Stripe webhook received", {
    eventId: event.id,
    eventType: event.type,
  });

  switch (event.type) {
    case "checkout.session.completed":
      await fulfillCheckoutSession({
        session: event.data.object as Stripe.Checkout.Session,
      });
      console.info("Stripe checkout session fulfillment handled", {
        eventId: event.id,
        sessionId: (event.data.object as Stripe.Checkout.Session).id,
      });
      break;
  }

  return NextResponse.json({ received: true });
}
