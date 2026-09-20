import { describe, expect, it } from "vitest";

describe("Supabase configuration", () => {
  it("reaches the configured Auth settings endpoint with the publishable key", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Supabase integration test unavailable: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the test environment.");
    }
    expect(url).toMatch(/^https:\/\/[^/]+\.supabase\.co$/);
    expect(key).toMatch(/^(sb_(publishable|anon)_|eyJ)/);

    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key as string, Authorization: `Bearer ${key}` },
    });
    expect(response.status, `Supabase Auth settings request failed with HTTP ${response.status}`).toBe(200);
  }, 15_000);
});
