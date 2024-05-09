import { stripe } from "@/lib/stripe";
import { getLeadEvent, recordSale } from "@/lib/tinybird";
import { nanoid } from "@dub/utils";
import type Stripe from "stripe";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// "customer.created"
const SUPPORTED_STRIPE_EVENTS = ["charge.succeeded"];

export const POST = async (req: Request) => {
  const buf = await req.text();
  const sig = req.headers.get("Stripe-Signature");

  if (!sig || !webhookSecret) {
    return new Response("Invalid request", {
      status: 400,
    });
  }

  try {
    const event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);

    // Ignore unsupported events
    if (!SUPPORTED_STRIPE_EVENTS.includes(event.type)) {
      return new Response("OK", {
        status: 200,
      });
    }

    switch (event.type) {
      case "charge.succeeded":
        await handleChargeSucceeded(event);
        break;
    }

    return new Response("OK", {
      status: 200,
    });
  } catch (error: any) {
    console.log("Stripe webhook error:", error);

    return new Response("Error", {
      status: 400,
    });
  }
};

// Handle the "charge.succeeded" event
async function handleChargeSucceeded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;

  console.log("event", charge);

  if (!charge.customer) {
    return;
  }

  // Find customer details using charge.customer
  const customer = (await stripe.customers.retrieve(
    charge.customer as string,
  )) as Stripe.Customer;

  const customerId = customer.metadata?.customerId || null;

  if (!customerId) {
    return;
  }

  console.log("customer", customer);

  // Check customerId exists in TB

  // TODO: Update clickId
  const leadEvent = await getLeadEvent({ customerId });

  if (!leadEvent || leadEvent.data.length === 0) {
    return;
  }

  await recordSale({
    ...leadEvent.data[0],
    event_id: nanoid(16),
    payment_processor: "stripe",
    product_id: "",
    amount: charge.amount,
    currency: charge.currency,
    recurring: true, // TODO: Update this
    recurring_interval: "month", // TODO: Update this
    recurring_interval_count: 1, // TODO: Update this
    refunded: false,
    metadata: {
      charge,
    },
  });
}
