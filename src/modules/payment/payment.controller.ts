import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import { STRIPE_PUBLISHABLE_KEY } from "../../config/stripe";
import * as paymentService from "./payment.service";
import {
  createSetupIntentSchema,
  createPaymentIntentSchema,
  savePaymentMethodSchema,
  processAgreementPaymentSchema,
} from "./payment.validation";

/**
 * GET /api/v1/payments/config
 * Returns Stripe publishable key to client apps.
 */
export async function handleGetConfig(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json({
      success: true,
      message: "Stripe configuration retrieved successfully.",
      data: {
        publishableKey: STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/payments/create-setup-intent
 * Generates SetupIntent client_secret for Stripe Elements on agreement signing page.
 */
export async function handleCreateSetupIntent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = createSetupIntentSchema.safeParse(req.body);
    const input = parseResult.success ? parseResult.data : undefined;

    const setupIntentData = await paymentService.createSetupIntent(req.user.id, input);

    res.status(200).json({
      success: true,
      message: "SetupIntent created successfully.",
      data: setupIntentData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/payments/create-payment-intent
 * Generates PaymentIntent client_secret for direct charge.
 */
export async function handleCreatePaymentIntent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = createPaymentIntentSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid payment intent parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const paymentIntentData = await paymentService.createPaymentIntent(
      req.user.id,
      parseResult.data
    );

    res.status(200).json({
      success: true,
      message: "PaymentIntent created successfully.",
      data: paymentIntentData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/payments/save-payment-method
 * Attaches a confirmed PaymentMethod (pm_...) to the client.
 */
export async function handleSavePaymentMethod(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = savePaymentMethodSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid payment method parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await paymentService.savePaymentMethod(
      req.user.id,
      parseResult.data.paymentMethodId,
      parseResult.data.setAsDefault
    );

    res.status(200).json({
      success: true,
      message: "Payment method attached successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/payments/payment-methods
 * Retrieves saved cards for authenticated user.
 */
export async function handleGetPaymentMethods(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const result = await paymentService.getPaymentMethods(req.user.id);

    res.status(200).json({
      success: true,
      message: "Payment methods retrieved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/payments/billing-info
 * Returns full billing details, active plan, next payment date, and invoice history for dashboard.
 */
export async function handleGetBillingOverview(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const billingOverview = await paymentService.getBillingOverview(req.user.id);

    res.status(200).json({
      success: true,
      message: "Billing information retrieved successfully.",
      data: billingOverview,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/payments/process-agreement-payment
 * Finalize agreement with Stripe payment method and activate quarterly membership.
 */
export async function handleProcessAgreementPayment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = processAgreementPaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid agreement payment parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await paymentService.processAgreementPayment(
      req.user.id,
      parseResult.data
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/payments/webhook
 * Public endpoint for Stripe webhook events.
 */
export async function handleWebhook(
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) {
      res.status(400).json({ success: false, message: "Missing stripe-signature header." });
      return;
    }

    const rawBody = req.rawBody || req.body;
    const result = await paymentService.handleStripeWebhook(signature, rawBody);

    res.status(200).json(result);
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Webhook handling error",
    });
  }
}
