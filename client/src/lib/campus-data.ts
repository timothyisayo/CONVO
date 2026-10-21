import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type CampusStory = { id: string; name: string; initials: string; tone: string; avatar_url?: string | null };
export type CampusPostMedia = { media_path: string; media_type: "image" | "video"; mime_type: string; position: number; media_url?: string; media_unavailable?: boolean };
export type CampusPost = { id: string; author_id?: string; author_name: string; author_meta: string; author_avatar_url?: string | null; body: string; tone: string; created_at: string; likes: number; media?: CampusPostMedia[] };
export type CampusPostComment = { id: string; post_id: string; author_id: string; author_name: string; author_avatar_url: string | null; body: string; created_at: string };
export type CampusGroup = { id: string; name: string; meta: string; tone: string; members: number; active: boolean };
export type CampusPanelState = "loading" | "error" | "empty" | "preview" | "live";

export function getCampusPanelState(input: { isLoading: boolean; error: string | null; hasItems: boolean; isPreview: boolean }): CampusPanelState {
  if (input.isLoading) return "loading";
  if (input.error) return "error";
  if (!input.hasItems) return "empty";
  return input.isPreview ? "preview" : "live";
}

type MembershipClient = { rpc: (name: string, args?: Record<string, string>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
type CampusClient = NonNullable<typeof supabase>;

function isCampusPostMedia(value: unknown): value is CampusPostMedia {
  if (typeof value !== "object" || value === null) return false;
  const media = value as Record<string, unknown>;
  return typeof media.media_path === "string"
    && (media.media_type === "image" || media.media_type === "video")
    && typeof media.mime_type === "string"
    && typeof media.position === "number";
}

export async function searchCampusPosts(client: CampusClient, query = "") {
  const { data, error } = await client.rpc("list_mtu_campus_posts", { p_query: query.trim() });
  return { data: (data || []) as CampusPost[], error };
}

export async function loadCampusPostPage(
  client: CampusClient,
  query = "",
  cursor?: Pick<CampusPost, "id" | "created_at">,
  pageSize = 20,
) {
  const { data, error } = await client.rpc("list_mtu_campus_posts_page", {
    p_query: query.trim(),
    p_before_created_at: cursor?.created_at || null,
    p_before_id: cursor?.id || null,
    p_limit: pageSize + 1,
  });
  if (error) return { data: [] as CampusPost[], hasMore: false, error };
  if (!Array.isArray(data)) {
    return {
      data: [] as CampusPost[],
      hasMore: false,
      error: new Error("The feed service returned an invalid page. Apply the media-aware campus post migration and try again."),
    };
  }
  const rows: CampusPost[] = [];
  for (const value of data as unknown[]) {
    if (typeof value !== "object" || value === null || !("media" in value)) {
      return {
        data: [] as CampusPost[],
        hasMore: false,
        error: new Error("The feed service is missing post media metadata. Apply the media-aware campus post migration and try again."),
      };
    }
    const media = value.media;
    if (!Array.isArray(media)) {
      return {
        data: [] as CampusPost[],
        hasMore: false,
        error: new Error("The feed service returned invalid post media metadata."),
      };
    }
    if (media.some((item: unknown) => !isCampusPostMedia(item))) {
      return {
        data: [] as CampusPost[],
        hasMore: false,
        error: new Error("The feed service returned invalid post media metadata."),
      };
    }
    rows.push({ ...value, media } as CampusPost);
  }
  const page = await Promise.all(rows.slice(0, pageSize).map(async (post) => {
    const media = await Promise.all((post.media || []).map(async (item) => {
      try {
        const { data: signed, error: signError } = await client.storage
          .from("campus-post-media")
          .createSignedUrl(item.media_path, 5 * 60);
        if (signError) return { ...item, media_unavailable: true };
        return { ...item, media_url: signed.signedUrl };
      } catch {
        return { ...item, media_unavailable: true };
      }
    }));
    return { ...post, media };
  }));
  return { data: page, hasMore: rows.length > pageSize, error: null };
}

type CampusPostCreationReceipt = { post_id: string; created: boolean };

function readCampusPostCreationReceipt(data: unknown): CampusPostCreationReceipt | null {
  const receipt = Array.isArray(data) ? data[0] : data;
  if (typeof receipt !== "object" || receipt === null) return null;
  const value = receipt as Record<string, unknown>;
  return typeof value.post_id === "string" && typeof value.created === "boolean"
    ? { post_id: value.post_id, created: value.created }
    : null;
}

export async function createCampusPost(client: CampusClient, body: string, requestId: string) {
  const { data, error } = await client.rpc("create_mtu_campus_post_once", {
    p_body: body,
    p_request_id: requestId,
  });
  if (error) return { data: null, postId: null, persisted: false, error };
  const receipt = readCampusPostCreationReceipt(data);
  if (!receipt) {
    return { data: null, postId: null, persisted: false, error: new Error("The post service returned an invalid confirmation.") };
  }
  const refreshed = await loadCampusPostPage(client);
  if (refreshed.error) {
    return { data: null, postId: receipt.post_id, persisted: true, error: new Error("Your post was published, but the feed could not refresh.") };
  }
  const post = refreshed.data.find((item) => item.id === receipt.post_id) || null;
  return {
    data: post,
    postId: receipt.post_id,
    persisted: true,
    error: post ? null : new Error("Your post was published, but the feed could not load it."),
  };
}

export const CAMPUS_POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const CAMPUS_POST_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const CAMPUS_POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CAMPUS_POST_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

async function hashCampusPostMedia(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateCampusPostMedia(files: readonly Pick<File, "type" | "size">[]) {
  if (files.length > 10) return { valid: false as const, error: "Choose up to 10 images or one video." };
  const hasVideo = files.some((file) => CAMPUS_POST_VIDEO_TYPES.includes(file.type as (typeof CAMPUS_POST_VIDEO_TYPES)[number]));
  if (hasVideo && (files.length !== 1 || !CAMPUS_POST_VIDEO_TYPES.includes(files[0].type as (typeof CAMPUS_POST_VIDEO_TYPES)[number]))) {
    return { valid: false as const, error: "Choose one video per post, or add up to 10 images." };
  }
  for (const file of files) {
    if (CAMPUS_POST_IMAGE_TYPES.includes(file.type as (typeof CAMPUS_POST_IMAGE_TYPES)[number])) {
      if (file.size > CAMPUS_POST_IMAGE_MAX_BYTES) return { valid: false as const, error: "Each post image must be 8 MB or smaller." };
      continue;
    }
    if (CAMPUS_POST_VIDEO_TYPES.includes(file.type as (typeof CAMPUS_POST_VIDEO_TYPES)[number])) {
      if (file.size > CAMPUS_POST_VIDEO_MAX_BYTES) return { valid: false as const, error: "Post videos must be 50 MB or smaller." };
      continue;
    }
    return { valid: false as const, error: "Use JPG, PNG, WebP images or MP4, WebM, QuickTime videos." };
  }
  return { valid: true as const, error: "" };
}

export async function createCampusPostWithMedia(
  client: CampusClient,
  userId: string,
  body: string,
  files: readonly File[],
  requestId: string,
  onUploadProgress?: (completed: number, total: number) => void,
) {
  const caption = body.trim();
  if (!caption && files.length === 0) {
    return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error("Add a caption or choose media.") };
  }
  if (caption.length > 2000) {
    return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error("Captions must be 2000 characters or fewer.") };
  }
  const validation = validateCampusPostMedia(files);
  if (!validation.valid) return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error(validation.error) };

  const uploadedPaths: string[] = [];
  const media: Array<{ media_path: string; media_type: "image" | "video"; mime_type: string; content_hash: string }> = [];
  const cleanupUploads = async () => {
    if (!uploadedPaths.length) return null;
    try {
      const { error } = await client.storage.from("campus-post-media").remove(uploadedPaths);
      return error;
    } catch (caught) {
      return caught instanceof Error ? caught : new Error("Uploaded media cleanup failed.");
    }
  };

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1]?.replace("quicktime", "mov");
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;
    try {
      const contentHash = await hashCampusPostMedia(file);
      const upload = await client.storage.from("campus-post-media").upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: "3600",
      });
      if (upload.error) {
        const cleanupError = await cleanupUploads();
        const message = cleanupError
          ? `${upload.error.message} Previously uploaded media cleanup failed: ${cleanupError.message}`
          : upload.error.message;
        return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error(message) };
      }
      uploadedPaths.push(path);
      media.push({
        media_path: path,
        media_type: file.type.startsWith("video/") ? "video" : "image",
        mime_type: file.type,
        content_hash: contentHash,
      });
    } catch (caught) {
      const cleanupError = await cleanupUploads();
      const originalError = caught instanceof Error ? caught.message : "Media upload failed.";
      const message = cleanupError
        ? `${originalError} Previously uploaded media cleanup failed: ${cleanupError.message}`
        : originalError;
      return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error(message) };
    }
    try {
      onUploadProgress?.(index + 1, files.length);
    } catch (caught) {
      const cleanupError = await cleanupUploads();
      const originalError = caught instanceof Error ? caught.message : "Upload progress could not be reported.";
      const message = cleanupError
        ? `${originalError} Uploaded media cleanup failed: ${cleanupError.message}`
        : originalError;
      return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error(message) };
    }
  }

  let receipt: CampusPostCreationReceipt | null = null;
  let publishError: Error | null = null;
  try {
    const created = await client.rpc("create_mtu_campus_post_with_media_once", {
      p_body: caption,
      p_media: media,
      p_request_id: requestId,
    });
    receipt = readCampusPostCreationReceipt(created.data);
    if (created.error) publishError = new Error(created.error.message);
    else if (!receipt) publishError = new Error("The post service returned an invalid confirmation.");
  } catch (caught) {
    publishError = caught instanceof Error ? caught : new Error("The post could not be confirmed.");
  }
  if (publishError || !receipt) {
    const cleanupError = await cleanupUploads();
    const message = cleanupError
      ? `${publishError?.message || "The post could not be published."} Uploaded media cleanup failed: ${cleanupError.message}`
      : `${publishError?.message || "The post could not be confirmed."} Retrying this submission with the same request id is safe.`;
    return { data: null as CampusPost | null, postId: null, persisted: false, error: new Error(message) };
  }
  if (!receipt.created) {
    const cleanupError = await cleanupUploads();
    if (cleanupError) {
      return {
        data: null as CampusPost | null,
        postId: receipt.post_id,
        persisted: true,
        error: new Error("Your earlier post was already published. Temporary media from this retry could not be cleaned up."),
      };
    }
  }

  const refreshed = await loadCampusPostPage(client);
  if (refreshed.error) {
    return { data: null as CampusPost | null, postId: receipt.post_id, persisted: true, error: new Error("Your post was published, but the feed could not refresh.") };
  }
  const post = refreshed.data.find((item) => item.id === receipt.post_id) || null;
  return {
    data: post,
    postId: receipt.post_id,
    persisted: true,
    error: post ? null : new Error("Your post was published, but the feed could not load it."),
  };
}

