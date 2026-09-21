import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isMtuEmail } from "@shared/mtu";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);
export const SUPABASE_AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storageKey: "convo-auth",
} as const;
export const supabase: SupabaseClient | null = supabaseConfigured && url && anonKey ? createClient(url, anonKey, {
  auth: SUPABASE_AUTH_OPTIONS,
}) : null;

export { isMtuEmail } from "@shared/mtu";

export function supabaseSetupMessage() {
  return "Verification is temporarily unavailable. Please try again shortly.";
}

export const CONVO_ONBOARDING_SEQUENCE = ["email", "code", "password", "profile", "dashboard"] as const;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MESSAGE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MESSAGE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MESSAGE_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const MESSAGE_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const MESSAGE_AUDIO_MAX_BYTES = 10 * 1024 * 1024;
export const MESSAGE_AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/m4a", "audio/ogg", "audio/mpeg"] as const;
export const MESSAGE_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const MESSAGE_FILE_TYPES = ["application/pdf", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"] as const;
export type ProfileVisibility = { programme: boolean; college: boolean; level: boolean; bio: boolean };
export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = { programme: true, college: true, level: true, bio: true };

export function normalizeProfileVisibility(value: unknown): ProfileVisibility {
  if (!value || typeof value !== "object") return { ...DEFAULT_PROFILE_VISIBILITY };
  const candidate = value as Record<string, unknown>;
  return {
    programme: typeof candidate.programme === "boolean" ? candidate.programme : true,
    college: typeof candidate.college === "boolean" ? candidate.college : true,
    level: typeof candidate.level === "boolean" ? candidate.level : true,
    bio: typeof candidate.bio === "boolean" ? candidate.bio : true,
  };
}

export function validateAvatarFile(file: Pick<File, "type" | "size"> | null) {
  if (!file) return { valid: true as const, error: "" };
  if (!AVATAR_TYPES.includes(file.type as (typeof AVATAR_TYPES)[number])) return { valid: false as const, error: "Use a PNG, JPG, or WebP avatar." };
  if (file.size > AVATAR_MAX_BYTES) return { valid: false as const, error: "Avatar must be 5 MB or smaller." };
  return { valid: true as const, error: "" };
}

export function getProfileMetadata(user: { id?: string; email?: string; user_metadata?: Record<string, unknown> } | null | undefined) {
  const metadata = user?.user_metadata || {};
  const displayName = [metadata.display_name, metadata.full_name, metadata.name].find((value): value is string => typeof value === "string" && value.trim().length > 0) || "";
  const normalizedId = typeof metadata.student_id === "string" && metadata.student_id.trim() ? metadata.student_id : "";
  return {
    displayName,
    nickname: typeof metadata.nickname === "string" ? metadata.nickname : "",
    college: typeof metadata.college === "string" ? metadata.college : "",
    major: typeof metadata.major === "string" ? metadata.major : "",
    avatarUrl: typeof metadata.avatar_url === "string" ? metadata.avatar_url : "",
    studentId: normalizedId,
    level: typeof metadata.level === "string" ? metadata.level : "",
    department: typeof metadata.department === "string" ? metadata.department : "",
    programme: typeof metadata.programme === "string" ? metadata.programme : typeof metadata.major === "string" ? metadata.major : "",
    bio: typeof metadata.bio === "string" ? metadata.bio : "",
    visibility: normalizeProfileVisibility(metadata.profile_visibility),
  };
}

export async function saveMtuProfile(client: Pick<SupabaseClient, "from">, profile: { id: string; display_name: string; nickname: string; college: string; programme: string; level: string; avatar_url?: string; student_id?: string; bio?: string }) {
  const { error } = await client.from("profiles").upsert({
    id: profile.id,
    display_name: profile.nickname,
    level: profile.level,
    department: profile.college,
    programme: profile.programme,
    avatar_url: profile.avatar_url || null,
    student_id: profile.student_id || null,
    bio: profile.bio || null,
  }, { onConflict: "id" });
  return { error };
}

export async function uploadAvatar(client: Pick<SupabaseClient, "storage">, file: File, id: string = crypto.randomUUID()) {
  const validation = validateAvatarFile(file);
  if (!validation.valid) return { url: "", error: validation.error };
  const safeName = file.name.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  const path = `avatars/${id}/${crypto.randomUUID()}-${safeName}`;
  const upload = await client.storage.from("avatars").upload(path, file, { upsert: false, contentType: file.type });
  if (upload.error) return { url: "", error: upload.error.message };
  return { url: client.storage.from("avatars").getPublicUrl(path).data.publicUrl, error: "" };
}


export type MtuStudent = {
  id: string;
  display_name: string;
  student_id: string;
  is_self?: boolean;
  level: string | null;
  department: string | null;
  programme: string | null;
  avatar_url: string | null;
  bio: string | null;
  status_text: string | null;
};

export async function searchMtuStudents(client: Pick<SupabaseClient, "rpc">, query = "") {
  const { data, error } = await client.rpc("search_mtu_students", { p_query: query });
  return { data: (data || []) as MtuStudent[], error };
}

export async function syncMyMtuDirectoryProfile(client: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await client.rpc("sync_my_mtu_profile");
  return { data: Boolean(data), error };
}

export async function sendMtuConnectionRequest(client: Pick<SupabaseClient, "rpc">, recipientId: string) {
  const { data, error } = await client.rpc("send_connection_request", { p_recipient_id: recipientId });
  return { data, error };
}

export async function cancelMtuConnectionRequest(client: Pick<SupabaseClient, "rpc">, recipientId: string) {
  const { data, error } = await client.rpc("cancel_connection_request", { p_recipient_id: recipientId });
  return { data, error };
}


export function validateMessageImage(file: Pick<File, "type" | "size"> | null) {
  if (!file) return { valid: true as const, error: "" };
  if (!MESSAGE_IMAGE_TYPES.includes(file.type as (typeof MESSAGE_IMAGE_TYPES)[number])) return { valid: false as const, error: "Use a PNG, JPG, WebP, or GIF image." };
  if (file.size > MESSAGE_IMAGE_MAX_BYTES) return { valid: false as const, error: "Images must be 8 MB or smaller." };
  return { valid: true as const, error: "" };
}

export function validateMessageAttachment(file: Pick<File, "type" | "size"> | null) {
  if (!file) return { valid: true as const, error: "" };
  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  if (MESSAGE_IMAGE_TYPES.includes(mimeType as (typeof MESSAGE_IMAGE_TYPES)[number])) return validateMessageImage({ ...file, type: mimeType });
  if (MESSAGE_VIDEO_TYPES.includes(mimeType as (typeof MESSAGE_VIDEO_TYPES)[number])) {
    if (file.size > MESSAGE_VIDEO_MAX_BYTES) return { valid: false as const, error: "Videos must be 25 MB or smaller." };
    return { valid: true as const, error: "" };
  }
  if (MESSAGE_AUDIO_TYPES.includes(mimeType as (typeof MESSAGE_AUDIO_TYPES)[number])) {
    if (file.size > MESSAGE_AUDIO_MAX_BYTES) return { valid: false as const, error: "Voice messages must be 10 MB or smaller." };
    return { valid: true as const, error: "" };
  }
  if (!MESSAGE_FILE_TYPES.includes(mimeType as (typeof MESSAGE_FILE_TYPES)[number])) return { valid: false as const, error: "Use an image, video, voice message, PDF, document, spreadsheet, presentation, or ZIP file." };
  if (file.size > MESSAGE_FILE_MAX_BYTES) return { valid: false as const, error: "Files must be 25 MB or smaller." };
  return { valid: true as const, error: "" };
}

async function privateMessageUrl(client: Pick<SupabaseClient, "storage">, path: string) { const bucket = client.storage.from("message-attachments"); if (typeof (bucket as any).createSignedUrl === "function") { const result = await (bucket as any).createSignedUrl(path, 3600); return { url: result.data?.signedUrl || "", error: result.error?.message || "" }; } const fallback = bucket.getPublicUrl(path); return { url: fallback.data.publicUrl, error: "" }; }
export async function createMtuAttachmentSignedUrl(client: Pick<SupabaseClient, "storage">, path: string) { return privateMessageUrl(client, path); }

export async function uploadMessageImage(client: Pick<SupabaseClient, "storage">, file: File, userId: string) {
  const validation = validateMessageImage(file);
  if (!validation.valid) return { url: "", path: "", error: validation.error };
  const safeName = file.name.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
  const upload = await client.storage.from("message-attachments").upload(path, file, { upsert: false, contentType: file.type });
  if (upload.error) return { url: "", path: "", error: upload.error.message };
  const secured = await privateMessageUrl(client, path); return { url: secured.url, path, error: secured.error };
}

export async function uploadMessageAttachment(client: Pick<SupabaseClient, "storage">, file: File, userId: string) {
  const validation = validateMessageAttachment(file);
  if (!validation.valid) return { url: "", path: "", error: validation.error };
  const contentType = file.type.split(";")[0].trim().toLowerCase();
  const safeName = file.name.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
  const upload = await client.storage.from("message-attachments").upload(path, file, { upsert: false, contentType });
  if (upload.error) return { url: "", path: "", error: upload.error.message };
  const secured = await privateMessageUrl(client, path); return { url: secured.url, path, error: secured.error };
}

export function validateGroupImageFile(file: Pick<File, "type" | "size"> | null) {
  if (!file) return { valid: false as const, error: "Choose a PNG, JPG, or WebP group image." };
  if (!AVATAR_TYPES.includes(file.type as (typeof AVATAR_TYPES)[number])) return { valid: false as const, error: "Use a PNG, JPG, or WebP group image." };
  if (file.size > AVATAR_MAX_BYTES) return { valid: false as const, error: "Group images must be 5 MB or smaller." };
  return { valid: true as const, error: "" };
}

export async function uploadMtuGroupImage(client: Pick<SupabaseClient, "storage">, file: File, userId: string, conversationId: string) {
  const validation = validateGroupImageFile(file);
  if (!validation.valid) return { url: "", path: "", error: validation.error };
  const safeName = file.name.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  const path = `${userId}/${conversationId}/${crypto.randomUUID()}-${safeName}`;
  const upload = await client.storage.from("group-images").upload(path, file, { upsert: false, contentType: file.type });
  if (upload.error) return { url: "", path: "", error: upload.error.message };
  return { url: client.storage.from("group-images").getPublicUrl(path).data.publicUrl, path, error: "" };
}

export async function setMtuGroupImage(client: Pick<SupabaseClient, "rpc">, conversationId: string, imageUrl: string, imagePath: string) {
  const { data, error } = await client.rpc("set_mtu_group_image", { p_conversation_id: conversationId, p_image_url: imageUrl, p_image_path: imagePath });
  return { data: typeof data === "string" ? data : null, error };
}

export async function sendMtuMessage(client: Pick<SupabaseClient, "rpc">, conversationId: string, body: string, attachmentUrl: string | null = null, attachmentPath: string | null = null, replyToId: string | null = null, attachmentMime: string | null = null) {
  const args: Record<string, unknown> = {
    p_conversation_id: conversationId,
    p_body: body,
    p_attachment_url: attachmentUrl,
    p_attachment_path: attachmentPath,
    p_reply_to_id: replyToId,
    p_attachment_mime: attachmentMime,
  };
  const { data, error } = await client.rpc("send_mtu_message", args);
  return { data, error };
}

export async function editMtuMessage(client: Pick<SupabaseClient, "rpc">, messageId: string, body: string) {
  const { data, error } = await client.rpc("edit_mtu_message", { p_message_id: messageId, p_body: body });
  return { data, error };
}

export async function deleteMtuMessage(client: Pick<SupabaseClient, "rpc">, messageId: string) {
  const { data, error } = await client.rpc("delete_mtu_message", { p_message_id: messageId });
  return { data, error };
}

export type MtuConversation = { id: string; kind: string; title: string | null; counterpart_id?: string | null; group_image_url?: string | null; group_category?: string | null; ended_at?: string | null; counterpart_last_seen_at?: string | null; updated_at: string; last_message: string | null; last_message_at: string | null; unread_count: number; is_pinned?: boolean; is_archived?: boolean; muted_until?: string | null; draft_body?: string | null };

export async function listMtuConversations(client: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await client.rpc("list_mtu_conversations_v3");
  return { data: (data || []) as MtuConversation[], error };
}


export type MtuConnectionRequest = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: "pending" | "accepted" | "declined" | "blocked";
  direction: "sent" | "received";
  updated_at: string;
  requester_display_name?: string | null;
  requester_student_id?: string | null;
};

