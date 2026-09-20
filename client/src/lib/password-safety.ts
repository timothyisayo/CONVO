export type PasswordSafety = "idle" | "checking" | "safe" | "common" | "breached" | "unavailable";

const COMMON_PASSWORDS = new Set(["password", "password1", "12345678", "123456789", "qwerty123", "1234567890", "letmein", "welcome", "iloveyou", "admin123", "mtu123456"]);

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

async function sha1Hex(value: string) {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("Secure hashing is unavailable");
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function isCommonPassword(password: string) {
  const normalized = password.trim().toLowerCase();
  return COMMON_PASSWORDS.has(normalized) || /^(.)\1+$/.test(normalized) || /^(012345|123456|234567|345678|456789|567890)/.test(normalized);
}

export async function checkPasswordExposure(password: string, fetcher: typeof fetch = fetch): Promise<Exclude<PasswordSafety, "idle" | "checking" | "common">> {
  if (!password) return "safe";
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const response = await fetcher(`${HIBP_RANGE_URL}${prefix}`, { headers: { "Add-Padding": "true" } });
    if (!response.ok) return "unavailable";
    const body = await response.text();
    const found = body.split(/\r?\n/).some((line) => line.split(":")[0]?.trim().toUpperCase() === suffix);
    return found ? "breached" : "safe";
  } catch {
    return "unavailable";
  }
}

export const PASSWORD_EXPOSURE_COPY = {
  checking: "Checking this password privately…",
  safe: "No known breach match found",
  common: "This password is too common. Choose something more unique.",
  breached: "This password has appeared in a data breach. Choose another.",
  unavailable: "We couldn’t complete the safety check. You can still choose a unique password.",
} as const;

export const REMEMBERED_EMAIL_KEY = "convo.rememberedEmail";

export function getRememberedEmail(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try { return storage?.getItem(REMEMBERED_EMAIL_KEY) || ""; } catch { return ""; }
}

export function saveRememberedEmail(email: string, remember: boolean, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try {
    if (remember) storage?.setItem(REMEMBERED_EMAIL_KEY, email);
    else storage?.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Storage can be unavailable in private browsing; login still works normally.
  }
}

export function passwordSafetyMessage(status: PasswordSafety) {
  return status === "common" ? PASSWORD_EXPOSURE_COPY.common : status === "breached" ? PASSWORD_EXPOSURE_COPY.breached : status === "unavailable" ? PASSWORD_EXPOSURE_COPY.unavailable : "";
}
