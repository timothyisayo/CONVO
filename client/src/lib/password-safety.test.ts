import { describe, expect, it, vi } from "vitest";
import { checkPasswordExposure, getRememberedEmail, isCommonPassword, REMEMBERED_EMAIL_KEY, saveRememberedEmail } from "./password-safety";

describe("password safety", () => {
  it("checks only a five-character hash prefix and detects a matching suffix", async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toMatch(/\/range\/[A-F0-9]{5}$/);
      expect(options.headers).toEqual({ "Add-Padding": "true" });
      return new Response("AD6438836DBE526AA231ABDE2D0EEF74D42:4\\n", { status: 200 });
    });
    const result = await checkPasswordExposure("correct horse battery staple", fetcher as typeof fetch);
    expect(result).toBe("breached");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("flags common passwords locally", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("11111111")).toBe(true);
    expect(isCommonPassword("A much safer phrase 42!")).toBe(false);
  });

  it("returns unavailable when the safety service cannot respond", async () => {
    const result = await checkPasswordExposure("BetterPass1!", vi.fn(async () => new Response("", { status: 503 })) as typeof fetch);
    expect(result).toBe("unavailable");
  });

  it("stores only the remembered email and removes it when disabled", () => {
    const values = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), getItem: (key: string) => values.get(key) || null };
    saveRememberedEmail("student@mtu.edu.ng", true, storage);
    expect(getRememberedEmail(storage)).toBe("student@mtu.edu.ng");
    expect(values.has("convo.rememberedPassword")).toBe(false);
    saveRememberedEmail("student@mtu.edu.ng", false, storage);
    expect(values.has(REMEMBERED_EMAIL_KEY)).toBe(false);
  });
});