export async function listMtuConnectionRequests(client: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await client.rpc("list_mtu_connection_requests");
  return { data: (data || []) as MtuConnectionRequest[], error };
}


export type MtuMessage = {
  id: string;
  conversation_id?: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at?: string | null;
  attachment_url?: string | null;
  attachment_path?: string | null;
  attachment_mime?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_id?: string | null;
  reply_body?: string | null;
  reply_sender_id?: string | null;
  delivery_state?: "delivered" | "blocked";
};

export type MtuMessageInteraction = { message_id: string; emoji: string | null; reaction_count: number; reacted_by_me: boolean; saved_by_me: boolean; pinned_by_me: boolean };

export async function listMtuMessages(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_messages", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuMessage[], error };
}

export async function listMtuMessageInteractions(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_message_interactions", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuMessageInteraction[], error };
}

export async function toggleMtuMessageReaction(client: Pick<SupabaseClient, "rpc">, messageId: string, emoji: string) {
  const { data, error } = await client.rpc("toggle_mtu_message_reaction", { p_message_id: messageId, p_emoji: emoji });
  return { data: Boolean(data), error };
}

export async function toggleMtuSavedMessage(client: Pick<SupabaseClient, "rpc">, messageId: string) {
  const { data, error } = await client.rpc("toggle_mtu_saved_message", { p_message_id: messageId });
  return { data: Boolean(data), error };
}

