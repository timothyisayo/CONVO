// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CampusFeedPanel } from "./CampusFeedPanel";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/StatusStories", () => ({ StatusStories: () => null }));
afterEach(cleanup);

describe("CampusFeedPanel", () => {
  it("opens the separate Marketplace destination from Campus Hub", () => {
    const onOpenMarketplace = vi.fn();
    render(
      <CampusFeedPanel
        client={null}
        posts={[]}
        displayName="Ada"
        onOpenMessages={vi.fn()}
        onOpenMarketplace={onOpenMarketplace}
        onOpenEvents={vi.fn()}
        onMessageMember={vi.fn(async () => ({ error: null }))}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    expect(onOpenMarketplace).toHaveBeenCalledOnce();
  });

  it("opens a distinct short-video feed using only persisted video posts", async () => {
    const videoPost = {
      id: "video-post",
      author_id: "student-video",
      author_name: "Moyin",
      author_meta: "Computer Science · 300 Level",
      body: "A real video post",
      tone: "sage",
      created_at: "2026-10-20T00:00:00.000Z",
      likes: 3,
      media: [{
        media_path: "student-video/clip.mp4",
        media_type: "video",
        mime_type: "video/mp4",
        position: 0,
      }],
    };
    const textPost = {
      id: "text-post",
      author_id: "student-text",
      author_name: "Ada",
      author_meta: "Computer Science",
      body: "A text-only post",
      tone: "rose",
      created_at: "2026-10-19T00:00:00.000Z",
      likes: 0,
      media: [],
    };
    const client = {
      rpc: vi.fn(async () => ({ data: [videoPost, textPost], error: null })),
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async () => ({
            data: { signedUrl: "https://storage.example.test/clip.mp4" },
            error: null,
          })),
        })),
      },
    } as unknown as SupabaseClient;

    render(
      <CampusFeedPanel
        client={client}
        posts={[]}
        displayName="Ada"
        onOpenMessages={vi.fn()}
        onOpenMarketplace={vi.fn()}
        onOpenEvents={vi.fn()}
        onMessageMember={vi.fn(async () => ({ error: null }))}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Short videos" }));
    expect(await screen.findByRole("region", { name: "Short video feed" })).toBeTruthy();
    expect(screen.getByText("A real video post")).toBeTruthy();
    expect(screen.queryByText("A text-only post")).toBeNull();
    expect(document.querySelector(".short-video-feed-item video")?.getAttribute("src")).toBe("https://storage.example.test/clip.mp4");
    expect(screen.getByRole("button", { name: "All posts" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows current profile names and photos and opens a persisted comment discussion", async () => {
    const post = {
      id: "post-1",
      author_id: "student-1",
      author_name: "Moyin",
      author_meta: "Computer Science · 300 Level",
      author_avatar_url: "https://cdn.example.test/moyin.png",
      body: "Testing the feed",
      tone: "sage",
      created_at: "2026-10-20T00:00:00.000Z",
      likes: 0,
      media: [],
    };
    const comment = {
      id: "comment-1",
      post_id: "post-1",
      author_id: "student-2",
      author_name: "Ada",
      author_avatar_url: "https://cdn.example.test/ada.png",
      body: "Looks good!",
      created_at: "2026-10-20T00:01:00.000Z",
    };
    const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "list_mtu_campus_posts_page") return { data: [post], error: null };
      if (name === "list_mtu_campus_post_comments") return { data: [comment], error: null };
      return { data: [], error: null };
    });
    const client = { rpc } as unknown as SupabaseClient;
    const onOpenMemberProfile = vi.fn();

    render(
      <CampusFeedPanel
        client={client}
        currentUserId="student-2"
        displayName="Ada"
        avatarUrl="https://cdn.example.test/ada.png"
        posts={[]}
        onOpenMessages={vi.fn()}
        onOpenMarketplace={vi.fn()}
        onOpenEvents={vi.fn()}
        onMessageMember={vi.fn(async () => ({ error: null }))}
        onOpenMemberProfile={onOpenMemberProfile}
      />
    );

    expect(await screen.findByText("Moyin")).toBeTruthy();
    expect(document.querySelector(".campus-pulse-card .feed-avatar img")?.getAttribute("src")).toBe(post.author_avatar_url);
    fireEvent.click(screen.getByRole("button", { name: "Moyin" }));
    expect(onOpenMemberProfile).toHaveBeenCalledWith("student-1", "Moyin");
    fireEvent.click(screen.getByRole("button", { name: "Discuss" }));
    expect(await screen.findByText("Looks good!")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Message poster" })).toBeTruthy();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("list_mtu_campus_post_comments", { p_post_id: "post-1" }));
  });

  it("saves a post and submits a categorized report without affecting the post", async () => {
    const post = {
      id: "post-save",
      author_id: "student-1",
      author_name: "Moyin",
      author_meta: "Computer Science",
      body: "Keep this post handy",
      tone: "sage",
      created_at: "2026-10-20T00:00:00.000Z",
      likes: 0,
      media: [],
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_mtu_campus_posts_page") return { data: [post], error: null };
      if (name === "toggle_mtu_campus_post_save") return { data: true, error: null };
      if (name === "report_mtu_campus_post") return { data: true, error: null };
      return { data: [], error: null };
    });
    render(
      <CampusFeedPanel
        client={{ rpc } as unknown as SupabaseClient}
        currentUserId="student-2"
        posts={[]}
        displayName="Ada"
        onOpenMessages={vi.fn()}
        onOpenMarketplace={vi.fn()}
        onOpenEvents={vi.fn()}
        onMessageMember={vi.fn(async () => ({ error: null }))}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Save post" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("toggle_mtu_campus_post_save", { p_post_id: "post-save" }));
    expect(await screen.findByRole("button", { name: "Remove saved post" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Report post" }));
    fireEvent.change(screen.getByLabelText("Why are you reporting this post?"), { target: { value: "spam" } });
    fireEvent.change(screen.getByLabelText("Additional details (optional)"), { target: { value: "Repeated unrelated links" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("report_mtu_campus_post", {
      p_post_id: "post-save",
      p_reason: "spam",
      p_details: "Repeated unrelated links",
    }));
    expect(screen.getByText("Keep this post handy")).toBeTruthy();
  });

  it("copies a real post anchor when native sharing is unavailable", async () => {
    const post = {
      id: "post-share",
      author_id: "student-1",
      author_name: "Moyin",
      author_meta: "Computer Science",
      body: "Share this post",
      tone: "sage",
      created_at: "2026-10-20T00:00:00.000Z",
      likes: 0,
      media: [],
    };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const client = {
      rpc: vi.fn(async () => ({ data: [post], error: null })),
    } as unknown as SupabaseClient;

    render(
      <CampusFeedPanel
        client={client}
        posts={[]}
        displayName="Ada"
        onOpenMessages={vi.fn()}
        onOpenMarketplace={vi.fn()}
        onOpenEvents={vi.fn()}
        onMessageMember={vi.fn(async () => ({ error: null }))}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Share post" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#campus-post-post-share")));
  });

  it("reuses a failed submission id only while the draft content stays the same", async () => {
    const post = {
      id: "post-1",
      author_id: "student-1",
      author_name: "Ada",
      author_meta: "Computer Science · 300 Level",
      body: "Updated draft",
      tone: "sage",
      created_at: "2026-10-20T00:00:00.000Z",
      likes: 0,
      media: [],
    };
    let publishAttempts = 0;
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "list_mtu_campus_posts_page") return { data: publishAttempts >= 3 ? [post] : [], error: null };
      if (name === "create_mtu_campus_post_once") {
        publishAttempts += 1;
        return publishAttempts < 3
          ? { data: null, error: { message: "temporary publish failure" } }
          : { data: [{ post_id: post.id, created: true }], error: null };
      }
      return { data: [], error: null };
    });
    const client = { rpc } as unknown as SupabaseClient;

    render(
      <CampusFeedPanel
        client={client}
        currentUserId="student-1"
        displayName="Ada"
        posts={[]}
        onOpenMessages={vi.fn()}
        onOpenMarketplace={vi.fn()}
        onOpenEvents={vi.fn()}
        onMessageMember={vi.fn(async () => ({ error: null }))}
      />
    );

    const draft = screen.getByPlaceholderText("What would you like to share?");
    const publish = screen.getByRole("button", { name: "Publish post" });
    fireEvent.change(draft, { target: { value: "First draft" } });
    fireEvent.click(publish);
    await waitFor(() => expect(rpc.mock.calls.filter(([name]) => name === "create_mtu_campus_post_once")).toHaveLength(1));
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));

    fireEvent.change(draft, { target: { value: "Updated draft" } });
    fireEvent.click(publish);
    await waitFor(() => expect(rpc.mock.calls.filter(([name]) => name === "create_mtu_campus_post_once")).toHaveLength(2));
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(publish);
    await screen.findByText("Ada");
    const requestIds = rpc.mock.calls
      .filter(([name]) => name === "create_mtu_campus_post_once")
      .map(([, args]) => args?.p_request_id as string);
    expect(requestIds[0]).not.toBe(requestIds[1]);
    expect(requestIds[1]).toBe(requestIds[2]);
  });
});
