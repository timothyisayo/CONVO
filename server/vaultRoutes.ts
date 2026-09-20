import type { Express, Request, Response } from "express";
import { Buffer } from "node:buffer";
import dns from "node:dns/promises";
import { authenticate, type Authed } from "./providerRoutes";
import { ENV, isVaultEnabled } from "./_core/env";

type Vault = { auth: Authed; notebookId: string };

function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isPrivateAddress(mappedIpv4[1]);
  if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254) || octets[0] === 0;
}

async function validateVaultSourceUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("A source URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Source URLs must be valid HTTPS URLs.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) throw new Error("Source URLs must be HTTPS URLs without credentials or custom ports.");
  if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost") || isPrivateAddress(parsed.hostname)) throw new Error("Private and local network URLs are not allowed.");
  if (!ENV.vaultSourceAllowlist.includes(parsed.hostname.toLowerCase())) throw new Error("This source host is not allowed by the Vault administrator.");
  let addresses: Array<{ address: string }>;
  try {
    addresses = await Promise.race([
      dns.lookup(parsed.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Source host could not be verified.")), 2000)),
    ]);
  } catch {
    throw new Error("Source host could not be verified.");
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Private and local network URLs are not allowed.");
  return parsed.toString();
}

async function openNotebookResponse(path: string, init: RequestInit = {}, userId?: string) {
  if (!isVaultEnabled()) {
    throw new Error("Vault Open Notebook credentials are not configured.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${ENV.openNotebookPassword}`);
  headers.set("X-Convo-Vault-Service-Key", ENV.vaultServiceKey);
  if (userId) headers.set("X-Convo-User-Id", userId);
  return fetch(`${ENV.openNotebookUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
}

async function openNotebookRequest<T>(path: string, init: RequestInit = {}, userId?: string): Promise<T> {
  const response = await openNotebookResponse(path, init, userId);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String(payload.detail)
      : "Open Notebook could not complete the request.";
    throw new Error(detail);
  }
  return payload as T;
}

async function ensureNotebook(auth: Authed): Promise<string> {
  const { data, error } = await auth.client
    .from("convo_vault_notebooks")
    .select("notebook_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) throw new Error(`Vault ownership lookup failed: ${error.message}`);
  if (data?.notebook_id) return String(data.notebook_id);

  const notebook = await openNotebookRequest<{ id: string }>("/api/notebooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Convo Vault - ${auth.user.id}`,
      description: "Private Convo Vault knowledge base",
      owner_id: auth.user.id,
    }),
  }, auth.user.id);
  const { error: insertError } = await auth.client
    .from("convo_vault_notebooks")
    .insert({ user_id: auth.user.id, notebook_id: notebook.id });
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Vault ownership record could not be saved: ${insertError.message}`);
  }
  if (insertError?.code === "23505") {
    const retry = await auth.client
      .from("convo_vault_notebooks")
      .select("notebook_id")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (retry.error || !retry.data?.notebook_id) {
      throw new Error("Vault ownership record could not be read after a concurrent create.");
    }
    return String(retry.data.notebook_id);
  }
  return notebook.id;
}

async function requireVault(req: Request, res: Response): Promise<Vault | null> {
  if (!isVaultEnabled()) {
    fail(res, 503, "AI Writing is coming soon.");
    return null;
  }
  const auth = await authenticate(req);
  if (!auth) {
    fail(res, 401, "Sign in again to use Convo Vault.");
    return null;
  }
  try {
    return { auth, notebookId: await ensureNotebook(auth) };
  } catch (error) {
    console.error("Vault ownership setup failed", error);
    fail(res, 503, "Convo Vault is not ready yet.");
    return null;
  }
}

async function ownedSource(vault: Vault, sourceId: string) {
  if (!/^source:[A-Za-z0-9_-]+$/.test(sourceId)) throw new Error("Invalid source ID.");
  const source = await openNotebookRequest<{ notebooks?: string[] }>(
    `/api/sources/${encodeURIComponent(sourceId)}`,
    {},
    vault.auth.user.id,
  );
  if (!Array.isArray(source.notebooks) || !source.notebooks.includes(vault.notebookId)) {
    throw new Error("Source is not owned by this Vault.");
  }
  return source;
}

async function ownedNote(vault: Vault, noteId: string) {
  if (!/^note:[A-Za-z0-9_-]+$/.test(noteId)) throw new Error("Invalid note ID.");
  const notes = await openNotebookRequest<Array<{ id?: string }>>(
    `/api/notes?notebook_id=${encodeURIComponent(vault.notebookId)}`,
    {},
    vault.auth.user.id,
  );
  if (!notes.some((note) => note.id === noteId)) throw new Error("Note is not owned by this Vault.");
}

export function registerVaultRoutes(app: Express) {
  app.get("/api/vault/bootstrap", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    try {
      const [sources, notes] = await Promise.all([
        openNotebookRequest<unknown[]>(`/api/sources?notebook_id=${encodeURIComponent(vault.notebookId)}`, {}, vault.auth.user.id),
        openNotebookRequest<unknown[]>(`/api/notes?notebook_id=${encodeURIComponent(vault.notebookId)}`, {}, vault.auth.user.id),
      ]);
      return res.json({ notebookId: vault.notebookId, sources, notes });
    } catch (error) {
      console.error("Vault bootstrap failed", error);
      return fail(res, 502, "Convo Vault could not load your sources.");
    }
  });

  app.post("/api/vault/sources", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    const type = String(req.body?.type || "");
    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    let sourceUrl: string | undefined;
    if (type === "link") {
      try {
        sourceUrl = await validateVaultSourceUrl(req.body?.url);
      } catch (error) {
        return fail(res, 400, error instanceof Error ? error.message : "Source URL is not allowed.");
      }
    }
    try {
      if (type === "link" || type === "text") {
        return res.json(await openNotebookRequest("/api/sources/json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            title,
            url: sourceUrl,
            content: type === "text" ? String(req.body?.content || "") : undefined,
            notebooks: [vault.notebookId],
            owner_id: vault.auth.user.id,
            embed: true,
            async_processing: true,
          }),
        }, vault.auth.user.id));
      }
      if (type !== "upload" || typeof req.body?.data !== "string") {
        return fail(res, 400, "Provide a URL, note text, or an uploaded document.");
      }
      const base64 = req.body.data.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length || bytes.length > 50 * 1024 * 1024) {
        return fail(res, 413, "Vault uploads must be between 1 byte and 50 MB.");
      }
      const form = new FormData();
      form.append("type", "upload");
      form.append("notebooks", JSON.stringify([vault.notebookId]));
      form.append("owner_id", vault.auth.user.id);
      form.append("embed", "true");
      form.append("async_processing", "true");
      if (title) form.append("title", title);
      form.append("file", new Blob([bytes], { type: String(req.body.mimeType || "application/octet-stream") }), String(req.body.name || "vault-upload"));
      return res.json(await openNotebookRequest("/api/sources", { method: "POST", body: form }, vault.auth.user.id));
    } catch (error) {
      console.error("Vault source ingestion failed", error);
      return fail(res, 502, "Open Notebook could not process this Vault source.");
    }
  });

  app.post("/api/vault/notes", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    try {
      return res.json(await openNotebookRequest("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(req.body?.title || "Convo Vault note"),
          content: String(req.body?.content || ""),
          note_type: "human",
          notebook_id: vault.notebookId,
          owner_id: vault.auth.user.id,
        }),
      }, vault.auth.user.id));
    } catch (error) {
      console.error("Vault note creation failed", error);
      return fail(res, 502, "Open Notebook could not save this Vault note.");
    }
  });

  app.post("/api/vault/ask", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    try {
      const defaults = await openNotebookRequest<{ default_embedding_model?: string | null }>("/api/models/defaults", {}, vault.auth.user.id);
      const model = ENV.vaultQwenModel.trim();
      if (!model || !/^ollama\/qwen[0-9a-z._:-]+$/i.test(model)) {
        return fail(res, 503, "Configure an explicit local Ollama Qwen model for Vault.");
      }
      if (!defaults.default_embedding_model || !/^ollama\/[0-9a-z._:-]+$/i.test(defaults.default_embedding_model)) {
        return fail(res, 503, "Configure a local Ollama embedding model for Vault.");
      }
      const question = String(req.body?.question || "").trim();
      if (!question || question.length > 4000) return fail(res, 400, "Provide a question up to 4000 characters.");
      const result = await openNotebookRequest<{ answer: string }>("/api/search/ask/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scope_notebook_ids: [vault.notebookId],
          strategy_model: model,
          answer_model: model,
          final_answer_model: model,
        }),
      }, vault.auth.user.id);
      return res.json({ answer: result.answer, notebookId: vault.notebookId });
    } catch (error) {
      console.error("Vault RAG request failed", error);
      return fail(res, 502, "Vault could not answer from your private sources.");
    }
  });

  app.get("/api/vault/sources/:sourceId", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    try { return res.json(await ownedSource(vault, req.params.sourceId)); }
    catch { return fail(res, 404, "Vault source not found."); }
  });

  app.get("/api/vault/sources/:sourceId/download", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    try {
      await ownedSource(vault, req.params.sourceId);
      const response = await openNotebookResponse(`/api/sources/${encodeURIComponent(req.params.sourceId)}/download`, {}, vault.auth.user.id);
      if (!response.ok) return fail(res, 404, "Vault source file not found.");
      response.headers.forEach((value, key) => res.setHeader(key, value));
      return res.send(Buffer.from(await response.arrayBuffer()));
    } catch { return fail(res, 404, "Vault source file not found."); }
  });

  app.get("/api/vault/sources/:sourceId/status", sourceOperation("status", "GET"));
  app.post("/api/vault/sources/:sourceId/retry", sourceOperation("retry", "POST"));
  app.put("/api/vault/sources/:sourceId", sourceOperation("update", "PUT"));
  app.delete("/api/vault/sources/:sourceId", sourceOperation("delete", "DELETE"));

  function sourceOperation(kind: string, method: string) {
    return async (req: Request, res: Response) => {
      const vault = await requireVault(req, res);
      if (!vault) return;
      try {
        await ownedSource(vault, req.params.sourceId);
        const suffix = kind === "status" ? "/status" : kind === "retry" ? "/retry" : "";
        const result = await openNotebookRequest(`/api/sources/${encodeURIComponent(req.params.sourceId)}${suffix}`, {
          method,
          headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
          body: method === "PUT" ? JSON.stringify(req.body ?? {}) : undefined,
        }, vault.auth.user.id);
        return res.json(result ?? { ok: true });
      } catch { return fail(res, 404, "Vault source not found."); }
    };
  }

  app.get("/api/vault/notes/:noteId", async (req, res) => {
    const vault = await requireVault(req, res);
    if (!vault) return;
    try {
      await ownedNote(vault, req.params.noteId);
      return res.json(await openNotebookRequest(`/api/notes/${encodeURIComponent(req.params.noteId)}`, {}, vault.auth.user.id));
    } catch { return fail(res, 404, "Vault note not found."); }
  });

  app.put("/api/vault/notes/:noteId", noteOperation("PUT"));
  app.delete("/api/vault/notes/:noteId", noteOperation("DELETE"));

  function noteOperation(method: string) {
    return async (req: Request, res: Response) => {
      const vault = await requireVault(req, res);
      if (!vault) return;
      try {
        await ownedNote(vault, req.params.noteId);
        const result = await openNotebookRequest(`/api/notes/${encodeURIComponent(req.params.noteId)}`, {
          method,
          headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
          body: method === "PUT" ? JSON.stringify(req.body ?? {}) : undefined,
        }, vault.auth.user.id);
        return res.json(result ?? { ok: true });
      } catch { return fail(res, 404, "Vault note not found."); }
    };
  }
}