export async function loadCampusPostComments(client: CampusClient, postId: string) {
  const { data, error } = await client.rpc("list_mtu_campus_post_comments", { p_post_id: postId });
  return { data: (data || []) as CampusPostComment[], error };
}

export async function createCampusPostComment(client: CampusClient, postId: string, body: string) {
  const { data, error } = await client.rpc("create_mtu_campus_post_comment", { p_post_id: postId, p_body: body });
  return { data: (data as string | null) || null, error };
}

export async function deleteCampusPostComment(client: CampusClient, commentId: string) {
  const { data, error } = await client.rpc("delete_mtu_campus_post_comment", { p_comment_id: commentId });
  return { ok: data === true, error };
}

export async function updateCampusPost(client: CampusClient, postId: string, body: string) {
  const { data, error } = await client.rpc("update_mtu_campus_post", { p_post_id: postId, p_body: body });
  return { ok: Boolean(data), error };
}

export async function deleteCampusPost(client: CampusClient, postId: string) {
  const { data, error } = await client.rpc("delete_mtu_campus_post", { p_post_id: postId });
  if (error) return { ok: false, error };
  const paths = Array.isArray(data) ? data.filter((path): path is string => typeof path === "string") : [];
  if (!paths.length) return { ok: true, error: null };
  try {
    const cleanup = await client.storage.from("campus-post-media").remove(paths);
    return { ok: true, error: cleanup.error };
  } catch (caught) {
    return { ok: true, error: caught instanceof Error ? caught : new Error("The post was deleted, but its media cleanup failed.") };
  }
}

