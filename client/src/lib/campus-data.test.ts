import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createCampusPost, createCampusPostWithMedia, deleteCampusPost, loadCampusPostPage, loadMyCampusPostReactions, loadMyCampusPostSaves, reportCampusPost, toggleCampusPostSave, validateCampusPostMedia } from "./campus-data";

describe("campus post pagination", () => {
  it("uses a stable created-at/id cursor, requests one extra row, and reports more pages", async () => {
    const rows = [
      { id: "post-1", created_at: "2026-10-20T10:00:00.000Z", media: [] },
      { id: "post-2", created_at: "2026-10-20T09:00:00.000Z", media: [] },
    ];
    const rpc = vi.fn(async () => ({ data: rows, error: null }));
    const client = { rpc } as never;

    await expect(loadCampusPostPage(
      client,
      " study ",
      { id: "post-3", created_at: "2026-10-20T08:00:00.000Z" },
      1,
    )).resolves.toEqual({
      data: [{ ...rows[0], media: [] }],
      hasMore: true,
      error: null,
    });

    expect(rpc).toHaveBeenCalledWith("list_mtu_campus_posts_page", {
      p_query: "study",
      p_before_created_at: "2026-10-20T08:00:00.000Z",
      p_before_id: "post-3",
      p_limit: 2,
    });
  });

  it("does not report another page when the extra row is absent", async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: "post-1", created_at: "2026-10-20T10:00:00.000Z", media: [] }], error: null }));
    const client = { rpc } as never;

    await expect(loadCampusPostPage(client, "", undefined, 1)).resolves.toMatchObject({
      data: [{ id: "post-1", media: [] }],
      hasMore: false,
      error: null,
    });
  });

  it("surfaces the old RPC result shape instead of silently dropping media", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ id: "post-1", created_at: "2026-10-20T10:00:00.000Z" }],
      error: null,
    }));
    const client = { rpc } as never;

    await expect(loadCampusPostPage(client)).resolves.toMatchObject({
      data: [],
      hasMore: false,
      error: { message: expect.stringContaining("missing post media metadata") },
    });
  });

  it("publishes text through the idempotent request-id RPC and returns the saved post", async () => {
    const rpc = vi.fn(async (name: string) => name === "create_mtu_campus_post_once"
      ? { data: [{ post_id: "post-text", created: true }], error: null }
      : { data: [{ id: "post-text", body: "A persisted text post", created_at: "2026-10-20T10:00:00.000Z", media: [] }], error: null });
    const client = { rpc } as never;

    await expect(createCampusPost(client, "A persisted text post", "request-text")).resolves.toMatchObject({
      postId: "post-text",
      persisted: true,
      data: { id: "post-text", body: "A persisted text post", media: [] },
      error: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "create_mtu_campus_post_once", {
      p_body: "A persisted text post",
      p_request_id: "request-text",
    });
  });

  it("maps private media metadata and signs each visible object", async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        id: "post-1",
        created_at: "2026-10-20T10:00:00.000Z",
        media: [{
          media_path: "student-1/post.webp",
          media_type: "image",
          mime_type: "image/webp",
          position: 0,
        }],
      }],
      error: null,
    }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: "https://storage.example.test/signed-post.webp" },
      error: null,
    }));
    const client = {
      rpc,
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    } as never;

    await expect(loadCampusPostPage(client)).resolves.toMatchObject({
      data: [{
        media: [{
          media_path: "student-1/post.webp",
          media_type: "image",
          mime_type: "image/webp",
          position: 0,
          media_url: "https://storage.example.test/signed-post.webp",
        }],
      }],
      error: null,
    });
    expect(createSignedUrl).toHaveBeenCalledWith("student-1/post.webp", 5 * 60);
  });

  it("accepts supported images and one supported video, but rejects mixed media and oversized files", () => {
    expect(validateCampusPostMedia([
      { type: "image/jpeg", size: 100 },
      { type: "image/webp", size: 100 },
    ]).valid).toBe(true);
    expect(validateCampusPostMedia([{ type: "video/mp4", size: 100 }]).valid).toBe(true);
    expect(validateCampusPostMedia([
      { type: "video/mp4", size: 100 },
      { type: "image/jpeg", size: 100 },
    ]).valid).toBe(false);
    expect(validateCampusPostMedia([{ type: "image/png", size: 9 * 1024 * 1024 }]).error).toMatch(/8 MB/);
    expect(validateCampusPostMedia([{ type: "video/webm", size: 51 * 1024 * 1024 }]).error).toMatch(/50 MB/);
  });

  it("sends a content fingerprint and request id, then retrieves the published post", async () => {
    const file = new File(["photo"], "post.png", { type: "image/png" });
    const mediaPath = "student-1/upload.png";
    const rpc = vi.fn(async (name: string) => name === "create_mtu_campus_post_with_media_once"
      ? { data: [{ post_id: "post-1", created: true }], error: null }
      : { data: [{ id: "post-1", created_at: "2026-10-20T10:00:00.000Z", media: [{ media_path: mediaPath, media_type: "image", mime_type: "image/png", position: 0 }] }], error: null });
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ error: null }));
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://storage.example.test/post.png" }, error: null }));
    const client = {
      rpc,
      storage: { from: vi.fn(() => ({ upload, remove, createSignedUrl })) },
    } as never;

    const result = await createCampusPostWithMedia(client, "student-1", "Caption", [file], "request-1");

    expect(result).toMatchObject({ postId: "post-1", persisted: true, error: null });
    const publishCall = rpc.mock.calls[0];
    expect(publishCall[0]).toBe("create_mtu_campus_post_with_media_once");
    expect(publishCall[1]).toMatchObject({
      p_body: "Caption",
      p_request_id: "request-1",
      p_media: [{
        media_path: expect.any(String),
        media_type: "image",
        mime_type: "image/png",
        content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }],
    });
    expect(remove).not.toHaveBeenCalled();
    expect(createSignedUrl).toHaveBeenCalledWith(mediaPath, 5 * 60);
  });

  it("cleans uploaded media when the publish response is malformed", async () => {
    const file = new File(["photo"], "post.png", { type: "image/png" });
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = {
      rpc,
      storage: { from: vi.fn(() => ({ upload, remove })) },
    } as never;

    const result = await createCampusPostWithMedia(client, "student-1", "Caption", [file], "request-2");

    expect(result.persisted).toBe(false);
    expect(result.error?.message).toContain("invalid confirmation");
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^student-1\//)]);
  });

  it("removes media only after the post deletion RPC succeeds", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: ["student-1/post.png"], error: null }));
    const client = { rpc, storage: { from: vi.fn(() => ({ remove })) } } as never;

    await expect(deleteCampusPost(client, "post-1")).resolves.toEqual({ ok: true, error: null });
    expect(rpc).toHaveBeenCalledWith("delete_mtu_campus_post", { p_post_id: "post-1" });
    expect(remove).toHaveBeenCalledWith(["student-1/post.png"]);
  });
});

