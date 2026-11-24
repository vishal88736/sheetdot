export type StoredVaultRow = {
  id: string;
  label: string;
  sender_pattern: string;
  encrypted_password: string;
  hint_description: string;
  created_at: string;
};

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  rawText?: string;
  requiresPassword?: boolean;
  expectedPassword?: string; // Used only in MOCK_MODE to verify vault password matching
  encryptedText?: string;
}

export interface PdfExtractionResult {
  unlocked: boolean;
  text: string;
  reason?: string;
}

const DEFAULT_DEV_VAULT_SECRET = "sheetdot-local-dev-vault-secret";

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(secret || DEFAULT_DEV_VAULT_SECRET);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptVaultPassword(
  plaintext: string,
  secret?: string
): Promise<string> {
  const key = await deriveAesKey(secret ?? DEFAULT_DEV_VAULT_SECRET);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${toBase64(iv)}:${toBase64(new Uint8Array(cipherBuffer))}`;
}

export async function decryptVaultPassword(
  payload: string,
  secret?: string
): Promise<string> {
  const [ivB64, cipherB64] = payload.split(":");
  if (!ivB64 || !cipherB64) {
    throw new Error("Invalid encrypted vault payload");
  }
  const key = await deriveAesKey(secret ?? DEFAULT_DEV_VAULT_SECRET);
  const iv = fromBase64(ivB64);
  const cipherBytes = fromBase64(cipherB64);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    cipherBytes as BufferSource
  );
  return new TextDecoder().decode(plainBuffer);
}

export function matchesSenderPattern(
  sender: string,
  subject: string,
  pattern: string
): boolean {
  const needle = pattern.trim().toLowerCase();
  if (!needle) return false;
  const haystack = `${sender} ${subject}`.toLowerCase();
  return haystack.includes(needle);
}

/**
 * Extracts text from plain PDF text operators (`(...) Tj` / `[...] TJ`) or decoded text.
 */
export function extractPlainPdfText(rawPdfText: string): string {
  if (!rawPdfText.includes("%PDF")) {
    return rawPdfText;
  }
  const matches: string[] = [];
  const literalRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|')/g;
  let match: RegExpExecArray | null = literalRegex.exec(rawPdfText);
  while (match !== null) {
    if (match[1]) {
      matches.push(match[1].replace(/\\([()\\])/g, "$1"));
    }
    match = literalRegex.exec(rawPdfText);
  }
  return matches.length > 0 ? matches.join(" ") : rawPdfText;
}

export async function resolveAttachmentText(
  attachment: EmailAttachment,
  matchingVaultRows: StoredVaultRow[],
  secret?: string
): Promise<PdfExtractionResult> {
  if (!attachment.requiresPassword) {
    const text = extractPlainPdfText(attachment.rawText ?? "");
    return { unlocked: true, text };
  }

  for (const row of matchingVaultRows) {
    const candidatePassword = await decryptVaultPassword(row.encrypted_password, secret);
    if (!attachment.expectedPassword || candidatePassword === attachment.expectedPassword) {
      return {
        unlocked: true,
        text: attachment.encryptedText ?? attachment.rawText ?? "",
      };
    }
  }

  return {
    unlocked: false,
    text: "",
    reason: `Locked PDF "${attachment.filename}": add matching password hint in PDF Vault`,
  };
}
