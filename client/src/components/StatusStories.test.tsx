// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { statusesMock, removeMock, publishMock } = vi.hoisted(() => ({
  statusesMock: [] as object[],
  removeMock: vi.fn(async (_statusId: string) => ({ ok: true })),
  publishMock: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/hooks/useMtuStatuses", () => ({
  useMtuStatuses: () => ({
    statuses: [...statusesMock],
    loading: false,
    error: "",
    refresh: vi.fn(),
    publish: publishMock,
    remove: removeMock,
    markViewed: vi.fn(async () => ({ ok: true })),
  }),
}));
import { StatusStories } from "./StatusStories";

Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:status-test") });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatusStories", () => {
  beforeEach(() => {
    statusesMock.splice(0, statusesMock.length, {
      status_id: "status-1",
      user_id: "student-1",
      status_type: "text",
      text_content: "Study group at noon",
      media_path: null,
      media_url: null,
      metadata: {},
      created_at: "2026-10-03T00:00:00.000Z",
      expires_at: "2026-10-04T00:00:00.000Z",
      display_name: "Ada Lovelace",
      avatar_url: null,
      view_count: 2,
      viewed_by_me: false,
      viewers: [
        { user_id: "student-2", display_name: "Grace Hopper", avatar_url: null, viewed_at: "2026-10-03T00:10:00.000Z" },
        { user_id: "student-3", display_name: "Katherine Johnson", avatar_url: "https://example.test/katherine.png", viewed_at: "2026-10-03T00:05:00.000Z" },
      ],
    });
    removeMock.mockClear();
    publishMock.mockClear();
    publishMock.mockResolvedValue({ data: null, error: null });
    removeMock.mockImplementation(async (statusId) => {
      const index = statusesMock.findIndex((status) => "status_id" in status && status.status_id === statusId);
      if (index >= 0) statusesMock.splice(index, 1);
      return { ok: true };
    });
    vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("Native confirm must not be used"); });
    vi.spyOn(window, "prompt").mockImplementation(() => { throw new Error("Native prompt must not be used"); });
  });

  it("opens the text editor, previews a text Status, and returns to editing", () => {
    render(<StatusStories currentUserId="student-1" displayName="Ada Lovelace" />);

    expect(screen.queryByText("Around Convo")).toBeNull();
    expect(screen.queryByText("Disappears after 24 hours")).toBeNull();
    expect(screen.queryByText("My status")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create Status" }));
    const dialog = screen.getByRole("dialog", { name: "Create Status" });
    expect(dialog.closest(".status-editor-backdrop")?.parentElement).toBe(document.body);
    fireEvent.change(screen.getByRole("textbox", { name: "Status text" }), { target: { value: "Study group at noon" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));

    expect(screen.getByRole("dialog", { name: "Preview Status" })).toBeTruthy();
    expect(screen.getByText("Study group at noon")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to edit/ }));
    expect(screen.getByRole("dialog", { name: "Create Status" })).toBe(dialog);
  });

  it("shows each Status owner's name beneath their circle", () => {
    statusesMock.push({
      ...statusesMock[0],
      status_id: "status-2",
      user_id: "student-2",
      display_name: "Grace Hopper",
      viewers: [],
    });
    render(<StatusStories currentUserId="student-1" displayName="Ada Lovelace" />);

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
  });

  it("opens image tools and supports adding independent draggable text layers", () => {
    render(<StatusStories currentUserId="student-1" displayName="Ada Lovelace" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Status" }));
    fireEvent.click(screen.getByRole("button", { name: /Add media/ }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image/png"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(["image"], "campus.png", { type: "image/png" })] } });

    expect(screen.getByAltText("Status canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aa Text" }));
    fireEvent.click(screen.getByRole("button", { name: "Aa Text" }));
    expect(screen.getAllByRole("button", { name: /Text layer: Your words/ })).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Text layers" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Font" })).toBeTruthy();
    fireEvent.doubleClick(screen.getAllByRole("button", { name: /Text layer: Your words/ })[0]);
    expect(screen.getByRole("textbox", { name: "Edit text layer" })).toBeTruthy();
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("opens an eye-count viewer list for the owner's Status", () => {
    render(<StatusStories currentUserId="student-1" displayName="Ada Lovelace" />);
    fireEvent.click(screen.getByRole("button", { name: /Open your Status/ }));
    expect(screen.getByRole("button", { name: "Show 2 Status viewers" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 Status viewers" }));
    expect(screen.getByRole("dialog", { name: "2 Status viewers" })).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("Katherine Johnson")).toBeTruthy();
  });

  it("deletes an owned Status through the in-app confirmation", async () => {
    render(<StatusStories currentUserId="student-1" displayName="Ada Lovelace" />);
    fireEvent.click(screen.getByRole("button", { name: /Open your Status/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this Status" }));
    expect(screen.getByRole("alertdialog", { name: "Delete this Status?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Status" }));
    expect(removeMock).toHaveBeenCalledWith("status-1");
    expect(await screen.findByRole("button", { name: "Add your Status" })).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("previews and posts the original video without a laggy re-encode", async () => {
    render(<StatusStories currentUserId="student-1" displayName="Ada Lovelace" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Status" }));
    fireEvent.click(screen.getByRole("button", { name: /Add media/ }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="video/mp4"]');
    const videoFile = new File(["video bytes"], "campus.mp4", { type: "video/mp4" });
    fireEvent.change(input!, { target: { files: [videoFile] } });

    const editorVideo = document.querySelector<HTMLVideoElement>(".status-editor-stage video")!;
    Object.defineProperty(editorVideo, "duration", { configurable: true, value: 3 });
    fireEvent.loadedMetadata(editorVideo);
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(await screen.findByRole("dialog", { name: "Preview Status" })).toBeTruthy();
    const previewVideo = document.querySelector<HTMLVideoElement>(".status-preview-canvas video");
    expect(previewVideo).toBeTruthy();
    expect(previewVideo?.getAttribute("src")).toBe(editorVideo.getAttribute("src"));

    fireEvent.click(screen.getByRole("button", { name: /Post status/ }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      status_type: "video",
      media: videoFile,
      metadata: expect.objectContaining({ clip_start: 0, clip_end: 3 }),
    }));
  });
});
