import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth.middleware";
import { UserRole } from "@prisma/client";
import {
  handleGetWeeklySchedule,
  handleUpdateWeeklySchedule,
  handleGetCalendarSchedule,
  handleGetDateAvailability,
  handleGetScheduleOverrides,
  handleGetScheduleOverrideById,
  handleCreateScheduleOverride,
  handleUpdateScheduleOverride,
  handleDeleteScheduleOverride,
  handlePreviewConflicts,
} from "./schedule.controller";

const router = Router();

// Public / Authenticated Availability Endpoints
router.get("/availability", handleGetDateAvailability);
router.get("/calendar", handleGetCalendarSchedule);
router.get("/weekly", handleGetWeeklySchedule);

// Admin Control Endpoints
router.put("/weekly", authenticate, authorize(UserRole.ADMIN), handleUpdateWeeklySchedule);
router.get("/overrides", authenticate, authorize(UserRole.ADMIN), handleGetScheduleOverrides);
router.post("/overrides", authenticate, authorize(UserRole.ADMIN), handleCreateScheduleOverride);
router.get("/overrides/:id", authenticate, authorize(UserRole.ADMIN), handleGetScheduleOverrideById);
router.patch("/overrides/:id", authenticate, authorize(UserRole.ADMIN), handleUpdateScheduleOverride);
router.put("/overrides/:id", authenticate, authorize(UserRole.ADMIN), handleUpdateScheduleOverride);
router.delete("/overrides/:id", authenticate, authorize(UserRole.ADMIN), handleDeleteScheduleOverride);
router.post("/preview-conflicts", authenticate, authorize(UserRole.ADMIN), handlePreviewConflicts);

export default router;
