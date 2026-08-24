import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as agreementService from "./agreement.service";
import {
  submitAgreementSchema,
  calculateDeadlineSchema,
} from "./agreement.validation";
import sendResponse from "../../utils/sendResponse";

/**
 * GET /api/v1/agreements/templates
 * List all state agreement templates & versions
 */
export async function handleGetAgreementTemplates(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const templates = await agreementService.getAgreementTemplates();
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Agreement templates retrieved.",
      data: templates,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to fetch agreement templates.",
    });
  }
}

/**
 * GET /api/v1/agreements/template/:state
 * Get active agreement template for a state (RI, CT, MA)
 */
export async function handleGetAgreementTemplateByState(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const state = req.params.state as string;
    const templateConfig = await agreementService.getAgreementTemplateByState(state);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "State agreement template retrieved.",
      data: templateConfig,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to fetch state agreement template.",
    });
  }
}

/**
 * GET /api/v1/agreements/calculate-deadline
 * Calculate official 3-business-day cancellation deadline
 */
export async function handleCalculateCancellationDeadline(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = calculateDeadlineSchema.safeParse(req.query);
    const state = parseResult.success ? parseResult.data.state : (req.query.state as string) || "RI";
    const date = parseResult.success ? parseResult.data.date : (req.query.date as string);

    const deadlineResult = await agreementService.calculateCancellationDeadline(state, date);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Cancellation deadline calculated.",
      data: deadlineResult,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to calculate cancellation deadline.",
    });
  }
}

/**
 * POST /api/v1/agreements/sign
 * Sign and execute client service agreement
 */
export async function handleSubmitServiceAgreement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized.",
      });
      return;
    }

    const parseResult = submitAgreementSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Agreement validation failed.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await agreementService.submitServiceAgreement(req.user.id, parseResult.data);
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Client Service Agreement executed successfully.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to execute service agreement.",
    });
  }
}

/**
 * GET /api/v1/agreements/my-agreement
 * Get active client agreement for portal documents
 */
export async function handleGetMyAgreement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized.",
      });
      return;
    }

    const agreement = await agreementService.getClientAgreement(req.user.id);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Agreement retrieved successfully.",
      data: agreement,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve agreement.",
    });
  }
}

/**
 * GET /api/v1/agreements/admin/all
 * Admin list all agreements
 */
export async function handleGetAdminAgreements(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Access restricted to administrators.",
      });
      return;
    }

    const agreements = await agreementService.getAllAdminAgreements({
      state: req.query.state as string,
      status: req.query.status as string,
      search: req.query.search as string,
    });

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Admin agreements retrieved.",
      data: agreements,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve agreements.",
    });
  }
}

/**
 * POST /api/v1/agreements/admin/:id/reminder
 * Admin send signature reminder
 */
export async function handleSendAgreementReminder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Access restricted to administrators.",
      });
      return;
    }

    const result = await agreementService.sendAgreementReminder(req.user.id, req.params.id as string);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to send agreement reminder.",
    });
  }
}
