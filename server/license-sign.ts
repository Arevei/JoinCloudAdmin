import crypto from "crypto";

const ALGORITHM = "ed25519";

let keyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } | null = null;

let keyPairWarningLogged = false;

function getKeyPair(): { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } {
  if (keyPair) return keyPair;
  const raw = process.env.JOINCLOUD_LICENSE_PRIVATE_KEY;
  if (raw) {
    try {
      const pem = raw.startsWith("-----BEGIN")
        ? raw
        : Buffer.from(raw, "base64").toString("utf8");
      const privateKey = crypto.createPrivateKey({
        key: pem,
        format: "pem",
        type: "pkcs8",
      });
      const publicKey = crypto.createPublicKey(privateKey);
      keyPair = { publicKey, privateKey };
      return keyPair;
    } catch (err) {
      if (!keyPairWarningLogged) {
        keyPairWarningLogged = true;
        console.warn("Invalid JOINCLOUD_LICENSE_PRIVATE_KEY; using dev key. Generate a valid key with generateKeyPairForEnv().");
      }
      keyPair = crypto.generateKeyPairSync(ALGORITHM);
      return keyPair;
    }
  }
  // Dev fallback: generate in-memory (not persisted)
  keyPair = crypto.generateKeyPairSync(ALGORITHM);
  return keyPair;
}

export interface LicensePayloadToSign {
  license_id: string;
  account_id: string;
  tier: string;
  device_limit: number;
  issued_at: number;
  expires_at: number;
  state: string;
  grace_ends_at?: number;
  features?: Record<string, boolean>;
  custom_quota?: number;
}

function payloadString(payload: LicensePayloadToSign): string {
  return JSON.stringify({
    license_id: payload.license_id,
    account_id: payload.account_id,
    tier: payload.tier,
    device_limit: payload.device_limit,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    state: payload.state,
    grace_ends_at: payload.grace_ends_at ?? null,
    features: payload.features ?? {},
    custom_quota: payload.custom_quota ?? null,
  });
}

export function signLicense(payload: LicensePayloadToSign): string {
  const { privateKey } = getKeyPair();
  const message = payloadString(payload);
  const sig = crypto.sign(null, Buffer.from(message, "utf8"), privateKey);
  return sig.toString("base64");
}

export function verifyLicenseSignature(
  payload: LicensePayloadToSign,
  signatureBase64: string
): boolean {
  try {
    const { publicKey } = getKeyPair();
    const message = payloadString(payload);
    const sig = Buffer.from(signatureBase64, "base64");
    return crypto.verify(null, Buffer.from(message, "utf8"), publicKey, sig);
  } catch {
    return false;
  }
}

/** Export public key as PEM for embedding in Electron (verify only). */
export function getLicensePublicKeyPem(): string {
  const { publicKey } = getKeyPair();
  return publicKey.export({ type: "spki", format: "pem" }) as string;
}

/** Generate a new key pair and return private key as base64 PEM for .env. */
export function generateKeyPairForEnv(): { privateKeyBase64: string; publicKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync(ALGORITHM);
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  return {
    privateKeyBase64: Buffer.from(privatePem, "utf8").toString("base64"),
    publicKeyPem: publicPem,
  };
}
