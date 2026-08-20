import { UserRole, UserStatus, OnboardingStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { hashPassword, comparePassword } from "../../utils/password";
import { generateToken, generateAuthTokens, verifyRefreshToken } from "../../utils/jwt";
import { sendPasswordResetOtpEmail } from "../../utils/email";
import { processAgreementPayment } from "../payment/payment.service";
import {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  UpdateProfileInput,
  SubmitAgreementInput,
  ForgotPasswordInput,
  VerifyOtpInput,
  ResetPasswordInput,
  RefreshTokenInput,
} from "./auth.validation";

/**
 * Helper to compute agreement status flags.
 */
function computeAgreementFlags(user: { role: UserRole; client?: any }) {
  if (user.role !== UserRole.CLIENT) {
    return {
      hasCompletedAgreement: true,
      requiresAgreement: false,
    };
  }

  const client = user.client;
  const hasCompleted = Boolean(
    client?.hasCompletedAgreement ||
      client?.onboardingStatus === OnboardingStatus.AGREEMENT_SIGNED ||
      client?.onboardingStatus === OnboardingStatus.ACTIVE ||
      client?.onboardingStatus === OnboardingStatus.PAYMENT_PENDING ||
      client?.onboardingStatus === OnboardingStatus.PAYMENT_COMPLETED ||
      (client?.agreements &&
        client.agreements.some(
          (a: any) => a.status === "SIGNED" || a.status === "EXECUTED"
        ))
  );

  return {
    hasCompletedAgreement: hasCompleted,
    requiresAgreement: !hasCompleted,
  };
}

/**
 * Register a new user (and auto-create Client profile if role is CLIENT).
 */
export async function registerUser(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (existingUser) {
    throw new Error("A user with this email already exists.");
  }

  const hashedPassword = await hashPassword(input.password);
  const role = input.role || UserRole.CLIENT;

  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash: hashedPassword,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: role,
      status: UserStatus.ACTIVE,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  // If role is CLIENT, create associated Client profile with unique clientNumber
  let client = null;
  if (role === UserRole.CLIENT) {
    const clientCount = await prisma.client.count();
    const clientNumber = `AW-${1001 + clientCount}`;

    client = await prisma.client.create({
      data: {
        userId: user.id,
        clientNumber: clientNumber,
        address: input.address || "TBD",
        city: input.city || "TBD",
        state: input.state || "RI",
        postalCode: input.postalCode || "00000",
        country: "USA",
        onboardingStatus: OnboardingStatus.ACCOUNT_CREATED,
        hasCompletedAgreement: false,
      },
    });
  }

  const authTokens = generateAuthTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const fullUserProfile = await getUserProfile(user.id);

  return {
    token: authTokens.token,
    refreshToken: authTokens.refreshToken,
    user: fullUserProfile,
    client: fullUserProfile.client,
  };
}

/**
 * Authenticate user with email and password.
 */
export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (!user || !user.passwordHash) {
    throw new Error("Invalid email or password.");
  }

  const isPasswordValid = await comparePassword(input.password, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error("Invalid email or password.");
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new Error(`Your account is currently ${user.status.toLowerCase()}.`);
  }

  // Update lastLoginAt timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const authTokens = generateAuthTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const fullUserProfile = await getUserProfile(user.id);

  return {
    token: authTokens.token,
    refreshToken: authTokens.refreshToken,
    user: fullUserProfile,
  };
}

/**
 * Fetch authenticated user profile with computed agreement flags.
 */
export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      client: {
        include: {
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      technician: true,
    },
  });

  if (!user) {
    throw new Error("User profile not found.");
  }

  const flags = computeAgreementFlags(user);

  return {
    ...user,
    ...flags,
  };
}

/**
 * Update authenticated user profile (email cannot be modified).
 */
export async function updateUserProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { client: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  // Update User table fields (firstName, lastName, phone)
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.firstName !== undefined && { firstName: input.firstName.trim() }),
      ...(input.lastName !== undefined && { lastName: input.lastName.trim() }),
      ...(input.phone !== undefined && { phone: input.phone }),
    },
  });

  // If user has a client profile or client fields are provided
  if (user.role === UserRole.CLIENT) {
    const clientData: Record<string, unknown> = {};
    if (input.address !== undefined) clientData.address = input.address;
    if (input.city !== undefined) clientData.city = input.city;
    if (input.state !== undefined) clientData.state = input.state;
    if (input.postalCode !== undefined) clientData.postalCode = input.postalCode;
    if (input.emergencyContactName !== undefined) clientData.emergencyContactName = input.emergencyContactName;
    if (input.emergencyContactPhone !== undefined) clientData.emergencyContactPhone = input.emergencyContactPhone;
    if (input.emergencyContactRelation !== undefined) clientData.emergencyContactRelation = input.emergencyContactRelation;

    if (Object.keys(clientData).length > 0) {
      if (user.client) {
        await prisma.client.update({
          where: { id: user.client.id },
          data: clientData,
        });
      } else {
        const clientCount = await prisma.client.count();
        const clientNumber = `AW-${1001 + clientCount}`;
        await prisma.client.create({
          data: {
            userId: user.id,
            clientNumber,
            address: input.address || "TBD",
            city: input.city || "TBD",
            state: input.state || "RI",
            postalCode: input.postalCode || "00000",
            emergencyContactName: input.emergencyContactName,
            emergencyContactPhone: input.emergencyContactPhone,
            emergencyContactRelation: input.emergencyContactRelation,
          },
        });
      }
    }
  }

  return getUserProfile(userId);
}

