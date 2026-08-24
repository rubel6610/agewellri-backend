import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse } from "../../middlewares/cache.middleware";
import {
  handleGetAllAdminClients,
  handleGetAdminClientById,
} from "./client.controller";

const router = Router();

// Admin Client Routes with in-memory response caching
router.get(
  "/admin/all",
  authenticate,
  cacheResponse({ ttlSeconds: 300, tags: ["clients"], isPrivate: true }),
  handleGetAllAdminClients
);

router.get(
  "/admin/:id",
  authenticate,
  cacheResponse({ ttlSeconds: 300, tags: ["clients"], isPrivate: true }),
  handleGetAdminClientById
);

export default router;
