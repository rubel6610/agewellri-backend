import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleUpdateProfile,
  handleChangePassword,
} from "./auth.controller";

const router = Router();

// Public routes
router.post("/register", handleRegister);
router.post("/login", handleLogin);

// Protected routes (require valid JWT)
router.get("/me", authenticate, handleGetMe);
router.patch("/profile", authenticate, handleUpdateProfile);
router.patch("/change-password", authenticate, handleChangePassword);

export default router;
