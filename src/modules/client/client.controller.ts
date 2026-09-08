import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as clientService from "./client.service";
import sendResponse from "../../utils/sendResponse";

/**
 * GET /api/v1/clients/admin/all
 */
export async function handleGetAllAdminClients(
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

    const clients = await clientService.getAllAdminClients({
      search: req.query.search as string,
      state: req.query.state as string,
      onboardingStatus: req.query.onboardingStatus as string,
      agreementStatus: req.query.agreementStatus as string,
    });

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Admin clients retrieved successfully.",
      data: clients,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve clients.",
    });
  }
}

/**
 * GET /api/v1/clients/admin/:id
 */
export async function handleGetAdminClientById(
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

    const client = await clientService.getAdminClientById(req.params.id as string);
    if (!client) {
      sendResponse(res, {
        statusCode: 404,
        success: false,
        message: "Client not found.",
      });
      return;
    }

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Admin client details retrieved.",
      data: client,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve client details.",
    });
  }
}

/**
 * GET /api/v1/clients/admin/dashboard-stats
 * Real-time dynamic overview statistics and KPI intelligence.
 */
export async function handleGetAdminDashboardStats(
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

    const stats = await clientService.getAdminDashboardStats();

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Admin dashboard statistics retrieved.",
      data: stats,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve dashboard statistics.",
    });
  }
}
