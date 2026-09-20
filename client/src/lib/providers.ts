import type { SupabaseClient } from "@supabase/supabase-js";

async function request<T>(client: SupabaseClient, path: string, body: unknown): Promise<T> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request could not be completed.");
  return payload as T;
}

export type ProviderCall = { id: string; conversation_id?: string; room_name: string; caller_id: string; callee_id: string | null; call_type: "voice" | "video"; status: string };
export const startProviderCall = (client: SupabaseClient, input: { conversationId: string; calleeId?: string | null; callType: "voice" | "video" }) => request<{ call: ProviderCall; participantIds: string[] }>(client, "/api/calls/start", input);
export const getProviderToken = (client: SupabaseClient, callId: string) => request<{ token: string; url: string; roomName: string; callType: "voice" | "video" }>(client, "/api/calls/token", { callId });
export const updateProviderCallStatus = (client: SupabaseClient, callId: string, status: "ringing" | "answered" | "declined" | "ended" | "failed") => request<{ ok: true }>(client, "/api/calls/status", { callId, status });
export type AssistantAttachment = { name: string; mimeType: string; data: string };
export type AssistantSharedFile = { name: string; mimeType: string };
export type AssistantProfile = { name: string; email?: string; age: number; birthday: string; year: string; programme: string; goal: string };
export const askGemini = (
  client: SupabaseClient,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  attachments: AssistantAttachment[] = [],
  sharedFiles: AssistantSharedFile[] = [],
  profile?: AssistantProfile,
) => request<{ text: string; sessionSeconds?: number }>(client, "/api/ai/gemini", { messages, attachments, sharedFiles, profile });
