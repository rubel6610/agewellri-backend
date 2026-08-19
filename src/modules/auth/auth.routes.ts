import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleUpdateProfile,
  handleSubmitAgreement,
  handleGetMyAgreement,
  handleChangePassword,
} from "./auth.controller";

const router = Router();

// Public routes
router.post("/register", handleRegister);
router.post("/login", handleLogin);

// Protected routes (require valid JWT)
router.get("/me", authenticate, handleGetMe);
router.patch("/profile", authenticate, handleUpdateProfile);
router.post("/agreement", authenticate, handleSubmitAgreement);
router.get("/my-agreement", authenticate, handleGetMyAgreement);
router.patch("/change-password", authenticate, handleChangePassword);

export default router;

