import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface TokenEncryptionServiceOptions {
  keyBase64: string;
  keyVersion: string;
}

/**
 * AES-256-GCM token encryption. Never logs plaintext.
 * Wire format: `${keyVersion}.${ivB64}.${tagB64}.${ciphertextB64}`
 */
export class TokenEncryptionService {
  private readonly key: Buffer;
  readonly keyVersion: string;

  constructor(options: TokenEncryptionServiceOptions) {
    const key = Buffer.from(options.keyBase64, "base64");
    if (key.length !== 32) {
      throw new Error("X_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
    }
    this.key = key;
    this.keyVersion = options.keyVersion || "v1";
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      this.keyVersion,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4) {
      throw new Error("invalid encrypted token payload");
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
