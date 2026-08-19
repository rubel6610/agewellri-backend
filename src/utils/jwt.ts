import jwt, { SignOptions } from "jsonwebtoken";

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

const JWT_ACCESS_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}_refresh` : "agewellri_refresh_super_secret_key");

const JWT_ACCESS_EXPIRES_IN = (process.env.JWT_EXPIRES_IN as string) || "1d";
const JWT_REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN as string) || "30d";

/**
 * Signs a short-lived access token.
 */
export function generateAccessToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: JWT_ACCESS_EXPIRES_IN as unknown as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, JWT_ACCESS_SECRET, options);
}

/**
 * Signs a long-lived refresh token.
 */
export function generateRefreshToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: JWT_REFRESH_EXPIRES_IN as unknown as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, JWT_REFRESH_SECRET, options);
}

/**
 * Generate both Access Token and Refresh Token in one call.
 */
export function generateAuthTokens(payload: JwtPayload): {
  token: string;
  refreshToken: string;
} {
  return {
    token: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}

/**
 * Alias for generateAccessToken (backward compatibility).
 */
export function generateToken(payload: JwtPayload): string {
  return generateAccessToken(payload);
}

/**
 * Verifies access token.
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
}

/**
 * Verifies refresh token.
 */
export function verifyRefreshToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as JwtPayload;
  } catch {
    // Fallback: in case refresh token was signed with main secret in older versions
    return jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
  }
}

/**
 * Verifies a JWT token (checks access secret with fallback).
 */
export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
  } catch {
    return jwt.verify(token, JWT_REFRESH_SECRET) as JwtPayload;
  }
}

