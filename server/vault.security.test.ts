import { beforeEach, describe, expect, it, vi } from "vitest";

const users = {
  A: "user-a",
  B: "user-b",
};

const notebooks = {
  A: "notebook:a",
  B: "notebook:b",
};

function supabaseFor(userId: string) {
  return {
    from: () => ({
      select: () => ({
        eq: (_field: string, value: string) => ({
          maybeSingle: async () => ({
            data: value === userId ? { notebook_id: notebooks[userId === users.A ? "A" : "B"] } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

vi.mock("./providerRoutes", () => ({
  authenticate: async (req: { headers: Record<string, string> }) => {
    const userId = req.headers.authorization === "Bearer user-a-token" ? "user-a" : "user-b";
    return {
      user: { id: userId },
      client: supabaseFor(userId),
    };
  },
}));

function response() {
  const result: { status: number; body: unknown } = { status: 200, body: undefined };
  return {
    result,
    status(code: number) { result.status = code; return this; },
    json(body: unknown) { result.body = body; return this; },
    setHeader() { return this; },
    send(body: unknown) { result.body = body; return this; },
  };
}

describe("Convo Vault user isolation", () => {
  beforeEach(() => {
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_ENABLED", "true");
    vi.stubEnv("OPEN_NOTEBOOK_URL", "http://open-notebook.test");
    vi.stubEnv("OPEN_NOTEBOOK_PASSWORD", "notebook-password");
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_SERVICE_KEY", "vault-service-key");
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_QWEN_MODEL", "ollama/qwen2.5:0.5b");
    vi.stubEnv("OPEN_NOTEBOOK_VAULT_SOURCE_ALLOWLIST", "example.com");
  });

  it("rejects User A from User B's source and only asks within User A's notebook", async () => {
    const handlers = new Map<string, Function>();
    const app = {
      get(path: string, handler: Function) { handlers.set(`GET ${path}`, handler); },
      post(path: string, handler: Function) { handlers.set(`POST ${path}`, handler); },
      put(path: string, handler: Function) { handlers.set(`PUT ${path}`, handler); },
      delete(path: string, handler: Function) { handlers.set(`DELETE ${path}`, handler); },
    };

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/sources/source:b") {
        return new Response(JSON.stringify({ id: "source:b", notebooks: [notebooks.B] }), { status: 200 });
      }
      if (parsed.pathname === "/api/models/defaults") {
        return new Response(JSON.stringify({ default_embedding_model: "ollama/nomic-embed-text" }), { status: 200 });
      }
      if (parsed.pathname === "/api/search/ask/simple") {
        const body = JSON.parse(String(init?.body));
        expect(body.scope_notebook_ids).toEqual([notebooks.A]);
        return new Response(JSON.stringify({ answer: "only User A context" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerVaultRoutes } = await import("./vaultRoutes");
    registerVaultRoutes(app as never);

    const denied = response();
    await handlers.get("GET /api/vault/sources/:sourceId")!(
      { headers: { authorization: "Bearer user-a-token" }, params: { sourceId: "source:b" } },
      denied,
    );
    expect(denied.result.status).toBe(404);

    const reverseDenied = response();
    await handlers.get("GET /api/vault/sources/:sourceId")!(
      { headers: { authorization: "Bearer user-b-token" }, params: { sourceId: "source:a" } },
      reverseDenied,
    );
    expect(reverseDenied.result.status).toBe(404);

    const asked = response();
    await handlers.get("POST /api/vault/ask")!(
      { headers: { authorization: "Bearer user-a-token" }, body: { question: "A secret?" } },
      asked,
    );
    expect(asked.result).toMatchObject({ status: 200, body: { answer: "only User A context" } });
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("/api/search/ask/simple");
    const headers = (lastCall?.[1] as RequestInit).headers as Headers;
    expect(headers.get("X-Convo-User-Id")).toBe(users.A);
    expect(headers.get("X-Convo-Vault-Service-Key")).toBe("vault-service-key");
  });

  it("rejects local and non-HTTPS source URLs before contacting Open Notebook", async () => {
    const handlers = new Map<string, Function>();
    const app = {
      get(path: string, handler: Function) { handlers.set(`GET ${path}`, handler); },
      post(path: string, handler: Function) { handlers.set(`POST ${path}`, handler); },
      put(path: string, handler: Function) { handlers.set(`PUT ${path}`, handler); },
      delete(path: string, handler: Function) { handlers.set(`DELETE ${path}`, handler); },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { registerVaultRoutes } = await import("./vaultRoutes");
    registerVaultRoutes(app as never);

    for (const url of [
      "http://127.0.0.1:5055/internal",
      "https://localhost/admin",
      "https://192.168.1.20/private",
      "https://[::ffff:127.0.0.1]/metadata",
      "https://unapproved.example/phishing",
    ]) {
      const denied = response();
      await handlers.get("POST /api/vault/sources")!({
        headers: { authorization: "******" },
        body: { type: "link", url },
      }, denied);
      expect(denied.result.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
