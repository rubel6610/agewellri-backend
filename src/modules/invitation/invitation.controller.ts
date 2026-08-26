import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as invitationService from "./invitation.service";
import {
  createInvitationSchema,
  verifyInvitationTokenSchema,
  acceptInvitationSchema,
  saveOnboardingProgressSchema,
} from "./invitation.validation";
import sendResponse from "../../utils/sendResponse";

/**
 * POST /api/v1/invitations/send
 * Admin sends welcome invitation link to client
 */
export async function handleSendInvitation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Only administrators can send welcome invitations.",
      });
      return;
    }

    const parseResult = createInvitationSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await invitationService.sendWelcomeInvitation(req.user.id, parseResult.data);
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Welcome invitation dispatched successfully.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to send invitation.",
    });
  }
}

/**
 * GET /api/v1/invitations/verify/:token
 * Public endpoint to verify invitation validity
 */
export async function handleVerifyInvitation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = verifyInvitationTokenSchema.safeParse(req.params);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Invalid invitation token format.",
      });
      return;
    }

    const result = await invitationService.verifyInvitationToken(parseResult.data.token);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Invitation is valid.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Invalid or expired invitation link.",
    });
  }
}

/**
 * POST /api/v1/invitations/accept
 * Public endpoint to create account via welcome invitation
 */
export async function handleAcceptInvitation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = acceptInvitationSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await invitationService.acceptInvitation(parseResult.data);
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Account created successfully. Welcome to AgeWellRI!",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to accept invitation.",
    });
  }
}

/**
 * GET /api/v1/invitations/admin/all
 * Admin lists all invitations
 */
export async function handleGetAdminInvitations(
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

    const invitations = await invitationService.getAdminInvitations();
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Invitations retrieved successfully.",
      data: invitations,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to fetch invitations.",
    });
  }
}

/**
 * POST /api/v1/invitations/admin/:id/revoke
 */
export async function handleRevokeInvitation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Unauthorized.",
      });
      return;
    }

    const result = await invitationService.revokeInvitation(req.user.id, req.params.id as string);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Invitation revoked.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to revoke invitation.",
    });
  }
}

/**
 * POST /api/v1/invitations/admin/:id/resend
 */
export async function handleResendInvitation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Unauthorized.",
      });
      return;
    }

    const result = await invitationService.resendInvitation(req.user.id, req.params.id as string);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Invitation resent.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to resend invitation.",
    });
  }
}

/**
 * GET /api/v1/onboarding/state
 * Client retrieves saved onboarding state to resume
 */
export async function handleGetOnboardingState(
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

    const state = await invitationService.getOnboardingState(req.user.id);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Onboarding state retrieved.",
      data: state,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to retrieve onboarding state.",
    });
  }
}

/**
 * POST /api/v1/onboarding/save-progress
 * Client auto-saves partial progress
 */
export async function handleSaveOnboardingProgress(
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

    const parseResult = saveOnboardingProgressSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Invalid progress payload.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await invitationService.saveOnboardingProgress(req.user.id, parseResult.data);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Progress saved.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to save onboarding progress.",
    });
  }
}
