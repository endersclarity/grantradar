import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

export async function POST(request: NextRequest) {
  const { org_id } = await request.json();

  if (!org_id) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, email, name, tier")
    .eq("id", org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  if (org.tier === "pro") {
    return NextResponse.json({ error: "Already on Pro tier" }, { status: 400 });
  }

  const baseUrl = process.env.BASE_URL || "https://grantradar-sable.vercel.app";

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: org.email,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/?upgraded=success`,
    cancel_url: `${baseUrl}/?upgraded=cancelled`,
    metadata: {
      org_id: org.id,
    },
  });

  return NextResponse.json({ url: session.url });
}