export async function toggleMtuPinnedMessage(client: Pick<SupabaseClient, "rpc">, conversationId: string, messageId: string) {
  const { data, error } = await client.rpc("toggle_mtu_pinned_message", { p_conversation_id: conversationId, p_message_id: messageId });
  return { data: Boolean(data), error };
}

export async function setMtuConversationPreference(client: Pick<SupabaseClient, "rpc">, conversationId: string, privateLabel: string | null, isArchived: boolean) {
  const { data, error } = await client.rpc("set_mtu_conversation_preference", { p_conversation_id: conversationId, p_private_label: privateLabel, p_is_archived: isArchived });
  return { data, error };
}

export type MtuConversationRailState = { is_pinned: boolean; is_archived: boolean; draft_body: string | null; is_marked_unread?: boolean };

export async function setMtuConversationRailState(client: Pick<SupabaseClient, "rpc">, conversationId: string, pinned: boolean | null, archived: boolean | null, draftBody: string | null, markUnread: boolean | null = null) {
  const args: Record<string, unknown> = { p_conversation_id: conversationId, p_pinned: pinned, p_archived: archived, p_draft_body: draftBody };
  if (markUnread !== null) args.p_mark_unread = markUnread;
  const { data, error } = await client.rpc("set_mtu_conversation_rail_state", args);
  return { data: (data || null) as MtuConversationRailState | null, error };
}

