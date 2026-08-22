import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import {
  registerSchema,
  loginSchema,
  requestSmsOtpSchema,
  verifySmsOtpSchema,
  changePasswordSchema,
  updateProfileSchema,
  submitAgreementSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from "./auth.validation";
import * as authService from "./auth.service";
import sendResponse from "../../utils/sendResponse";

/**
 * POST /api/v1/auth/register
 */
export async function handleRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.registerUser(parseResult.data);
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "User registered successfully",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Registration failed",
    });
  }
}

/**
 * POST /api/v1/auth/login
 */
export async function handleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.loginUser(parseResult.data);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 401,
      success: false,
      message: error.message || "Authentication failed",
    });
  }
}

/**
 * POST /api/v1/auth/sms-otp/request
 */
export async function handleRequestSmsOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = requestSmsOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.requestSmsOtp(parseResult.data);
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
      message: error.message || "Failed to request SMS OTP",
    });
  }
}

/**
 * POST /api/v1/auth/sms-otp/verify
 */
export async function handleVerifySmsOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = verifySmsOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.verifySmsOtp(parseResult.data);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "SMS authentication successful",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 401,
      success: false,
      message: error.message || "Failed to verify SMS OTP",
    });
  }
}

/**
 * GET /api/v1/auth/me
 */
export async function handleGetMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const userProfile = await authService.getUserProfile(req.user.id);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "User profile retrieved successfully",
      data: userProfile,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to fetch user profile",
    });
  }
}

/**
 * PATCH /api/v1/auth/profile
 */
export async function handleUpdateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const updatedProfile = await authService.updateUserProfile(req.user.id, parseResult.data);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Profile updated successfully",
      data: updatedProfile,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to update profile",
    });
  }
}

/**
 * POST /api/v1/auth/agreement
 */
export async function handleSubmitAgreement(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const parseResult = submitAgreementSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.submitAgreement(req.user.id, parseResult.data);
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Client Service Agreement signed and executed successfully",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Failed to submit agreement",
    });
  }
}

/**
 * GET /api/v1/auth/my-agreement
 */
export async function handleGetMyAgreement(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const agreement = await authService.getMyAgreement(req.user.id);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Agreement retrieved successfully",
      data: agreement,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve agreement",
    });
  }
}

/**
 * POST /api/v1/auth/forgot-password
 */
export async function handleForgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = forgotPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.forgotPassword(parseResult.data);
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
      message: error.message || "Failed to process forgot password request",
    });
  }
}

/**
 * POST /api/v1/auth/verify-otp
 */
export async function handleVerifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = verifyOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.verifyOtp(parseResult.data);
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
      message: error.message || "Invalid or expired verification code",
    });
  }
}

/**
 * POST /api/v1/auth/reset-password
 */
export async function handleResetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.resetPassword(parseResult.data);
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
      message: error.message || "Password reset failed",
    });
  }
}

/**
 * PATCH /api/v1/auth/change-password
 */
export async function handleChangePassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.changeUserPassword(req.user.id, parseResult.data);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 400,
      success: false,
      message: error.message || "Password change failed",
    });
  }
}

/**
 * POST /api/v1/auth/refresh-token
 */
export async function handleRefreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawRefreshToken =
      req.body?.refreshToken ||
      req.headers["x-refresh-token"] ||
      (req.cookies && req.cookies.refreshToken);

    const parseResult = refreshTokenSchema.safeParse({ refreshToken: rawRefreshToken });
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Refresh token is required.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await authService.refreshTokens(parseResult.data);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Token refreshed successfully",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 401,
      success: false,
      message: error.message || "Invalid or expired refresh token",
    });
  }
}
