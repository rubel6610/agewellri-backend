import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth.middleware";
import { UserRole } from "@prisma/client";
import {
  handleGetActiveOffDays,
  handleGetAdminOffDays,
  handleGetOffDayById,
  handleCreateOffDay,
  handleUpdateOffDay,
  handleDeleteOffDay,
  handlePreviewConflicts,
} from "./off-day.controller";

const router = Router();

// Public / Client / Calendar Routes (Read-only list of active off-days)
router.get("/", handleGetActiveOffDays);

// Admin-only Routes
router.get("/admin", authenticate, authorize(UserRole.ADMIN), handleGetAdminOffDays);
router.post("/preview-conflicts", authenticate, authorize(UserRole.ADMIN), handlePreviewConflicts);
router.post("/", authenticate, authorize(UserRole.ADMIN), handleCreateOffDay);
router.get("/:id", authenticate, authorize(UserRole.ADMIN), handleGetOffDayById);
router.patch("/:id", authenticate, authorize(UserRole.ADMIN), handleUpdateOffDay);
router.put("/:id", authenticate, authorize(UserRole.ADMIN), handleUpdateOffDay);
router.delete("/:id", authenticate, authorize(UserRole.ADMIN), handleDeleteOffDay);

export default router;