export type MtuPrivacySettings = { allow_messages: "everyone" | "connections" | "nobody"; allow_calls: "everyone" | "connections" | "nobody"; show_read_receipts: boolean; show_online_status: boolean; allow_group_invites: boolean; disappearing_messages_seconds: 0 | 86400 | 604800 | 2592000 };

export async function getMtuPrivacySettings(client: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await client.rpc("get_mtu_privacy_settings");
  return { data: (data || null) as MtuPrivacySettings | null, error };
}

export async function setMtuPrivacySettings(client: Pick<SupabaseClient, "rpc">, settings: MtuPrivacySettings) {
  const { data, error } = await client.rpc("set_mtu_privacy_settings", { p_allow_messages: settings.allow_messages, p_allow_calls: settings.allow_calls, p_show_read_receipts: settings.show_read_receipts, p_show_online_status: settings.show_online_status, p_allow_group_invites: settings.allow_group_invites, p_disappearing_messages_seconds: settings.disappearing_messages_seconds });
  return { data: (data || null) as MtuPrivacySettings | null, error };
}

export type MtuConversationNotificationPreference = { muted_until: string | null; is_muted: boolean };

export async function getMtuConversationNotificationPreference(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("get_mtu_conversation_notification_preference", { p_conversation_id: conversationId });
  return { data: (data || null) as MtuConversationNotificationPreference | null, error };
}

export async function setMtuConversationNotificationPreference(client: Pick<SupabaseClient, "rpc">, conversationId: string, muted: boolean, mutedUntil: string | null = null) {
  const { data, error } = await client.rpc("set_mtu_conversation_notification_preference", { p_conversation_id: conversationId, p_muted: muted, p_muted_until: mutedUntil });
  return { data: (data || null) as MtuConversationNotificationPreference | null, error };
}

export type MtuConversationAppearance = { chat_theme: "convo" | "cream" | "peach" | "sage" | "lavender" | "midnight"; wallpaper_variant: "plain" | "organic" | "campus" | "gradient" };

export async function getMtuConversationAppearance(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("get_mtu_conversation_appearance", { p_conversation_id: conversationId });
  return { data: (data || null) as MtuConversationAppearance | null, error };
}

export async function setMtuConversationAppearance(client: Pick<SupabaseClient, "rpc">, conversationId: string, appearance: MtuConversationAppearance) {
  const { data, error } = await client.rpc("set_mtu_conversation_appearance", { p_conversation_id: conversationId, p_chat_theme: appearance.chat_theme, p_wallpaper_variant: appearance.wallpaper_variant });
  return { data: (data || null) as MtuConversationAppearance | null, error };
}

export type MtuSavedMessage = { message_id: string; conversation_id: string; conversation_title: string; sender_id: string; sender_display_name: string; body: string; created_at: string; attachment_url?: string | null; attachment_mime?: string | null };

export async function listMtuSavedMessages(client: Pick<SupabaseClient, "rpc">, limit = 100) {
  const { data, error } = await client.rpc("list_mtu_saved_messages", { p_limit: limit });
  return { data: (data || []) as MtuSavedMessage[], error };
}

export type MtuConversationSearchResult = { id: string; sender_id: string; sender_display_name: string; body: string; created_at: string; attachment_url?: string | null; attachment_mime?: string | null; reply_to_id?: string | null };

export async function searchMtuConversationMessages(client: Pick<SupabaseClient, "rpc">, conversationId: string, query: string) {
  const { data, error } = await client.rpc("search_mtu_conversation_messages", { p_conversation_id: conversationId, p_query: query });
  return { data: (data || []) as MtuConversationSearchResult[], error };
}


export async function acceptMtuConnectionRequest(client: Pick<SupabaseClient, "rpc">, requestId: string) {
  const { data, error } = await client.rpc("accept_connection_request", { p_request_id: requestId });
  return { data, error };
}

