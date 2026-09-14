/**
 * Encrypt cNGN request bodies and decrypt cNGN response payloads.
 *
 * The cNGN API encrypts both directions: request bodies are AES-256-CBC encrypted into
 * {content, iv}, and the `data` field of a success response is sealed with libsodium's
 * crypto_box to the merchant's Ed25519 public key.
 *
 * Requires: npm install libsodium-wrappers (and @types/libsodium-wrappers for TypeScript)
 *
 * Import the classes, or run it directly:
 *   npx tsx cngn_crypto.ts encrypt '{"amount":1000}' "$CNGN_ENCRYPTION_KEY"
 *   npx tsx cngn_crypto.ts decrypt "<base64 data>" ./cngn_api_key
 */

import { Buffer } from "buffer";
import * as crypto from "crypto";
import * as fs from "fs";
import sodium from "libsodium-wrappers";

export type AESEncryptionResponse = { iv: string; content: string };

/** AES-CBC operates on 16-byte blocks; the IV is one block. */
const IV_LENGTH = 16;
/** OpenSSH writes the 64-byte Ed25519 private key after a big-endian length marker of 0x40. */
const ED25519_KEY_LENGTH_MARKER = Buffer.from([0x00, 0x00, 0x00, 0x40]);
const ED25519_KEY_BYTES = 64;

export class AESCrypto {
  private static readonly ALGORITHM = "aes-256-cbc";

  /** Derive the 32-byte AES key. The API hashes the key rather than using it raw, so
   * passing the key string straight to the cipher is the usual cause of
   * "400 Decryption failed". */
  private static prepareKey(key: string): Buffer {
    return crypto.createHash("sha256").update(key).digest();
  }

  /** Encrypt a JSON string into the {content, iv} wire format. */
  public static encrypt(data: string, key: string): AESEncryptionResponse {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.prepareKey(key), iv);

    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");

    return { content: encrypted, iv: iv.toString("base64") };
  }

  /** Reverse `encrypt`. Only useful for local round-trip checks; the API never sends
   * AES-encrypted data back. */
  public static decrypt(encryptedData: AESEncryptionResponse, key: string): string {
    const iv = Buffer.from(encryptedData.iv, "base64");
    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.prepareKey(key), iv);

    let decrypted = decipher.update(encryptedData.content, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}

export class Ed25519Crypto {
  private static isInitialized = false;

  private static async initialize(): Promise<void> {
    if (!this.isInitialized) {
      await sodium.ready;
      this.isInitialized = true;
    }
  }

  /** Extract the raw 64-byte Ed25519 key from an OpenSSH-format private key file. */
  private static parseOpenSSHPrivateKey(privateKey: string): Uint8Array {
    const lines = privateKey.trim().split("\n");
    const base64PrivateKey = lines.slice(1, -1).join("");
    const privateKeyBuffer = Buffer.from(base64PrivateKey, "base64");

    const keyDataStart = privateKeyBuffer.indexOf(ED25519_KEY_LENGTH_MARKER);
    if (keyDataStart === -1) {
      throw new Error(
        "Unable to find Ed25519 key data. Pass the private key file (cngn_api_key), " +
          "not the public .pub file, and make sure it is an Ed25519 key.",
      );
    }

    const start = keyDataStart + ED25519_KEY_LENGTH_MARKER.length;
    return new Uint8Array(privateKeyBuffer.subarray(start, start + ED25519_KEY_BYTES));
  }

  /** Open the crypto_box in a response `data` field and return the JSON string. */
  public static async decryptWithPrivateKey(
    ed25519PrivateKey: string,
    encryptedData: string,
  ): Promise<string> {
    await this.initialize();

    const fullPrivateKey = this.parseOpenSSHPrivateKey(ed25519PrivateKey);
    const curve25519PrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(fullPrivateKey);
    const encryptedBuffer = Buffer.from(encryptedData, "base64");

    if (encryptedBuffer.length <= sodium.crypto_box_NONCEBYTES + sodium.crypto_box_PUBLICKEYBYTES) {
      throw new Error("Response data is too short to contain a nonce, ciphertext, and key.");
    }

    const nonce = encryptedBuffer.subarray(0, sodium.crypto_box_NONCEBYTES);
    const ephemeralPublicKey = encryptedBuffer.subarray(-sodium.crypto_box_PUBLICKEYBYTES);
    const ciphertext = encryptedBuffer.subarray(
      sodium.crypto_box_NONCEBYTES,
      -sodium.crypto_box_PUBLICKEYBYTES,
    );

    try {
      const decrypted = sodium.crypto_box_open_easy(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        curve25519PrivateKey,
      );
      return sodium.to_string(decrypted);
    } catch (error) {
      throw new Error(
        "Decryption failed. Check the private key belongs to the same environment " +
          `(test or live) as the API key that made the request: ${error}`,
      );
    }
  }
}

/** Minimal client showing where each side of the crypto belongs in a real call. */
export async function cngnRequest<T>(options: {
  method: "GET" | "POST" | "PUT";
  path: string;
  apiKey: string;
  encryptionKey: string;
  privateKey: string;
  body?: unknown;
  baseUrl?: string;
}): Promise<T> {
  const baseUrl = options.baseUrl ?? "https://api.cngn.co/v1/api";

  const response = await fetch(`${baseUrl}${options.path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body
      ? JSON.stringify(AESCrypto.encrypt(JSON.stringify(options.body), options.encryptionKey))
      : undefined,
  });

  const envelope = (await response.json()) as { status: number | false; message: string; data?: string };

  // Permission failures return `status: false`, so a 200-only check is not enough.
  if (envelope.status !== 200 || !envelope.data) {
    throw new Error(`cNGN ${options.path} failed: ${envelope.message}`);
  }

  return JSON.parse(await Ed25519Crypto.decryptWithPrivateKey(options.privateKey, envelope.data)) as T;
}

async function main(argv: string[]): Promise<number> {
  const [command, first, second] = argv.slice(2);

  if (command === "encrypt" && first && second) {
    console.log(JSON.stringify(AESCrypto.encrypt(first, second), null, 2));
    return 0;
  }

  if (command === "decrypt" && first && second) {
    const privateKey = fs.readFileSync(second, "utf8");
    console.log(await Ed25519Crypto.decryptWithPrivateKey(privateKey, first));
    return 0;
  }

  console.log(
    [
      "Usage:",
      "  cngn_crypto.ts encrypt '<json>' <encryption-key>",
      "  cngn_crypto.ts decrypt '<base64 data>' <path-to-ed25519-private-key>",
    ].join("\n"),
  );
  return 1;
}

// Run only when invoked directly, so importing the classes has no side effects.
if (typeof require !== "undefined" && require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}
