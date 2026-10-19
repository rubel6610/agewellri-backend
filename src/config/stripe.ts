import "dotenv/config";
import Stripe from "stripe";
import prisma from "../lib/prisma";
import { decryptString } from "../utils/crypto.util";

export interface StripeCredentials {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  isLiveMode: boolean;
  isConfigured: boolean;
  source: "db" | "env" | "none";
}

let cachedCredentials: StripeCredentials = {
  secretKey: process.env.STRIPE_KEY || process.env.STRIPE_SECRET_KEY || "",
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  isLiveMode:
    (process.env.STRIPE_KEY || "").startsWith("sk_live_") ||
    (process.env.STRIPE_KEY || "").startsWith("rk_live_"),
  isConfigured: Boolean(
    (process.env.STRIPE_KEY || process.env.STRIPE_SECRET_KEY) &&
      process.env.STRIPE_PUBLISHABLE_KEY,
  ),
  source:
    process.env.STRIPE_KEY || process.env.STRIPE_SECRET_KEY ? "env" : "none",
};

let cachedStripe: Stripe = new Stripe(
  cachedCredentials.secretKey || "dummy_key",
  {
    apiVersion: "2026-07-29.dahlia" as any,
    typescript: true,
  },
);

/**
 * Sync active Stripe credentials from Database with fallback to .env.
 * Invalidates and updates in-memory cached Stripe client with zero downtime.
 */
export async function syncStripeConfigFromDb(): Promise<StripeCredentials> {
  try {
    const dbSetting = await (prisma as any).paymentGatewaySetting.findUnique({
      where: { provider: "STRIPE" },
    });

    if (
      dbSetting &&
      dbSetting.isActive &&
      (dbSetting.secretKey || dbSetting.publishableKey)
    ) {
      const decryptedSec = dbSetting.secretKey
        ? decryptString(dbSetting.secretKey)
        : null;
      const decryptedWh = dbSetting.webhookSecret
        ? decryptString(dbSetting.webhookSecret)
        : null;

      const secKey =
        decryptedSec ||
        process.env.STRIPE_KEY ||
        process.env.STRIPE_SECRET_KEY ||
        "";
      const pubKey =
        dbSetting.publishableKey || process.env.STRIPE_PUBLISHABLE_KEY || "";
      const whSec =
        decryptedWh || process.env.STRIPE_WEBHOOK_SECRET || "";

      cachedCredentials = {
        secretKey: secKey,
        publishableKey: pubKey,
        webhookSecret: whSec,
        isLiveMode: dbSetting.isLiveMode ?? secKey.startsWith("sk_live_"),
        isConfigured: Boolean(secKey && pubKey),
        source: "db",
      };
    } else {
      const envKey =
        process.env.STRIPE_KEY || process.env.STRIPE_SECRET_KEY || "";
      const envPub = process.env.STRIPE_PUBLISHABLE_KEY || "";
      const envWh = process.env.STRIPE_WEBHOOK_SECRET || "";

      cachedCredentials = {
        secretKey: envKey,
        publishableKey: envPub,
        webhookSecret: envWh,
        isLiveMode:
          envKey.startsWith("sk_live_") || envKey.startsWith("rk_live_"),
        isConfigured: Boolean(envKey && envPub),
        source: envKey ? "env" : "none",
      };
    }

    // Reinitialize Stripe SDK client with the active key
    cachedStripe = new Stripe(cachedCredentials.secretKey || "dummy_key", {
      apiVersion: "2026-07-29.dahlia" as any,
      typescript: true,
    });

    return cachedCredentials;
  } catch (err: any) {
    console.warn(
      "⚠️ Failed to sync Stripe config from DB, using fallback:",
      err.message,
    );
    return cachedCredentials;
  }
}

// Initial sync triggered at startup asynchronously
syncStripeConfigFromDb().catch((e) => {
  console.warn("⚠️ Initial Stripe DB config sync failed:", e.message);
});

export const getActiveStripeCredentials = async (): Promise<StripeCredentials> => {
  if (cachedCredentials.source === "env") {
    // Attempt DB sync if we only have env cached
    await syncStripeConfigFromDb();
  }
  return cachedCredentials;
};

export const getActivePublishableKey = async (): Promise<string> => {
  const creds = await getActiveStripeCredentials();
  return creds.publishableKey;
};

export const getActiveWebhookSecret = async (): Promise<string> => {
  const creds = await getActiveStripeCredentials();
  return creds.webhookSecret;
};

export const getStripePublishableKeySync = (): string => {
  return cachedCredentials.publishableKey;
};

export const getStripeWebhookSecretSync = (): string => {
  return cachedCredentials.webhookSecret;
};

/**
 * Proxy that delegates all Stripe API calls to the currently active cached Stripe instance.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop: keyof Stripe) {
    return (cachedStripe as any)[prop];
  },
});

export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