export async function loadMyCampusPostReactions(client: CampusClient, postIds: string[]) {
  if (!postIds.length) return { data: [] as string[], error: null };
  const { data, error } = await client.rpc("list_mtu_campus_post_reactions", { p_post_ids: postIds });
  if (error) return { data: [] as string[], error };
  if (!Array.isArray(data)) {
    return { data: [] as string[], error: new Error("The post reaction service returned an invalid response.") };
  }

  const likedPostIds: string[] = [];
  for (const row of data as unknown[]) {
    if (typeof row !== "object" || row === null || !("post_id" in row) || typeof row.post_id !== "string") {
      return { data: [] as string[], error: new Error("The post reaction service returned an invalid response.") };
    }
    likedPostIds.push(row.post_id);
  }
  return { data: likedPostIds, error: null };
}

export async function toggleCampusPostReaction(client: CampusClient, postId: string) {
  const { data, error } = await client.rpc("toggle_mtu_campus_post_reaction", { p_post_id: postId });
  const result = Array.isArray(data) ? data[0] as { liked: boolean; like_count: number } | undefined : undefined;
  return { data: result || null, error };
}

export async function loadMyCampusPostSaves(client: CampusClient, postIds: string[]) {
  if (!postIds.length) return { data: [] as string[], error: null };
  const { data, error } = await client.rpc("list_mtu_campus_post_saves", { p_post_ids: postIds });
  if (error) return { data: [] as string[], error };
  if (!Array.isArray(data)) {
    return { data: [] as string[], error: new Error("The post save service returned an invalid response.") };
  }
  const savedPostIds: string[] = [];
  for (const row of data as unknown[]) {
    if (typeof row !== "object" || row === null || !("post_id" in row) || typeof row.post_id !== "string") {
      return { data: [] as string[], error: new Error("The post save service returned an invalid response.") };
    }
    savedPostIds.push(row.post_id);
  }
  return { data: savedPostIds, error: null };
}

