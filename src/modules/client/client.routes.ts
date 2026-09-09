import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse } from "../../middlewares/cache.middleware";
import {
  handleGetAllAdminClients,
  handleGetAdminClientById,
  handleGetAdminDashboardStats,
  handleGetClientAccessMethods,
  handleAddClientAccessMethod,
  handleUpdateClientAccessMethod,
  handleDeleteClientAccessMethod,
  handleSetDefaultClientAccessMethod,
} from "./client.controller";

const router = Router();

// Member Portal: Client Access Methods Management
router.get("/access-methods", authenticate, handleGetClientAccessMethods);
router.post("/access-methods", authenticate, handleAddClientAccessMethod);
router.put("/access-methods/:id", authenticate, handleUpdateClientAccessMethod);
router.delete("/access-methods/:id", authenticate, handleDeleteClientAccessMethod);
router.patch("/access-methods/:id/default", authenticate, handleSetDefaultClientAccessMethod);

// Admin Dashboard Analytics & KPI Statistics (Real-time live data)
router.get(
  "/admin/dashboard-stats",
  authenticate,
  handleGetAdminDashboardStats
);

// Admin Client Routes (Real-time live data)
router.get(
  "/admin/all",
  authenticate,
  handleGetAllAdminClients
);

router.get(
  "/admin/:id",
  authenticate,
  handleGetAdminClientById
);

export default router;