/**
 * Submit initial client service agreement.
 */
export async function submitClientAgreement(userId: string, input: SubmitAgreementInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { client: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  if (user.role !== UserRole.CLIENT) {
    throw new Error("Only clients are required to sign the client service agreement.");
  }

  // Update / create client
  let clientId = user.client?.id;
  if (!clientId) {
    const clientCount = await prisma.client.count();
    const clientNumber = `AW-${1001 + clientCount}`;
    const newClient = await prisma.client.create({
      data: {
        userId: user.id,
        clientNumber,
        address: input.address,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: "USA",
        dateOfBirth: input.dob,
        primaryContactName: input.primaryContactName,
        primaryContactPhone: input.primaryContactPhone,
        primaryContactEmail: input.primaryContactEmail,
        primaryContactRelation: input.primaryContactRelation,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactRelation: input.emergencyContactRelation,
        selectedPlan: input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
      },
    });
    clientId = newClient.id;
  } else {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        address: input.address,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        dateOfBirth: input.dob,
        primaryContactName: input.primaryContactName,
        primaryContactPhone: input.primaryContactPhone,
        primaryContactEmail: input.primaryContactEmail,
        primaryContactRelation: input.primaryContactRelation,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactRelation: input.emergencyContactRelation,
        selectedPlan: input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
      },
    });
  }

  // Calculate plan price
  const basePrice = input.selectedPlan === "GUARDIAN_PLUS" ? 1800 : 99;
  const finalPrice = input.hasCleaningAddon ? basePrice + 50 : basePrice;

  // Create ServiceAgreement record
  const agreement = await (prisma.serviceAgreement.create as any)({
    data: {
      clientId,
      templateVersion: "v1.0",
      status: "SIGNED",
      selectedPlan: input.selectedPlan,
      planPrice: finalPrice,
      hasCleaningAddon: input.hasCleaningAddon,
      clientPrintedName: input.clientPrintedName,
      authorizedRepName: input.authorizedRepName,
      relationshipToClient: input.relationshipToClient,
      clientSignature: input.clientSignature,
      agreementDate: new Date(input.agreementDate),
      signedAt: new Date(),
      executedAt: new Date(),
      stripePaymentMethodId: input.paymentMethodId || null,
      stripeSetupIntentId: input.setupIntentId || null,
    },
  });

  // Update User phone
  if (input.phone) {
    await prisma.user.update({
      where: { id: userId },
      data: { phone: input.phone },
    });
  }

  // If payment method or setup intent was provided, provision active subscription & billing
  if (input.paymentMethodId || input.setupIntentId) {
    try {
      await processAgreementPayment(userId, {
        agreementId: agreement.id,
        paymentMethodId: input.paymentMethodId || undefined,
        setupIntentId: input.setupIntentId || undefined,
        selectedPlan: input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
      });
    } catch (paymentErr) {
      console.warn("⚠️ Agreement payment provisioning notice:", paymentErr);
    }
  }

  const updatedProfile = await getUserProfile(userId);

  return {
    agreement,
    user: updatedProfile,
  };
}

/**
 * Fetch full active client agreement for the current user.
 */