export async function toggleCampusPostSave(client: CampusClient, postId: string) {
  const { data, error } = await client.rpc("toggle_mtu_campus_post_save", { p_post_id: postId });
  return { data: typeof data === "boolean" ? data : null, error };
}

export async function reportCampusPost(client: CampusClient, postId: string, reason: string, details: string) {
  const { data, error } = await client.rpc("report_mtu_campus_post", {
    p_post_id: postId,
    p_reason: reason,
    p_details: details.trim(),
  });
  return { ok: data === true, error };
}

export async function joinCampusGroup(client: MembershipClient, userId: string, groupId: string) {
  const { data, error } = await client.rpc("join_campus_group", { p_group_id: groupId });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, alreadyJoined: data === false };
}

export function useCampusData() {
  const [stories, setStories] = useState<CampusStory[]>([]);
  const [posts, setPosts] = useState<CampusPost[]>([]);
  const [groups, setGroups] = useState<CampusGroup[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [joinedGroupIds, setJoinedGroupIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) { setIsLoading(false); return; }
    let active = true;
    const load = async () => {
      const { data: authData } = await client.auth.getUser();
      const currentUserId = authData.user?.id || null;
      if (active) setUserId(currentUserId);
      const [storiesResult, postsResult, groupsResult] = await Promise.all([
        client.from("campus_stories").select("id,name,initials,tone,avatar_url").eq("is_active", true).order("created_at", { ascending: false }).limit(8),
        client.rpc("list_mtu_campus_posts", { p_query: "" }),
        client.from("campus_groups").select("id,name,meta,tone,members,active").order("active", { ascending: false }).limit(6),
      ]);
      const membershipResult = currentUserId ? await client.rpc("get_my_campus_group_memberships") : { data: [], error: null };
      if (!active) return;
      const firstError = storiesResult.error || postsResult.error || groupsResult.error || membershipResult.error;
      if (firstError) setError(firstError.message);
      if (!storiesResult.error) setStories((storiesResult.data || []) as CampusStory[]);
      if (!postsResult.error) setPosts((postsResult.data || []) as CampusPost[]);
      if (!groupsResult.error) setGroups((groupsResult.data || []) as CampusGroup[]);
      if (!membershipResult.error) setJoinedGroupIds((membershipResult.data || []).map((membership: { group_id: string }) => membership.group_id));
      setIsLive(!storiesResult.error && !postsResult.error && !groupsResult.error && !membershipResult.error);
      setIsLoading(false);
    };
    void load();
    const channel = client.channel("campus-live").on("postgres_changes", { event: "*", schema: "public", table: "campus_posts" }, () => void load()).on("postgres_changes", { event: "*", schema: "public", table: "campus_groups" }, () => void load()).on("postgres_changes", { event: "*", schema: "public", table: "campus_group_memberships" }, () => void load()).subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, []);

  const joinGroup = useCallback(async (groupId: string) => {
    if (!supabase || !userId) return { ok: false, error: "Sign in to join a group." };
    if (joinedGroupIds.includes(groupId)) return { ok: true, alreadyJoined: true };
    const result = await joinCampusGroup(supabase, userId, groupId);
    if (!result.ok) return result;
    setJoinedGroupIds((current) => current.includes(groupId) ? current : [...current, groupId]);
    return { ok: true, alreadyJoined: false };
  }, [joinedGroupIds, userId]);

  return {
    stories,
    posts,
    groups,
    joinedGroupIds,
    joinGroup,
    isLive,
    isLoading,
    error,
    mode: supabase ? (isLive ? "live" : "connecting") : "setup" as const,
  };
}