export async function blockMtuStudent(client: Pick<SupabaseClient, "rpc">, studentId: string) {
  const { data, error } = await client.rpc("block_mtu_student", { p_student_id: studentId });
  return { data, error };
}

export type MtuBlockedStudent = { blocked_id: string; display_name: string | null; nickname: string | null; student_id: string | null; avatar_url: string | null; blocked_at: string };

export async function listMtuBlockedStudents(client: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await client.rpc("list_mtu_blocked_students");
  return { data: (data || []) as MtuBlockedStudent[], error };
}

export async function unblockMtuStudent(client: Pick<SupabaseClient, "rpc">, studentId: string) {
  const { data, error } = await client.rpc("unblock_mtu_student", { p_student_id: studentId });
  return { data: Boolean(data), error };
}

export async function reportMtuStudent(client: Pick<SupabaseClient, "rpc">, studentId: string, reason: string) {
  const { data, error } = await client.rpc("report_mtu_student", { p_student_id: studentId, p_reason: reason });
  return { data, error };
}

export async function startMtuDirectConversation(client: Pick<SupabaseClient, "rpc">, otherUserId: string) {
  const { data, error } = await client.rpc("start_mtu_direct_conversation", { p_other_user_id: otherUserId });
  return { data: typeof data === "string" ? data : null, error };
}

export const MTU_GROUP_CATEGORIES = ["academic", "social", "sports", "technology", "business", "arts", "club", "project", "code_tech", "cruise"] as const;
export type MtuGroupCategory = typeof MTU_GROUP_CATEGORIES[number];

export async function createMtuGroupConversation(client: Pick<SupabaseClient, "rpc">, title: string, memberIds: string[] = [], category: MtuGroupCategory = "academic") {
  const { data, error } = await client.rpc("create_mtu_group_conversation", { p_title: title, p_category: category, p_member_ids: memberIds });
  return { data: typeof data === "string" ? data : null, error };
}

export async function touchMtuLastSeen(client: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await client.rpc("touch_mtu_last_seen");
  return { data: typeof data === "string" ? data : null, error };
}

export type MtuGroupSearchResult = { conversation_id: string; title: string; category: MtuGroupCategory | null; group_image_url: string | null; member_count: number; is_member: boolean; my_request_status: "pending" | "approved" | "declined" | null };
export async function searchMtuGroups(client: Pick<SupabaseClient, "rpc">, query = "", category = "all") {
  const { data, error } = await client.rpc("search_mtu_groups", { p_query: query, p_category: category });
  return { data: (data || []) as MtuGroupSearchResult[], error };
}
export async function requestMtuGroupJoin(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("request_mtu_group_join", { p_conversation_id: conversationId });
  return { data: (data || null) as { status: "member" | "pending"; group_title: string } | null, error };
}
export async function endMtuGroup(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("end_mtu_group", { p_conversation_id: conversationId });
  return { data: Boolean(data), error };
}
export async function setMtuGroupPrivate(client: Pick<SupabaseClient, "rpc">, conversationId: string, isPrivate: boolean) {
  const { data, error } = await client.rpc("set_mtu_group_privacy", { p_conversation_id: conversationId, p_is_private: isPrivate });
  return { data: Boolean(data), error };
}
export async function deleteMtuGroupMessage(client: Pick<SupabaseClient, "rpc">, messageId: string) {
  const { data, error } = await client.rpc("delete_mtu_group_message", { p_message_id: messageId });
  return { data: Boolean(data), error };
}
export type MtuSharedFile = { message_id: string; sender_id: string; attachment_url: string; attachment_path: string | null; attachment_mime: string | null; body: string; created_at: string };
export async function listMtuSharedFiles(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_shared_files", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuSharedFile[], error };
}

export type MtuGroupMember = { user_id: string; display_name: string; student_id: string; group_role: "owner" | "admin" | "member" };

export async function listMtuGroupMembers(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_members", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupMember[], error };
}

export async function addMtuGroupMembers(client: Pick<SupabaseClient, "rpc">, conversationId: string, memberIds: string[]) {
  const { data, error } = await client.rpc("add_mtu_group_members", { p_conversation_id: conversationId, p_member_ids: memberIds });
  return { data: Number(data) || 0, error };
}

export async function setMtuGroupMemberRole(client: Pick<SupabaseClient, "rpc">, conversationId: string, memberId: string, role: "admin" | "member") {
  const { data, error } = await client.rpc("set_mtu_group_member_role", { p_conversation_id: conversationId, p_member_id: memberId, p_group_role: role });
  return { data: typeof data === "string" ? data : null, error };
}

export async function removeMtuGroupMember(client: Pick<SupabaseClient, "rpc">, conversationId: string, memberId: string) {
  const { data, error } = await client.rpc("remove_mtu_group_member", { p_conversation_id: conversationId, p_member_id: memberId });
  return { data: Boolean(data), error };
}

