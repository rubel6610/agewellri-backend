import { UserRole, UserStatus, OnboardingStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../../lib/prisma";
import { hashPassword, comparePassword } from "../../utils/password";
import { generateAuthTokens, verifyRefreshToken } from "../../utils/jwt";
import { sendPasswordResetOtpEmail } from "../../utils/email";
import { processAgreementPayment } from "../payment/payment.service";
import { CancellationDeadlineService } from "../agreement/cancellation-deadline.service";
import {
  RegisterInput,
  LoginInput,
  RequestSmsOtpInput,
  VerifySmsOtpInput,
  ChangePasswordInput,
  UpdateProfileInput,
  SubmitAgreementInput,
  ForgotPasswordInput,
  VerifyOtpInput,
  ResetPasswordInput,
  RefreshTokenInput,
} from "./auth.validation";

export type SignerRoleType =
  | "RESIDENT"
  | "FAMILY_MEMBER"
  | "CAREGIVER"
  | "POWER_OF_ATTORNEY"
  | "AUTHORIZED_REPRESENTATIVE";

export type HomeAccessTypeType =
  | "LOCKBOX"
  | "RESIDENT_ANSWERS"
  | "DIGITAL_CODE"
  | "OTHER";

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

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone || null,
      role: input.role || UserRole.CLIENT,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  let client = null;
  if (user.role === UserRole.CLIENT) {
    const clientCount = await prisma.client.count();
    const clientNumber = `AW-${1001 + clientCount}`;

    client = await prisma.client.create({
      data: {
        userId: user.id,
        clientNumber: clientNumber,
        address: input.address || "",
        city: input.city || "",
        state: input.state || "",
        postalCode: input.postalCode || "",
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
    client: fullUserProfile.client,
  };
}

/**
 * Request SMS OTP login code.
 */
export async function requestSmsOtp(input: RequestSmsOtpInput) {
  const cleanPhone = input.phone.replace(/\D/g, "");

  const users: any[] = await prisma.user.findMany({
    where: {
      phone: { not: null },
    },
  });

  const user = users.find((u) => u.phone && u.phone.replace(/\D/g, "").includes(cleanPhone.slice(-10)));

  if (!user) {
    throw new Error("No registered account found with this phone number. Please sign in with email or register.");
  }

  // Rate limit: 60s cooldown
  if (user.smsOtpLastSentAt) {
    const elapsedSeconds = (Date.now() - new Date(user.smsOtpLastSentAt).getTime()) / 1000;
    if (elapsedSeconds < 60) {
      throw new Error(`Please wait ${Math.ceil(60 - elapsedSeconds)} seconds before requesting a new code.`);
    }
  }

  // Generate 6-digit random code
  const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const smsOtpHash = await bcrypt.hash(rawOtp, 10);
  const smsOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await (prisma.user.update as any)({
    where: { id: user.id },
    data: {
      smsOtpHash,
      smsOtpExpires,
      smsOtpAttempts: 0,
      smsOtpLastSentAt: new Date(),
    },
  });

  console.log(`\n======================================================`);
  console.log(`📱 [SMS OTP DISPATCH] Phone: ${user.phone} | Code: ${rawOtp}`);
  console.log(`======================================================\n`);

  return {
    success: true,
    message: "A 6-digit verification code has been sent via SMS.",
    phoneMasked: user.phone ? user.phone.replace(/.(?=.{4})/g, "•") : "••••",
  };
}

/**
 * Verify SMS OTP and authenticate user.
 */
export async function verifySmsOtp(input: VerifySmsOtpInput) {
  const cleanPhone = input.phone.replace(/\D/g, "");

  const users: any[] = await prisma.user.findMany({
    where: {
      phone: { not: null },
    },
  });

  const user = users.find((u) => u.phone && u.phone.replace(/\D/g, "").includes(cleanPhone.slice(-10)));

  if (!user || !user.smsOtpHash || !user.smsOtpExpires) {
    throw new Error("No active verification code found. Please request a new code.");
  }

  if (new Date() > new Date(user.smsOtpExpires)) {
    throw new Error("Verification code has expired. Please request a new code.");
  }

  if ((user.smsOtpAttempts || 0) >= 5) {
    throw new Error("Too many failed attempts. Please request a new verification code.");
  }

  const isValid = await bcrypt.compare(input.otp.trim(), user.smsOtpHash);
  if (!isValid) {
    await (prisma.user.update as any)({
      where: { id: user.id },
      data: { smsOtpAttempts: { increment: 1 } },
    });
    throw new Error("Invalid verification code. Please check the code and try again.");
  }

  await (prisma.user.update as any)({
    where: { id: user.id },
    data: {
      smsOtpHash: null,
      smsOtpExpires: null,
      smsOtpAttempts: 0,
      lastLoginAt: new Date(),
    },
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
    client: fullUserProfile.client,
  };
}

/**
 * Submit Client Service Agreement with dynamic plan resolution and state cancellation deadline.
 */
export async function submitAgreement(userId: string, input: SubmitAgreementInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User account not found.");
  }

  if (user.role !== UserRole.CLIENT) {
    throw new Error("Only clients are required to sign the client service agreement.");
  }

  // 1. Resolve Dynamic Plan & PlanVersion from Database
  let targetPlan: any = null;
  let targetVersion: any = null;

  if (input.planId) {
    targetPlan = await (prisma.servicePlan.findUnique as any)({
      where: { id: input.planId },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { planServices: { include: { serviceType: true } } },
        },
      },
    });
    targetVersion = targetPlan?.versions?.[0];
  } else if (input.planVersionId) {
    targetVersion = await ((prisma as any).planVersion.findUnique as any)({
      where: { id: input.planVersionId },
      include: {
        plan: true,
        planServices: { include: { serviceType: true } },
      },
    });
    targetPlan = targetVersion?.plan;
  } else {
    targetPlan = await (prisma.servicePlan.findFirst as any)({
      where: {
        OR: [
          { code: input.selectedPlan.toUpperCase() },
          { name: { equals: input.selectedPlan, mode: "insensitive" } },
        ],
      },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { planServices: { include: { serviceType: true } } },
        },
      },
    });
    targetVersion = targetPlan?.versions?.[0];
  }

  const basePrice = targetVersion?.price ?? targetPlan?.price ?? 995;
  const finalPrice = input.hasCleaningAddon ? basePrice + 60 : basePrice;

  // 2. Compute 3-Business-Day Cancellation Deadline
  const deadlineResult = CancellationDeadlineService.calculateDeadline(
    input.state,
    input.agreementDate
  );

  // 3. Update or create Client profile
  let clientId = user.client?.id;
  const signerRole = input.signerRole || "RESIDENT";
  const homeAccessType = input.homeAccessType || "RESIDENT_ANSWERS";

  if (!clientId) {
    const clientCount = await prisma.client.count();
    const clientNumber = `AW-${1001 + clientCount}`;
    const newClient = await (prisma.client.create as any)({
      data: {
        userId: user.id,
        clientNumber,
        address: input.address,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: "USA",
        dateOfBirth: input.dob,
        signerRole,
        legalAuthority: input.legalAuthority || null,
        primaryContactName: input.primaryContactName,
        primaryContactPhone: input.primaryContactPhone,
        primaryContactEmail: input.primaryContactEmail,
        primaryContactRelation: input.primaryContactRelation,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactRelation: input.emergencyContactRelation,
        homeAccessType,
        homeAccessInstructions: input.homeAccessInstructions || null,
        homeAccessCode: input.homeAccessCode || null,
        selectedPlan: targetPlan?.code || input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
      },
    });
    clientId = newClient.id;
  } else {
    await (prisma.client.update as any)({
      where: { id: clientId },
      data: {
        address: input.address,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        dateOfBirth: input.dob,
        signerRole,
        legalAuthority: input.legalAuthority || null,
        primaryContactName: input.primaryContactName,
        primaryContactPhone: input.primaryContactPhone,
        primaryContactEmail: input.primaryContactEmail,
        primaryContactRelation: input.primaryContactRelation,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactRelation: input.emergencyContactRelation,
        homeAccessType,
        homeAccessInstructions: input.homeAccessInstructions || null,
        homeAccessCode: input.homeAccessCode || null,
        selectedPlan: targetPlan?.code || input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
      },
    });
  }

  // 4. Create ServiceAgreement snapshot record
  const planSnapshot = {
    planId: targetPlan?.id,
    planVersionId: targetVersion?.id,
    planName: targetVersion?.name || targetPlan?.name || input.selectedPlan,
    planCode: targetPlan?.code || input.selectedPlan,
    basePrice,
    addonPrice: input.hasCleaningAddon ? 60 : 0,
    totalPrice: finalPrice,
    billingInterval: targetVersion?.billingInterval || targetPlan?.billingInterval || "QUARTERLY",
    features: targetVersion?.features || [],
    services: (targetVersion?.planServices || []).map((ps: any) => ({
      serviceName: ps.serviceType?.name,
      allocatedVisits: ps.allocatedVisits,
    })),
  };

  const agreement = await (prisma.serviceAgreement.create as any)({
    data: {
      clientId,
      planId: targetPlan?.id || null,
      planVersionId: targetVersion?.id || null,
      templateVersion: "v2.0",
      state: input.state || "RI",
      signerRole,
      signerName: input.signerName || input.clientPrintedName,
      legalAuthority: input.legalAuthority || null,
      primaryBillingContact: input.primaryBillingContact || null,
      cancellationDeadline: deadlineResult.deadlineDate,
      cancellationDeadlineRule: deadlineResult.ruleExplanation,
      planSnapshot,
      status: "SIGNED",
      selectedPlan: targetPlan?.code || input.selectedPlan,
      planPrice: finalPrice,
      hasCleaningAddon: input.hasCleaningAddon,
      clientPrintedName: input.clientPrintedName,
      authorizedRepName: input.authorizedRepName,
      relationshipToClient: input.relationshipToClient,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      emergencyContactRelation: input.emergencyContactRelation,
      clientSignature: input.clientSignature,
      agreementDate: new Date(input.agreementDate),
      signedAt: new Date(),
      executedAt: new Date(),
      stripePaymentMethodId: input.paymentMethodId || null,
      stripeSetupIntentId: input.setupIntentId || null,
    },
  });

  if (input.phone) {
    await prisma.user.update({
      where: { id: userId },
      data: { phone: input.phone },
    });
  }

  // 5. Provision subscription & billing if payment details supplied
  if (input.paymentMethodId || input.setupIntentId || input.billingMethod === "INVOICE") {
    try {
      await processAgreementPayment(userId, {
        agreementId: agreement.id,
        paymentMethodId: input.paymentMethodId || undefined,
        setupIntentId: input.setupIntentId || undefined,
        billingMethod: input.billingMethod || "AUTOMATIC",
        selectedPlan: (targetPlan?.code as any) || "GUARDIAN_PLUS",
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
    cancellationDeadline: deadlineResult,
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

  if (!user || !user.client) {
    throw new Error("Client account not found.");
  }

  const client = user.client as any;
  const latestAgreement = client?.agreements?.[0] as any;
  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return {
    id: latestAgreement?.id,
    templateVersion: latestAgreement?.templateVersion,
    status: latestAgreement?.status || (client?.hasCompletedAgreement ? "SIGNED" : "DRAFT"),
    selectedPlan: latestAgreement?.selectedPlan || client?.selectedPlan || "ESSENTIAL_GUARD",
    planPrice: latestAgreement?.planPrice || (client?.selectedPlan === "GUARDIAN_PLUS" ? 1892 : 995),
    hasCleaningAddon: latestAgreement?.hasCleaningAddon || client?.hasCleaningAddon || false,
    clientFullName: fullName,
    clientPrintedName: latestAgreement?.clientPrintedName || fullName,
    authorizedRepName: latestAgreement?.authorizedRepName || client?.primaryContactName || null,
    relationshipToClient: latestAgreement?.relationshipToClient || client?.primaryContactRelation || null,
    clientSignature: latestAgreement?.clientSignature || null,
    agreementDate: latestAgreement?.agreementDate || latestAgreement?.signedAt || latestAgreement?.createdAt || new Date(),
    signedAt: latestAgreement?.signedAt || null,
    executedAt: latestAgreement?.executedAt || null,
    address: client?.address,
    city: client?.city,
    state: client?.state,
    postalCode: client?.postalCode,
    phone: user.phone,
    dob: client?.dateOfBirth,
    email: user.email,
    primaryContactName: client?.primaryContactName,
    primaryContactPhone: client?.primaryContactPhone,
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
 * Get full user profile including client, flags, and permissions.
 */
export async function getUserProfile(userId: string) {
  const user: any = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          subscriptions: {
            include: {
              plan: true,
            },
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

  const flags = computeAgreementFlags(user);

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    permissions: user.permissions || [],
    hasCompletedAgreement: flags.hasCompletedAgreement,
    requiresAgreement: flags.requiresAgreement,
    client: user.client
      ? {
          id: user.client.id,
          clientNumber: user.client.clientNumber,
          address: user.client.address,
          city: user.client.city,
          state: user.client.state,
          postalCode: user.client.postalCode,
          country: user.client.country,
          dateOfBirth: user.client.dateOfBirth,
          signerRole: user.client.signerRole,
          legalAuthority: user.client.legalAuthority,
          primaryContactName: user.client.primaryContactName,
          primaryContactPhone: user.client.primaryContactPhone,
          primaryContactEmail: user.client.primaryContactEmail,
          primaryContactRelation: user.client.primaryContactRelation,
          emergencyContactName: user.client.emergencyContactName,
          emergencyContactPhone: user.client.emergencyContactPhone,
          emergencyContactRelation: user.client.emergencyContactRelation,
          homeAccessType: user.client.homeAccessType,
          homeAccessInstructions: user.client.homeAccessInstructions,
          selectedPlan: user.client.selectedPlan,
          hasCleaningAddon: user.client.hasCleaningAddon,
          onboardingStatus: user.client.onboardingStatus,
          hasCompletedAgreement: user.client.hasCompletedAgreement,
          cardBrand: user.client.cardBrand,
          cardLast4: user.client.cardLast4,
          cardExpMonth: user.client.cardExpMonth,
          cardExpYear: user.client.cardExpYear,
        }
      : null,
  };
}

/**
 * Update user and client profile.
 */
export async function updateUserProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { client: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  const userUpdateData: any = {};
  if (input.firstName !== undefined) userUpdateData.firstName = input.firstName;
  if (input.lastName !== undefined) userUpdateData.lastName = input.lastName;
  if (input.phone !== undefined) userUpdateData.phone = input.phone;

  if (Object.keys(userUpdateData).length > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: userUpdateData,
    });
  }

  if (user.client) {
    const clientUpdateData: any = {};
    if (input.address !== undefined) clientUpdateData.address = input.address;
    if (input.city !== undefined) clientUpdateData.city = input.city;
    if (input.state !== undefined) clientUpdateData.state = input.state;
    if (input.postalCode !== undefined) clientUpdateData.postalCode = input.postalCode;
    if (input.emergencyContactName !== undefined) clientUpdateData.emergencyContactName = input.emergencyContactName;
    if (input.emergencyContactPhone !== undefined) clientUpdateData.emergencyContactPhone = input.emergencyContactPhone;
    if (input.emergencyContactRelation !== undefined) clientUpdateData.emergencyContactRelation = input.emergencyContactRelation;
    if (input.homeAccessType !== undefined) clientUpdateData.homeAccessType = input.homeAccessType;
    if (input.homeAccessInstructions !== undefined) clientUpdateData.homeAccessInstructions = input.homeAccessInstructions;

    if (Object.keys(clientUpdateData).length > 0) {
      await (prisma.client.update as any)({
        where: { id: user.client.id },
        data: clientUpdateData,
      });
    }
  }

  return getUserProfile(userId);
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

  const isPasswordValid = await comparePassword(input.oldPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error("Incorrect current password.");
  }

  const newPasswordHash = await hashPassword(input.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash },
  });

  return { success: true, message: "Password updated successfully." };
}

/**
 * Forgot password - send OTP.
 */
export async function forgotPassword(input: ForgotPasswordInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (!user) {
    return { success: true, message: "If an account exists, a reset code has been sent." };
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const resetOtpExpires = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetOtp: otp,
      resetOtpExpires,
    },
  });

  try {
    await sendPasswordResetOtpEmail({
      to: user.email,
      name: user.firstName,
      otp,
      expiresInMinutes: 15,
    });
  } catch (emailErr) {
    console.warn("⚠️ Reset email error:", emailErr);
  }

  return { success: true, message: "A verification code has been sent to your email." };
}

