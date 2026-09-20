import type { SupabaseClient } from "@supabase/supabase-js";

export type VaultSource = {
  id?: string;
  title?: string | null;
  type?: string;
  status?: string;
  created?: string;
};

export type VaultNote = {
  id?: string;
  title?: string | null;
  content?: string | null;
  created?: string;
};

async function vaultRequest<T>(
  client: SupabaseClient,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Validate the current session so Supabase can refresh an expired cached
  // access token before the server-side auth boundary is reached.
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  options = {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
  };
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Convo Vault could not complete that request.",
    );
  }
  return payload as T;
}

export function loadVault(client: SupabaseClient) {
  return vaultRequest<{ notebookId: string; sources: VaultSource[]; notes: VaultNote[] }>(
    client,
    "/api/vault/bootstrap",
  );
}

export function addVaultSource(
  client: SupabaseClient,
  input:
    | { type: "link"; url: string; title?: string }
    | { type: "text"; content: string; title?: string }
    | { type: "upload"; name: string; mimeType: string; data: string; title?: string },
) {
  return vaultRequest<VaultSource>(client, "/api/vault/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addVaultNote(
  client: SupabaseClient,
  input: { title: string; content: string },
) {
  return vaultRequest<VaultNote>(client, "/api/vault/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function askVault(client: SupabaseClient, question: string) {
  return vaultRequest<{ answer: string }>(client, "/api/vault/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}