export async function getMyAgreement(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  const client = user.client as any;
  const latestAgreement = client?.agreements?.[0] as any;
  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return {
    id: latestAgreement?.id,
    templateVersion: latestAgreement?.templateVersion,
    status: latestAgreement?.status || (client?.hasCompletedAgreement ? "SIGNED" : "DRAFT"),
    selectedPlan: latestAgreement?.selectedPlan || client?.selectedPlan || "ESSENTIAL_GUARD",
    planPrice: latestAgreement?.planPrice || (client?.selectedPlan === "GUARDIAN_PLUS" ? 1800 : 99),
    hasCleaningAddon: latestAgreement?.hasCleaningAddon || client?.hasCleaningAddon || false,
    clientFullName: fullName,
    clientPrintedName: latestAgreement?.clientPrintedName || fullName,
    authorizedRepName: latestAgreement?.authorizedRepName || client?.primaryContactName || null,
    relationshipToClient: latestAgreement?.relationshipToClient || client?.primaryContactRelation || null,
    clientSignature: latestAgreement?.clientSignature || null,
    agreementDate: latestAgreement?.agreementDate || latestAgreement?.signedAt || latestAgreement?.createdAt || new Date(),
    signedAt: latestAgreement?.signedAt || null,
    executedAt: latestAgreement?.executedAt || null,
    address: client?.address ,
    city: client?.city ,
    state: client?.state ,
    postalCode: client?.postalCode ,
    phone: user.phone ,
    dob: client?.dateOfBirth,
    email: user.email,
    primaryContactName: client?.primaryContactName,
    primaryContactPhone: client?.primaryContactPhone ,
    primaryContactEmail: client?.primaryContactEmail,
    primaryContactRelation: client?.primaryContactRelation,
    emergencyContactName: client?.emergencyContactName,
    emergencyContactPhone: client?.emergencyContactPhone,
    emergencyContactRelation: client?.emergencyContactRelation,
    clientNumber: client?.clientNumber,
    stripePaymentMethodId: latestAgreement?.stripePaymentMethodId || client?.stripePaymentMethodId || null,
    stripeSetupIntentId: latestAgreement?.stripeSetupIntentId || null,
    cardBrand: client?.cardBrand || null,
    cardLast4: client?.cardLast4 || null,
  };
}

/**
 * Request Password Reset OTP
 */
export async function forgotPassword(input: ForgotPasswordInput) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("No account found with this email address.");
  }

  // Generate 6-digit numeric OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await (prisma.user.update as any)({
    where: { id: user.id },
    data: {
      resetOtp: otp,
      resetOtpExpires: expiresAt,
    },
  });

  // Send branded OTP Email using Nodemailer
  await sendPasswordResetOtpEmail({
    to: user.email,
    name: user.firstName,
    otp,
    expiresInMinutes: 10,
  });

  return {
    message: "A 6-digit verification code has been sent to your email.",
    email: user.email,
  };
}

/**
 * Verify 6-digit OTP code
 */
export async function verifyOtp(input: VerifyOtpInput) {
  const email = input.email.trim().toLowerCase();
  const user = await (prisma.user.findUnique as any)({
    where: { email },
  });

  if (!user) {
    throw new Error("User account not found.");
  }

  if (!user.resetOtp || user.resetOtp !== input.otp.trim()) {
    throw new Error("Invalid verification code. Please check your email and try again.");
  }

  if (!user.resetOtpExpires || new Date(user.resetOtpExpires) < new Date()) {
    throw new Error("Verification code has expired. Please request a new code.");
  }

  return {
    success: true,
    message: "Verification code confirmed.",
    email: user.email,
  };
}

/**
 * Reset password using verified OTP code
 */
export async function resetPassword(input: ResetPasswordInput) {
  const email = input.email.trim().toLowerCase();
  const user = await (prisma.user.findUnique as any)({
    where: { email },
  });

  if (!user) {
    throw new Error("User account not found.");
  }

  if (!user.resetOtp || user.resetOtp !== input.otp.trim()) {
    throw new Error("Invalid verification code.");
  }

  if (!user.resetOtpExpires || new Date(user.resetOtpExpires) < new Date()) {
    throw new Error("Verification code has expired. Please request a new code.");
  }

  const newHashedPassword = await hashPassword(input.newPassword);

  await (prisma.user.update as any)({
    where: { id: user.id },
    data: {
      passwordHash: newHashedPassword,
      resetOtp: null,
      resetOtpExpires: null,
    },
  });

  return {
    success: true,
    message: "Your password has been reset successfully. You can now log in with your new password.",
  };
}

/**
 * Change password for authenticated user.
 */
export async function changeUserPassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.passwordHash) {
    throw new Error("User not found.");
  }

  const isOldPasswordValid = await comparePassword(input.oldPassword, user.passwordHash);
  if (!isOldPasswordValid) {
    throw new Error("Incorrect current password.");
  }

  const newHashedPassword = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHashedPassword },
  });

  return { message: "Password updated successfully." };
}

/**
 * Refresh user access token and revalidate session.
 */
export async function refreshUserToken(input: RefreshTokenInput) {
  let decoded: any;
  try {
    decoded = verifyRefreshToken(input.refreshToken);
  } catch (error) {
    throw new Error("Invalid or expired refresh token. Please sign in again.");
  }

  if (!decoded || !decoded.userId) {
    throw new Error("Invalid refresh token payload.");
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
  });

  if (!user) {
    throw new Error("User account no longer exists.");
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new Error(`Your account is currently ${user.status.toLowerCase()}.`);
  }

  const authTokens = generateAuthTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const fullUserProfile = await getUserProfile(user.id);

  return {
    token: authTokens.token,
    refreshToken: authTokens.refreshToken,
    user: fullUserProfile,
  };
}