/**
 * Verify OTP.
 */
export async function verifyOtp(input: VerifyOtpInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (!user || !user.resetOtp || !user.resetOtpExpires) {
    throw new Error("Invalid or expired verification code.");
  }

  if (new Date() > new Date(user.resetOtpExpires)) {
    throw new Error("Verification code has expired.");
  }

  if (user.resetOtp !== input.otp.trim()) {
    throw new Error("Incorrect verification code.");
  }

  return { success: true, message: "Verification code confirmed." };
}

/**
 * Reset password with verified OTP.
 */
export async function resetPassword(input: ResetPasswordInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (!user || !user.resetOtp || !user.resetOtpExpires) {
    throw new Error("Invalid or expired verification code.");
  }

  if (new Date() > new Date(user.resetOtpExpires)) {
    throw new Error("Verification code has expired.");
  }

  if (user.resetOtp !== input.otp.trim()) {
    throw new Error("Incorrect verification code.");
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetOtp: null,
      resetOtpExpires: null,
    },
  });

  return { success: true, message: "Password reset successfully. You may now sign in." };
}

/**
 * Refresh JWT token.
 */
export async function refreshTokens(input: RefreshTokenInput) {
  const payload = verifyRefreshToken(input.refreshToken);
  if (!payload || !payload.userId) {
    throw new Error("Invalid or expired refresh token.");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new Error("User account is inactive.");
  }

  const authTokens = generateAuthTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    token: authTokens.token,
    refreshToken: authTokens.refreshToken,
  };
}
