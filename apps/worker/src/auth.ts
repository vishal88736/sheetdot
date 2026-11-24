import type { AuthUserProfile } from "@sheetdot/shared";

const DEFAULT_AUTH_SECRET = "sheetdot-local-dev-auth-secret";

interface TokenPayload {
  user: AuthUserProfile;
  iat: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret?: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret || DEFAULT_AUTH_SECRET);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export function buildGoogleUserId(email: string): string {
  return `google_${email.trim().toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

export function computeInitials(name: string, email: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  if (parts[0]) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase() || "SD";
}

export async function signSessionToken(
  user: AuthUserProfile,
  secret?: string,
  ttlSeconds: number = 60 * 60 * 24 * 30
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    user,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = toBase64Url(payloadBytes);

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart)
  );
  const sigPart = toBase64Url(new Uint8Array(signature));
  return `${payloadPart}.${sigPart}`;
}

export async function verifySessionToken(
  token: string,
  secret?: string
): Promise<AuthUserProfile | null> {
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) return null;

  try {
    const key = await getHmacKey(secret);
    const sigBytes = fromBase64Url(sigPart);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      new TextEncoder().encode(payloadPart)
    );
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadPart));
    const parsed = JSON.parse(payloadJson) as TokenPayload;
    if (!parsed.user?.id || !parsed.user?.email) return null;
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed.user;
  } catch {
    return null;
  }
}
