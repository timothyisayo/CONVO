import { beforeEach, describe, expect, it, vi } from "vitest";

describe("disabled Convo Vault", () => {
  beforeEach(() => {
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_ENABLED", "false");
    vi.stubEnv("OPEN_NOTEBOOK_URL", "");
    vi.stubEnv("OPEN_NOTEBOOK_PASSWORD", "");
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_QWEN_MODEL", "");
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_SERVICE_KEY", "");
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_SOURCE_ALLOWLIST", "");
  });

  it("returns Coming Soon without authenticating or calling Open Notebook", async () => {
    const handlers = new Map<string, Function>();
    const app = {
      get(path: string, handler: Function) { handlers.set(`GET ${path}`, handler); },
      post(path: string, handler: Function) { handlers.set(`POST ${path}`, handler); },
      put(path: string, handler: Function) { handlers.set(`PUT ${path}`, handler); },
      delete(path: string, handler: Function) { handlers.set(`DELETE ${path}`, handler); },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { registerVaultRoutes } = await import("./vaultRoutes");
    registerVaultRoutes(app as never);

    const result: { status?: number; body?: unknown } = {};
    const response = {
      status(code: number) { result.status = code; return this; },
      json(body: unknown) { result.body = body; return this; },
    };
    await handlers.get("GET /api/vault/bootstrap")!({ headers: {} }, response);

    expect(result).toEqual({ status: 503, body: { error: "AI Writing is coming soon." } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
