import "dotenv/config";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_KEY || process.env.STRIPE_SECRET_KEY || "";

if (!stripeSecretKey) {
  console.warn("⚠️ Warning: STRIPE_KEY or STRIPE_SECRET_KEY is not defined in environment variables.");
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2026-07-29.dahlia" as any,
  typescript: true,
});

export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
