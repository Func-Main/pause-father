import crypto from "node:crypto";

const IV_BYTE_LENGTH = 12;

export type EncryptedSecret = {
  encryptedKey: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(secret: string): EncryptedSecret {
  const key = encryptionKey();
  const iv = crypto.randomBytes(IV_BYTE_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(secret.encryptedKey, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET;

  if (!secret) {
    throw new Error("Missing KEY_ENCRYPTION_SECRET");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

