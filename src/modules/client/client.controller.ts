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

/**
 * GET /api/v1/clients/access-methods
 */
export async function handleGetClientAccessMethods(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const methods = await clientService.getClientAccessMethods(req.user.id);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Access methods retrieved successfully.",
      data: methods,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to retrieve access methods.",
    });
  }
}

/**
 * POST /api/v1/clients/access-methods
 */
export async function handleAddClientAccessMethod(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const { type, title, code, instructions, isDefault } = req.body;
    if (!type || !title) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Access method type and title are required.",
      });
      return;
    }

    const result = await clientService.addClientAccessMethod(req.user.id, {
      type,
      title,
      code,
      instructions,
      isDefault,
    });

    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Access method added successfully.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to add access method.",
    });
  }
}

/**
 * PUT /api/v1/clients/access-methods/:id
 */
export async function handleUpdateClientAccessMethod(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const result = await clientService.updateClientAccessMethod(
      req.user.id,
      req.params.id as string,
      req.body
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Access method updated successfully.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to update access method.",
    });
  }
}

/**
 * DELETE /api/v1/clients/access-methods/:id
 */
export async function handleDeleteClientAccessMethod(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const result = await clientService.deleteClientAccessMethod(
      req.user.id,
      req.params.id as string
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Access method deleted successfully.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to delete access method.",
    });
  }
}

/**
 * PATCH /api/v1/clients/access-methods/:id/default
 */
export async function handleSetDefaultClientAccessMethod(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      sendResponse(res, {
        statusCode: 401,
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const result = await clientService.setDefaultClientAccessMethod(
      req.user.id,
      req.params.id as string
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Default access method updated successfully.",
      data: result,
    });
  } catch (error: any) {
    sendResponse(res, {
      statusCode: 500,
      success: false,
      message: error.message || "Failed to set default access method.",
    });
  }
}

