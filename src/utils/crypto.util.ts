import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 16 bytes for AES-GCM
const PREFIX = "enc:";

/**
 * Derives a consistent 32-byte (256-bit) encryption key from the environment secret.
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "agewellri_default_encryption_secret_key_32";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a sensitive plaintext string using AES-256-GCM.
 * Output format: enc:<ivHex>:<tagHex>:<ciphertextHex>
 */
export function encryptString(plaintext?: string | null): string | null {
  if (!plaintext || typeof plaintext !== "string") return null;

  // If already encrypted, avoid double encryption
  if (plaintext.startsWith(PREFIX)) {
    return plaintext;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return `${PREFIX}${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err: any) {
    console.error("❌ Encryption error:", err.message);
    throw new Error("Failed to encrypt sensitive data.");
  }
}

/**
 * Decrypt an AES-256-GCM ciphertext string back to plaintext.
 * Seamlessly handles legacy plaintext values if not prefixed with "enc:".
 */
export function decryptString(ciphertext?: string | null): string | null {
  if (!ciphertext || typeof ciphertext !== "string") return null;

  // Backward compatibility: if not prefixed with "enc:", it's plaintext
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  try {
    const key = getEncryptionKey();
    const parts = ciphertext.slice(PREFIX.length).split(":");

    if (parts.length !== 3) {
      console.warn("⚠️ Invalid encrypted format structure.");
      return null;
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err: any) {
    console.warn("⚠️ Decryption notice:", err.message);
    return null;
  }
}
