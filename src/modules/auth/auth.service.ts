import { UserRole, UserStatus, OnboardingStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { hashPassword, comparePassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { RegisterInput, LoginInput, ChangePasswordInput, UpdateProfileInput } from "./auth.validation";

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
  console.log("User created:", user);

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
      },
    });
  }

  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    token,
    user,
    client,
  };
}

/**
 * Authenticate user with email and password.
 */
export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: {
      client: true,
      technician: true,
    },
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

  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const { passwordHash, ...userProfile } = user;

  return {
    token,
    user: userProfile,
  };
}

/**
 * Fetch authenticated user profile.
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
      client: true,
      technician: true,
    },
  });

  if (!user) {
    throw new Error("User profile not found.");
  }

  return user;
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
