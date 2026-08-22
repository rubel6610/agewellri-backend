import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleGetActivePlans,
  handleGetAllAdminPlans,
  handleGetAdminPlanById,
  handleCreatePlan,
  handleUpdatePlan,
  handleChangePlanStatus,
  handleGetAllServices,
  handleCreateService,
  handleUpdateService,
} from "./plan.controller";

const router = Router();

// Public / Client routes
router.get("/active", handleGetActivePlans);

// Admin Plan Management
router.get("/admin/all", authenticate, handleGetAllAdminPlans);
router.get("/admin/:id", authenticate, handleGetAdminPlanById);
router.post("/admin", authenticate, handleCreatePlan);
router.put("/admin/:id", authenticate, handleUpdatePlan);
router.patch("/admin/:id/status", authenticate, handleChangePlanStatus);

// Admin Service Catalog
router.get("/services/all", authenticate, handleGetAllServices);
router.post("/services", authenticate, handleCreateService);
router.put("/services/:id", authenticate, handleUpdateService);

export default router;