export type MtuGroupEvent = { id: string; title: string; description: string; starts_at: string; location: string; created_by: string; going_count: number; my_response: "going" | "maybe" | "declined" | null };
export type MtuGroupNote = { id: string; title: string; body: string; created_by: string; updated_by: string; created_at: string; updated_at: string };
export type MtuGroupAnnouncement = { id: string; title: string; body: string; created_by: string; publish_at: string; expires_at: string | null };

export async function createMtuGroupEvent(client: Pick<SupabaseClient, "rpc">, conversationId: string, title: string, description: string, startsAt: string, location: string) {
  const { data, error } = await client.rpc("create_mtu_group_event", { p_conversation_id: conversationId, p_title: title, p_description: description, p_starts_at: startsAt, p_location: location });
  return { data: typeof data === "string" ? data : null, error };
}
export async function listMtuGroupEvents(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_events", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupEvent[], error };
}
export async function setMtuGroupEventResponse(client: Pick<SupabaseClient, "rpc">, eventId: string, response: "going" | "maybe" | "declined") {
  const { data, error } = await client.rpc("set_mtu_group_event_response", { p_event_id: eventId, p_response: response });
  return { data: typeof data === "string" ? data : null, error };
}
export async function cancelMtuGroupEvent(client: Pick<SupabaseClient, "rpc">, eventId: string) {
  const { data, error } = await client.rpc("cancel_mtu_group_event", { p_event_id: eventId });
  return { data: Boolean(data), error };
}
export async function updateMtuGroupEvent(client: Pick<SupabaseClient, "rpc">, eventId: string, title: string, description: string, startsAt: string, location: string) {
  const { data, error } = await client.rpc("update_mtu_group_event", { p_event_id: eventId, p_title: title, p_description: description, p_starts_at: startsAt, p_location: location });
  return { data: Boolean(data), error };
}
export async function deleteMtuGroupEvent(client: Pick<SupabaseClient, "rpc">, eventId: string) {
  const { data, error } = await client.rpc("delete_mtu_group_event", { p_event_id: eventId });
  return { data: Boolean(data), error };
}
export async function createMtuGroupNote(client: Pick<SupabaseClient, "rpc">, conversationId: string, title: string, body: string) {
  const { data, error } = await client.rpc("create_mtu_group_note", { p_conversation_id: conversationId, p_title: title, p_body: body });
  return { data: typeof data === "string" ? data : null, error };
}
export async function updateMtuGroupNote(client: Pick<SupabaseClient, "rpc">, noteId: string, title: string, body: string) {
  const { data, error } = await client.rpc("update_mtu_group_note", { p_note_id: noteId, p_title: title, p_body: body });
  return { data: Boolean(data), error };
}
export async function listMtuGroupNotes(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_notes", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupNote[], error };
}
export async function createMtuGroupAnnouncement(client: Pick<SupabaseClient, "rpc">, conversationId: string, title: string, body: string, expiresAt: string | null = null) {
  const { data, error } = await client.rpc("create_mtu_group_announcement", { p_conversation_id: conversationId, p_title: title, p_body: body, p_expires_at: expiresAt });
  return { data: typeof data === "string" ? data : null, error };
}
export async function listMtuGroupAnnouncements(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_announcements", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupAnnouncement[], error };
}
export async function updateMtuGroupAnnouncement(client: Pick<SupabaseClient, "rpc">, announcementId: string, title: string, body: string, expiresAt: string | null = null) {
  const { data, error } = await client.rpc("update_mtu_group_announcement", { p_announcement_id: announcementId, p_title: title, p_body: body, p_expires_at: expiresAt });
  return { data: Boolean(data), error };
}
export async function deleteMtuGroupAnnouncement(client: Pick<SupabaseClient, "rpc">, announcementId: string) {
  const { data, error } = await client.rpc("delete_mtu_group_announcement", { p_announcement_id: announcementId });
  return { data: Boolean(data), error };
}

export type MtuGroupPermissions = { allow_member_messages: boolean; allow_member_invites: boolean; require_join_approval: boolean };

export async function createMtuGroupInvite(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("create_mtu_group_invite", { p_conversation_id: conversationId });
  return { data: typeof data === "string" ? data : null, error };
}

export async function revokeMtuGroupInvite(client: Pick<SupabaseClient, "rpc">, conversationId: string, token: string) {
  const { data, error } = await client.rpc("revoke_mtu_group_invite", { p_conversation_id: conversationId, p_token: token });
  return { data: Boolean(data), error };
}

export async function rotateMtuGroupInvite(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("rotate_mtu_group_invite", { p_conversation_id: conversationId });
  return { data: typeof data === "string" ? data : null, error };
}

export async function getMtuGroupPermissions(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("get_mtu_group_permissions", { p_conversation_id: conversationId });
  return { data: (data || null) as MtuGroupPermissions | null, error };
}