describe("campus post saves and reports", () => {
  it("loads saved post ids, toggles a save, and submits the report reason", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_mtu_campus_post_saves") return { data: [{ post_id: "post-1" }], error: null };
      if (name === "toggle_mtu_campus_post_save") return { data: true, error: null };
      return { data: true, error: null };
    });
    const client = { rpc } as never;

    await expect(loadMyCampusPostSaves(client, ["post-1"])).resolves.toEqual({ data: ["post-1"], error: null });
    await expect(toggleCampusPostSave(client, "post-1")).resolves.toEqual({ data: true, error: null });
    await expect(reportCampusPost(client, "post-1", "spam", "Unrelated links")).resolves.toEqual({ ok: true, error: null });
    expect(rpc).toHaveBeenNthCalledWith(1, "list_mtu_campus_post_saves", { p_post_ids: ["post-1"] });
    expect(rpc).toHaveBeenNthCalledWith(2, "toggle_mtu_campus_post_save", { p_post_id: "post-1" });
    expect(rpc).toHaveBeenNthCalledWith(3, "report_mtu_campus_post", {
      p_post_id: "post-1",
      p_reason: "spam",
      p_details: "Unrelated links",
    });
  });
});

describe("campus media migration contract", () => {
  it("defines the media-aware page result and request-id publishing wrapper", async () => {
    const mediaMigration = await readFile(
      new URL("../../../supabase/migrations/20261025000000_campus_post_media.sql", import.meta.url),
      "utf8",
    );
    const idempotencyMigration = await readFile(
      new URL("../../../supabase/migrations/20261027000000_campus_post_media_idempotency.sql", import.meta.url),
      "utf8",
    );

    expect(mediaMigration).toContain("media jsonb");
    expect(mediaMigration).toContain("'media_path'");
    expect(mediaMigration).toContain("'media_type'");
    expect(mediaMigration).toContain("'mime_type'");
    expect(mediaMigration).toContain("'position'");
    expect(mediaMigration).toContain("set public = false");
    expect(idempotencyMigration).toContain("create_mtu_campus_post_with_media_once");
    expect(idempotencyMigration).toContain("p_request_id uuid");
    expect(idempotencyMigration).toContain("media_manifest is distinct from normalized_manifest");
    expect(idempotencyMigration).toContain("can_delete_unclaimed_campus_post_media");
    expect(idempotencyMigration).toContain("security definer");
    expect(idempotencyMigration).toContain("Members delete their own unclaimed campus post media");
    expect(idempotencyMigration).toContain("where media.media_path = p_media_path");
    expect(idempotencyMigration).toContain("grant execute on function public.create_mtu_campus_post_with_media_once");
  });

  it("keeps the media delete predicate limited to unclaimed Story and post objects", async () => {
    const storyCleanupMigration = await readFile(
      new URL("../../../supabase/migrations/20261028000000_status_media_deletion_privacy.sql", import.meta.url),
      "utf8",
    );
    expect(storyCleanupMigration).toContain("can_delete_unclaimed_status_media");
    expect(storyCleanupMigration).toContain("where post.media_path = p_media_path");
    expect(storyCleanupMigration).toContain("bucket_id = 'status-media'");
    expect(storyCleanupMigration).toContain("Students delete their own unclaimed status media");
  });

  it("checks post-media visibility through a narrowly scoped security-definer Storage policy", async () => {
    const storageMigration = await readFile(
      new URL("../../../supabase/migrations/20261030000000_campus_post_media_storage_visibility.sql", import.meta.url),
      "utf8",
    );
    expect(storageMigration).toContain("can_read_mtu_campus_post_media");
    expect(storageMigration).toContain("security definer");
    expect(storageMigration).toContain("set row_security = off");
    expect(storageMigration).toContain("media.media_path = p_media_path");
    expect(storageMigration).toContain("public.mtu_campus_post_is_visible(media.post_id)");
    expect(storageMigration).toContain("bucket_id = 'campus-post-media'");
    expect(storageMigration).toContain("grant execute on function public.can_read_mtu_campus_post_media(text) to authenticated");
    expect(storageMigration).toContain("drop policy if exists \"Eligible members read visible campus post media\" on storage.objects");
    expect(storageMigration).not.toContain("from public.campus_post_media media\n      where media.media_path = storage.objects.name");
  });

  it("repairs the media-aware feed RPC and private Storage policy together", async () => {
    const repairMigration = await readFile(
      new URL("../../../supabase/migrations/20261033000000_campus_post_media_feed_and_storage_repair.sql", import.meta.url),
      "utf8",
    );
    expect(repairMigration).toContain("to_regclass('public.campus_post_media')");
    expect(repairMigration).toContain("returns table (");
    expect(repairMigration).toContain("media jsonb");
    expect(repairMigration).toContain("coalesce(media.items, '[]'::jsonb)");
    expect(repairMigration).toContain("set row_security = off");
    expect(repairMigration).toContain("public.mtu_campus_post_is_visible(media.post_id)");
    expect(repairMigration).toContain("public.can_read_mtu_campus_post_media(name)");
    expect(repairMigration).toContain("bucket_id = 'campus-post-media'");
    expect(repairMigration).toContain("notify pgrst, 'reload schema'");
    expect(repairMigration).not.toContain("set public = true");
    expect(repairMigration).not.toContain("grant select on public.campus_post_media");
  });

  it("defines the text-post idempotency RPC used by the composer", async () => {
    const textMigration = await readFile(
      new URL("../../../supabase/migrations/20261032000000_campus_post_text_idempotency.sql", import.meta.url),
      "utf8",
    );
    expect(textMigration).toContain("create or replace function public.create_mtu_campus_post_once");
    expect(textMigration).toContain("p_request_id uuid");
    expect(textMigration).toContain("for update");
    expect(textMigration).toContain("media_manifest is distinct from '[]'::jsonb");
    expect(textMigration).toContain("This post request id was already used with different content");
    expect(textMigration).toContain("grant execute on function public.create_mtu_campus_post_once(text, uuid) to authenticated");
  });
});

describe("campus post reactions", () => {
  it("returns the IDs of the current user's persisted reactions", async () => {
    const rpc = vi.fn(async () => ({ data: [{ post_id: "post-1" }], error: null }));
    const client = { rpc } as never;

    await expect(loadMyCampusPostReactions(client, ["post-1"])).resolves.toEqual({
      data: ["post-1"],
      error: null,
    });
  });

  it("reports malformed reaction responses instead of treating them as no reactions", async () => {
    const rpc = vi.fn(async () => ({ data: [{ post_id: 42 }], error: null }));
    const client = { rpc } as never;
    const result = await loadMyCampusPostReactions(client, ["post-1"]);

    expect(result.data).toEqual([]);
    expect(result.error?.message).toBe("The post reaction service returned an invalid response.");
  });
});
