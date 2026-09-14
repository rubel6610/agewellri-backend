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
import {
  createNotification,
  notifyAdmins,
} from "../notification/notification.service";

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
export function computeAgreementFlags(user: { role: UserRole; client?: any }) {
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
        (a: any) => a.status === "SIGNED" || a.status === "EXECUTED",
      )),
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

  // Dispatch Welcome In-App Notification and Admin Alert
  try {
    if (user.role === UserRole.CLIENT) {
      await createNotification({
        userId: user.id,
        type: "ACCOUNT_CREATED",
        title: "Welcome to AgeWellRI",
        message: "Your AgeWellRI account has been created successfully. Please complete your service agreement.",
        metadata: { clientId: client?.id },
      });

      await notifyAdmins({
        type: "ACCOUNT_CREATED",
        title: "New Client Registration",
        message: `New client registration received for ${input.firstName} ${input.lastName}.`,
        metadata: { clientId: client?.id, email: user.email },
      });
    }
  } catch (notifErr) {
    console.warn("⚠️ Notification dispatch notice on registration:", notifErr);
  }

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

  const isPasswordValid = await comparePassword(
    input.password,
    user.passwordHash,
  );
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

  const user = users.find(
    (u) =>
      u.phone && u.phone.replace(/\D/g, "").includes(cleanPhone.slice(-10)),
  );

  if (!user) {
    throw new Error(
      "No registered account found with this phone number. Please sign in with email or register.",
    );
  }

  // Rate limit: 60s cooldown
  if (user.smsOtpLastSentAt) {
    const elapsedSeconds =
      (Date.now() - new Date(user.smsOtpLastSentAt).getTime()) / 1000;
    if (elapsedSeconds < 60) {
      throw new Error(
        `Please wait ${Math.ceil(60 - elapsedSeconds)} seconds before requesting a new code.`,
      );
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

  const user = users.find(
    (u) =>
      u.phone && u.phone.replace(/\D/g, "").includes(cleanPhone.slice(-10)),
  );

  if (!user || !user.smsOtpHash || !user.smsOtpExpires) {
    throw new Error(
      "No active verification code found. Please request a new code.",
    );
  }

  if (new Date() > new Date(user.smsOtpExpires)) {
    throw new Error(
      "Verification code has expired. Please request a new code.",
    );
  }

  if ((user.smsOtpAttempts || 0) >= 5) {
    throw new Error(
      "Too many failed attempts. Please request a new verification code.",
    );
  }

  const isValid = await bcrypt.compare(input.otp.trim(), user.smsOtpHash);
  if (!isValid) {
    await (prisma.user.update as any)({
      where: { id: user.id },
      data: { smsOtpAttempts: { increment: 1 } },
    });
    throw new Error(
      "Invalid verification code. Please check the code and try again.",
    );
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

import {
  submitServiceAgreement,
  getClientAgreement,
} from "../agreement/agreement.service";

/**
 * Submit Client Service Agreement with dynamic plan resolution and state cancellation deadline.
 */
export async function submitAgreement(
  userId: string,
  input: SubmitAgreementInput,
) {
  return submitServiceAgreement(userId, input);
}

/**
 * Fetch full active client agreement for the current user.
 */
export async function getMyAgreement(userId: string) {
  const agreement = await getClientAgreement(userId);
  if (!agreement) {
    throw new Error("Client agreement not found.");
  }
  return agreement;
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

  const db = prisma as any;
  let familyMember: any = null;
  let activeClient = user.client;

  // If user does not have a primary client record, check if they are an authorized Family Member
  if (!activeClient && user.role === UserRole.CLIENT) {
    familyMember = await db.familyMember.findFirst({
      where: {
        userId,
        portalAccess: true,
      },
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

    if (familyMember && familyMember.client) {
      activeClient = familyMember.client;
    }
  }

  let flags = computeAgreementFlags({ ...user, client: activeClient });
  // Family members are authorized observers and never require agreement completion
  if (familyMember) {
    flags = {
      hasCompletedAgreement: true,
      requiresAgreement: false,
    };
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    permissions: user.permissions || [],
    isFamilyMember: Boolean(familyMember),
    isPrimary: !familyMember,
    hasCompletedAgreement: flags.hasCompletedAgreement,
    requiresAgreement: flags.requiresAgreement,
    familyMember: familyMember
      ? {
          id: familyMember.id,
          name: familyMember.name,
          relationship: familyMember.relationship,
          email: familyMember.email,
          reportAccess: familyMember.reportAccess,
          portalAccess: familyMember.portalAccess,
          billingAccess: familyMember.billingAccess,
        }
      : null,
    client: activeClient
      ? {
          id: activeClient.id,
          clientNumber: activeClient.clientNumber,
          address: activeClient.address,
          city: activeClient.city,
          state: activeClient.state,
          postalCode: activeClient.postalCode,
          country: activeClient.country,
          dateOfBirth: activeClient.dateOfBirth,
          signerRole: activeClient.signerRole,
          legalAuthority: activeClient.legalAuthority,
          primaryContactName: activeClient.primaryContactName,
          primaryContactPhone: activeClient.primaryContactPhone,
          primaryContactEmail: activeClient.primaryContactEmail,
          primaryContactRelation: activeClient.primaryContactRelation,
          emergencyContactName: activeClient.emergencyContactName,
          emergencyContactPhone: activeClient.emergencyContactPhone,
          emergencyContactRelation: activeClient.emergencyContactRelation,
          homeAccessType: activeClient.homeAccessType,
          homeAccessInstructions: activeClient.homeAccessInstructions,
          selectedPlan: activeClient.selectedPlan,
          hasCleaningAddon: activeClient.hasCleaningAddon,
          onboardingStatus: activeClient.onboardingStatus,
          hasCompletedAgreement: activeClient.hasCompletedAgreement,
          cardBrand: activeClient.cardBrand,
          cardLast4: activeClient.cardLast4,
          cardExpMonth: activeClient.cardExpMonth,
          cardExpYear: activeClient.cardExpYear,
        }
      : null,
  };
}

/**
 * Update user and client profile.
 */
export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
) {
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
    if (input.postalCode !== undefined)
      clientUpdateData.postalCode = input.postalCode;
    if (input.emergencyContactName !== undefined)
      clientUpdateData.emergencyContactName = input.emergencyContactName;
    if (input.emergencyContactPhone !== undefined)
      clientUpdateData.emergencyContactPhone = input.emergencyContactPhone;
    if (input.emergencyContactRelation !== undefined)
      clientUpdateData.emergencyContactRelation =
        input.emergencyContactRelation;
    if (input.homeAccessType !== undefined)
      clientUpdateData.homeAccessType = input.homeAccessType;
    if (input.homeAccessInstructions !== undefined)
      clientUpdateData.homeAccessInstructions = input.homeAccessInstructions;

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
export async function changeUserPassword(
  userId: string,
  input: ChangePasswordInput,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.passwordHash) {
    throw new Error("User not found.");
  }

  const isPasswordValid = await comparePassword(
    input.oldPassword,
    user.passwordHash,
  );
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
    return {
      success: true,
      message: "If an account exists, a reset code has been sent.",
    };
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

  return {
    success: true,
    message: "A verification code has been sent to your email.",
  };
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

  return {
    success: true,
    message: "Password reset successfully. You may now sign in.",
  };
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