export async function setMtuGroupPermissions(client: Pick<SupabaseClient, "rpc">, conversationId: string, permissions: MtuGroupPermissions) {
  const { data, error } = await client.rpc("set_mtu_group_permissions", { p_conversation_id: conversationId, p_allow_member_messages: permissions.allow_member_messages, p_allow_member_invites: permissions.allow_member_invites, p_require_join_approval: permissions.require_join_approval });
  return { data: (data || null) as MtuGroupPermissions | null, error };
}

export type MtuGroupInviteJoin = { conversation_id: string; group_title: string; joined: boolean; pending: boolean };

export async function joinMtuGroupInvite(client: Pick<SupabaseClient, "rpc">, token: string) {
  const { data, error } = await client.rpc("join_mtu_group_invite", { p_token: token });
  return { data: (data || null) as MtuGroupInviteJoin | null, error };
}

export type MtuGroupJoinRequest = { user_id: string; display_name: string; student_id: string; created_at: string };

export async function listMtuGroupJoinRequests(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_join_requests", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupJoinRequest[], error };
}

export async function reviewMtuGroupJoinRequest(client: Pick<SupabaseClient, "rpc">, conversationId: string, userId: string, approve: boolean) {
  const { data, error } = await client.rpc("review_mtu_group_join_request", { p_conversation_id: conversationId, p_user_id: userId, p_approve: approve });
  return { data: Boolean(data), error };
}

export type MtuGroupPollRow = { poll_id: string; message_id: string; question: string; closes_at?: string | null; is_closed: boolean; anonymous_voters: boolean; created_by: string; option_id: string; option_label: string; option_position: number; vote_count: number; selected_by_me: boolean };

export async function createMtuGroupPoll(client: Pick<SupabaseClient, "rpc">, conversationId: string, question: string, options: string[], closesAt: string | null = null, anonymousVoters = false) {
  const { data, error } = await client.rpc("create_mtu_group_poll", { p_conversation_id: conversationId, p_question: question, p_options: options, p_closes_at: closesAt, p_anonymous_voters: anonymousVoters });
  return { data: (data || null) as { poll_id: string; message_id: string } | null, error };
}

export async function listMtuGroupPolls(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_polls", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupPollRow[], error };
}

export async function castMtuGroupPollVote(client: Pick<SupabaseClient, "rpc">, pollId: string, optionId: string) {
  const { data, error } = await client.rpc("cast_mtu_group_poll_vote", { p_poll_id: pollId, p_option_id: optionId });
  return { data: (data || null) as { poll_id: string; option_id: string } | null, error };
}
export async function updateMtuGroupPoll(client: Pick<SupabaseClient, "rpc">, pollId: string, question: string, options: string[], closesAt: string | null = null, anonymousVoters = false) {
  const { data, error } = await client.rpc("update_mtu_group_poll", { p_poll_id: pollId, p_question: question, p_options: options, p_closes_at: closesAt, p_anonymous_voters: anonymousVoters });
  return { data: Boolean(data), error };
}
export async function closeMtuGroupPoll(client: Pick<SupabaseClient, "rpc">, pollId: string) {
  const { data, error } = await client.rpc("close_mtu_group_poll", { p_poll_id: pollId });
  return { data: Boolean(data), error };
}
export async function deleteMtuGroupPoll(client: Pick<SupabaseClient, "rpc">, pollId: string) {
  const { data, error } = await client.rpc("delete_mtu_group_poll", { p_poll_id: pollId });
  return { data: Boolean(data), error };
}

export type MtuGroupTask = { task_id: string; title: string; due_at?: string | null; completed_at?: string | null; created_by: string; assignee_id?: string | null; assignee_display_name?: string | null; completed_by?: string | null; created_at: string };

export async function createMtuGroupTask(client: Pick<SupabaseClient, "rpc">, conversationId: string, title: string, assigneeId: string | null = null, dueAt: string | null = null) {
  const { data, error } = await client.rpc("create_mtu_group_task", { p_conversation_id: conversationId, p_title: title, p_assignee_id: assigneeId, p_due_at: dueAt });
  return { data: typeof data === "string" ? data : null, error };
}

export async function listMtuGroupTasks(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("list_mtu_group_tasks", { p_conversation_id: conversationId });
  return { data: (data || []) as MtuGroupTask[], error };
}

export async function setMtuGroupTaskCompleted(client: Pick<SupabaseClient, "rpc">, taskId: string, completed: boolean) {
  const { data, error } = await client.rpc("set_mtu_group_task_completed", { p_task_id: taskId, p_completed: completed });
  return { data: Boolean(data), error };
}
export async function updateMtuGroupTask(client: Pick<SupabaseClient, "rpc">, taskId: string, title: string, assigneeId: string | null = null, dueAt: string | null = null) {
  const { data, error } = await client.rpc("update_mtu_group_task", { p_task_id: taskId, p_title: title, p_assignee_id: assigneeId, p_due_at: dueAt });
  return { data: Boolean(data), error };
}
export async function deleteMtuGroupTask(client: Pick<SupabaseClient, "rpc">, taskId: string) {
  const { data, error } = await client.rpc("delete_mtu_group_task", { p_task_id: taskId });
  return { data: Boolean(data), error };
}

