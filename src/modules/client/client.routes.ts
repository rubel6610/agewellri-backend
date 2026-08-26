import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse } from "../../middlewares/cache.middleware";
import {
  handleGetAllAdminClients,
  handleGetAdminClientById,
} from "./client.controller";

const router = Router();

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
