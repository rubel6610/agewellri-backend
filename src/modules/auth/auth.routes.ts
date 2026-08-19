import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleUpdateProfile,
  handleSubmitAgreement,
  handleGetMyAgreement,
  handleForgotPassword,
  handleVerifyOtp,
  handleResetPassword,
  handleChangePassword,
  handleRefreshToken,
} from "./auth.controller";

const router = Router();

// Public routes
router.post("/register", handleRegister);
router.post("/login", handleLogin);
router.post("/forgot-password", handleForgotPassword);
router.post("/verify-otp", handleVerifyOtp);
router.post("/reset-password", handleResetPassword);
router.post("/refresh-token", handleRefreshToken);
router.post("/refresh", handleRefreshToken);

// Protected routes (require valid JWT)
router.get("/me", authenticate, handleGetMe);
router.patch("/profile", authenticate, handleUpdateProfile);
router.post("/agreement", authenticate, handleSubmitAgreement);
router.get("/my-agreement", authenticate, handleGetMyAgreement);
router.patch("/change-password", authenticate, handleChangePassword);

export default router;