export function subscribeToMtuGroupActivity(
  client: Pick<SupabaseClient, "channel" | "removeChannel">,
  conversationId: string,
  onChange: () => void,
) {
  const channel = client.channel(`convo-group-activity-${conversationId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_polls", filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_tasks", filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_events", filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_announcements", filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_poll_options" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_poll_votes" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_event_attendees" }, onChange)
    .subscribe();
  return () => { void client.removeChannel(channel); };
}

export async function markMtuConversationRead(client: Pick<SupabaseClient, "rpc">, conversationId: string) {
  const { data, error } = await client.rpc("mark_mtu_conversation_read", { p_conversation_id: conversationId });
  return { data, error };
}

export function subscribeToMtuPublicProfiles(client: Pick<SupabaseClient, "channel" | "removeChannel">, onProfile: (profile: Record<string, unknown>) => void) {
  const channel = client.channel("convo-public-profile-updates")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mtu_public_profile_updates" }, (payload) => onProfile((payload as { new: Record<string, unknown> }).new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mtu_public_profile_updates" }, (payload) => onProfile((payload as { new: Record<string, unknown> }).new))
    .subscribe();
  return () => { void client.removeChannel(channel); };
}

export function subscribeToMtuAllMessages(client: Pick<SupabaseClient, "channel" | "removeChannel">, onMessage: (message: Record<string, unknown>) => void) {
  const channel = client.channel(`convo-message-notifications-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => onMessage((payload as { new: Record<string, unknown> }).new));
  channel.subscribe();
  return () => { void client.removeChannel(channel); };
}

export function subscribeToMtuMessages(client: Pick<SupabaseClient, "channel" | "removeChannel">, conversationId: string, onMessage: (message: Record<string, unknown>) => void) {
  const channel = client.channel(`convo-messages-${conversationId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => onMessage((payload as { new: Record<string, unknown> }).new));
  channel.subscribe();
  return () => { void client.removeChannel(channel); };
}

type MtuConversationChannel = {
  on: (event: string, filter: Record<string, unknown>, callback: (payload: Record<string, unknown>) => void) => MtuConversationChannel;
  subscribe: () => MtuConversationChannel;
  send: (payload: Record<string, unknown>) => Promise<unknown>;
  track?: (payload: Record<string, unknown>) => Promise<unknown>;
  presenceState?: () => Record<string, Array<Record<string, unknown>>>;
};

export function subscribeToMtuConversation(
  client: Pick<SupabaseClient, "channel" | "removeChannel">,
  conversationId: string,
  currentUserIdOrHandlers: string | { onMessage: (message: Record<string, unknown>) => void; onTyping: (userId: string, isTyping: boolean) => void; onReadReceipt: (messageId: string, readAt: string) => void; onPresence?: (userIds: string[]) => void },
  maybeHandlers?: { onMessage: (message: Record<string, unknown>) => void; onTyping: (userId: string, isTyping: boolean) => void; onReadReceipt: (messageId: string, readAt: string) => void; onPresence?: (userIds: string[]) => void },
) {
  const currentUserId = typeof currentUserIdOrHandlers === "string" ? currentUserIdOrHandlers : "";
  const handlers = typeof currentUserIdOrHandlers === "string" ? maybeHandlers! : currentUserIdOrHandlers;
  const channel = client.channel(`convo-conversation-${conversationId}`) as unknown as MtuConversationChannel;
  channel
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => handlers.onMessage((payload.new || {}) as Record<string, unknown>))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => handlers.onMessage((payload.new || {}) as Record<string, unknown>))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reads", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const next = (payload.new || {}) as Record<string, unknown>;
      if (next.message_id) handlers.onReadReceipt(String(next.message_id), String(next.read_at || new Date().toISOString()));
    })
    .on("broadcast", { event: "typing" }, (payload) => {
      const next = (payload.payload || {}) as Record<string, unknown>;
      if (next.user_id) handlers.onTyping(String(next.user_id), Boolean(next.is_typing));
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState?.() || {};
      const userIds = Object.values(state).flat().map((entry) => typeof entry.user_id === "string" ? entry.user_id : "").filter(Boolean);
      handlers.onPresence?.(userIds);
    })
    .subscribe();
  if (currentUserId && channel.track) void channel.track({ user_id: currentUserId });
  return {
    sendTyping: (userId: string, isTyping: boolean) => channel.send({ type: "broadcast", event: "typing", payload: { user_id: userId, is_typing: isTyping } }),
    cleanup: () => { void client.removeChannel(channel as never); },
  };
}
