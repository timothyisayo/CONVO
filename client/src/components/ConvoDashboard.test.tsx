// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({ toastMock: Object.assign(vi.fn(), { success: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: toastMock }));
import { ConvoDashboard, groupInviteUrl } from "./ConvoDashboard";
import { StudentIdCard } from "./StudentIdCard";

afterEach(() => cleanup());

describe("ConvoDashboard", () => {
  it("builds private group invite URLs with encoded tokens and no trailing slash duplication", () => {
    expect(groupInviteUrl("https://convo.example/", "token/with spaces")).toBe("https://convo.example/?group-invite=token%2Fwith%20spaces");
  });
  it("renders personalized welcome, avatar, and suggested groups", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" avatarUrl="https://cdn/avatar.png" groups={[{ id: "g1", name: "Computer Science · 300L", meta: "Programme circle", tone: "sage", members: 0, active: false }]} posts={[]} onExit={() => undefined} />);
    expect(screen.getByText("Ada.")).toBeTruthy();
    expect(screen.getByText(/Your Computer Science circles are ready/)).toBeTruthy();
    expect(screen.getAllByAltText("").length).toBeGreaterThan(0);
    expect(screen.getByText("Computer Science · 300L")).toBeTruthy();
  });

  it("does not invent identity values when profile data is absent", () => {
    render(<ConvoDashboard displayName="" major="" studentId="" level="" department="" groups={[]} posts={[]} onExit={() => undefined} />);
    expect(screen.getByText("there.")).toBeTruthy();
    expect(screen.queryByText("MTU-26-7K4Q2")).toBeNull();
    expect(screen.queryByText("300L")).toBeNull();
    expect(screen.queryByText("College of Basic and Applied Sciences")).toBeNull();
    expect(screen.queryByText(/people online/)).toBeNull();
  });

  it("renders only live unread badges and hides fabricated counts", async () => {
    const onLoadConversations = vi.fn(async () => ({ data: [{ id: "conversation-1", title: "Live chat", kind: "direct", last_message: "Hello", unread_count: 2 }], error: null }));
    const onLoadConnectionRequests = vi.fn(async () => ({ data: [{ id: "request-1", requester_id: "student-2", recipient_id: "student-1", status: "pending", direction: "received" }], error: null }));
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onLoadConversations={onLoadConversations} onLoadConnectionRequests={onLoadConnectionRequests} onExit={() => undefined} />);
    const dock = screen.getByRole("navigation", { name: "Convo workspace" });
    expect(await within(dock).findByText("2")).toBeTruthy();
    expect(screen.queryByText("4")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    expect(screen.getAllByRole("button", { name: /^Messages/ })[0]).toBeTruthy();
    expect(screen.queryByText("4")).toBeNull();
  });

  it("increments the navigation badge for a new incoming message", async () => {
    let onIncomingMessage: ((message: Record<string, unknown>) => void) | undefined;
    const onLoadConversations = vi.fn(async () => ({ data: [{ id: "conversation-1", title: "Live chat", kind: "direct", last_message: "Hello", unread_count: 0 }], error: null }));
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onLoadConversations={onLoadConversations} onSubscribeToAllMessages={(callback) => { onIncomingMessage = callback; return () => undefined; }} onExit={() => undefined} />);
    await waitFor(() => expect(onIncomingMessage).toBeTruthy());
    onIncomingMessage?.({ id: "message-2", conversation_id: "conversation-1", sender_id: "student-2", body: "Are you around?" });
    const dock = screen.getByRole("navigation", { name: "Convo workspace" });
    expect(await within(dock).findByText("1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Notifications, 1 unread message/ })).toBeTruthy();
  });

  it("refreshes the notifications badge when a new connection request arrives live", async () => {
    let onConnectionRequestUpdate: (() => void) | undefined;
    const onLoadConnectionRequests = vi.fn(async () => ({ data: [], error: null }));
    render(
      <ConvoDashboard
        displayName="Ada"
        major="Computer Science"
        groups={[]}
        posts={[]}
        onLoadConnectionRequests={onLoadConnectionRequests}
        onSubscribeToConnectionRequests={(callback) => {
          onConnectionRequestUpdate = callback;
          return () => undefined;
        }}
        onExit={() => undefined}
      />
    );

    await waitFor(() => expect(onConnectionRequestUpdate).toBeTruthy());
    onConnectionRequestUpdate?.();
    await waitFor(() => expect(onLoadConnectionRequests).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("button", { name: /Notifications/ }).length).toBeGreaterThan(0);
  });

  it("renders direct profile images, active status, and an enlarged header viewer", async () => {
    let conversationHandlers: { onTyping: (userId: string, isTyping: boolean) => void } | undefined;
    const onLoadConversations = vi.fn(async () => ({ data: [{ id: "conversation-1", title: "Mariam", kind: "direct", counterpart_id: "student-2", counterpart_avatar_url: "https://cdn.test/mariam.jpg", last_message: "Hello", unread_count: 0 }], error: null }));
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onLoadConversations={onLoadConversations} onLoadMessages={vi.fn(async () => ({ data: [], error: null }))} onSubscribeToConversation={(_id, handlers) => { conversationHandlers = handlers; return { sendTyping: vi.fn(async () => "ok"), cleanup: vi.fn() }; }} onExit={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]!);
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /Mariam/ }));
    await waitFor(() => expect(Array.from(document.querySelectorAll<HTMLImageElement>(".conversation-avatar img")).some((image) => image.src === "https://cdn.test/mariam.jpg")).toBe(true));
    await waitFor(() => expect(conversationHandlers).toBeTruthy());
    act(() => { conversationHandlers?.onTyping("student-2", true); });
    await waitFor(() => expect(document.querySelectorAll(".conversation-avatar.is-online").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "View larger image for Mariam" }));
    expect(await screen.findByRole("dialog", { name: "Larger profile image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close larger image" }));
    expect(screen.queryByRole("dialog", { name: "Larger profile image" })).toBeNull();
  });

  it("keeps navigation safe when reduced motion is enabled and live counts are absent", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.queryByText("4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("aria-current")).toBe("page");
  });

  it("moves the active compartment when switching views", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    const discover = screen.getByRole("button", { name: "Search" });
    expect(discover.className).toContain("dock-item");
    expect(discover.className).not.toContain("is-active");
    fireEvent.click(discover);
    expect(discover.className).toContain("is-active");
    expect(discover.getAttribute("aria-current")).toBe("page");
  });

  it("keeps the moving rail usable on mobile with reduced motion", () => {
    window.innerWidth = 375;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    const messages = screen.getAllByRole("button", { name: /^Messages/ })[0];
    fireEvent.click(messages);
    expect(messages.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".convo-top-dock")).toBeTruthy();
    expect(document.querySelector(".convo-orbit")).toBeTruthy();
  });

  it("renders the compact atmosphere outside the navigation rail", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    const dock = document.querySelector(".convo-top-dock");
    const atmosphere = document.querySelector(".dashboard-atmosphere");
    expect(atmosphere).toBeTruthy();
    expect(dock?.contains(atmosphere)).toBe(false);
    expect(document.querySelector(".dashboard-rail")).toBeNull();
    expect(document.querySelector(".dashboard-hero")?.className).toContain("dashboard-hero");
  });

  it("keeps the compact authenticated composition usable on mobile", () => {
    window.innerWidth = 375;
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    expect(document.querySelector(".dashboard-content")).toBeTruthy();
    expect(screen.getByText("Ada.")).toBeTruthy();
    expect(document.querySelector(".dashboard-atmosphere")).toBeTruthy();
  });

  it("keeps the dashboard content available at a narrow viewport", () => {
    window.innerWidth = 375;
    render(<ConvoDashboard displayName="Chi" major="Mass Communication" groups={[]} posts={[]} onExit={() => undefined} />);
    expect(screen.getByText("Chi.")).toBeTruthy();
    expect(screen.getByText("Find your people")).toBeTruthy();
  });

  it("joins a live group with confirmation state", async () => {
    const onJoinGroup = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[{ id: "g1", name: "Computer Science · 300L", meta: "Study circle", tone: "sage", members: 0, active: false }]} posts={[]} onJoinGroup={onJoinGroup} onExit={() => undefined} />);
    const group = screen.getByRole("button", { name: /Computer Science · 300LStudy circle/ });
    fireEvent.click(group);
    await waitFor(() => expect(screen.getByText("Joined")).toBeTruthy());
    expect(screen.getByText(/You’re in/)).toBeTruthy();
  });

  it("fires a distinct success toast after joining a live group", async () => {
    const onJoinGroup = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[{ id: "g1", name: "Business Admin", meta: "Level circle", tone: "butter", members: 42, active: true }]} posts={[]} onJoinGroup={onJoinGroup} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Business AdminLevel circle/ }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("You’re in Business Admin", { description: "Your new circle is ready to explore." }));
  });

  it("fires already-in-circle feedback when the server reports a duplicate join", async () => {
    const onJoinGroup = vi.fn(async () => ({ ok: true, alreadyJoined: true }));
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[{ id: "g1", name: "Business Admin", meta: "Level circle", tone: "butter", members: 42, active: true }]} posts={[]} onJoinGroup={onJoinGroup} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Business AdminLevel circle/ }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Already part of Business Admin", { description: "Your circle is waiting for you." }));
  });

  it("rehydrates a joined group on mobile", () => {
    window.innerWidth = 375;
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[{ id: "g1", name: "Business Admin", meta: "Level circle", tone: "butter", members: 42, active: true }]} posts={[]} joinedGroupIds={["g1"]} onExit={() => undefined} />);
    expect(screen.getByText("Joined")).toBeTruthy();
    expect(screen.getByText(/You’re in/)).toBeTruthy();
  });

  it("confirms secure logout with an animated modal before signing out", async () => {
    const onLogout = vi.fn(async () => undefined);
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[]} posts={[]} onExit={() => undefined} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByRole("dialog", { name: /Leave Convo/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stay in Convo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    fireEvent.click(screen.getByRole("button", { name: /Log out safely/i }));
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it("keeps secure logout usable when reduced motion is enabled", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[]} posts={[]} onExit={() => undefined} onLogout={vi.fn(async () => undefined)} isExiting />);
    expect(document.querySelector(".dashboard-shell")?.classList.contains("is-exiting")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByRole("dialog", { name: /Leave Convo/i })).toBeTruthy();
  });

  it("exposes an animated exiting state for secure logout", () => {
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[]} posts={[]} onExit={() => undefined} isExiting />);
    expect(document.querySelector(".dashboard-shell")?.classList.contains("is-exiting")).toBe(true);
  });

  it("renders live groups and an empty-feed state", () => {
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[{ id: "g1", name: "Business Admin", meta: "Level circle", tone: "butter", members: 42, active: true }]} posts={[]} onExit={() => undefined} />);
    expect(screen.getByText("Business Admin")).toBeTruthy();
    expect(screen.getByText(/Your feed will come alive/)).toBeTruthy();
  });

  it("filters live groups by query and category without fabricating results", () => {
    render(<ConvoDashboard displayName="Bami" major="Business Admin" groups={[{ id: "g1", name: "Business Admin", meta: "Academic circle", tone: "butter", members: 42, active: true }, { id: "g2", name: "Campus Football", meta: "Sports club", tone: "sage", members: 18, active: true }]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    const search = screen.getByRole("textbox", { name: "Search groups" });
    fireEvent.change(search, { target: { value: "football" } });
    expect(screen.getByText("Campus Football")).toBeTruthy();
    expect(screen.queryByText("Business Admin")).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "Sports" }));
    expect(screen.getByText("Campus Football")).toBeTruthy();
    expect(screen.queryByText("Business Admin")).toBeNull();
  });
});


describe("expanded Convo workspace", () => {
  it("keeps the brand inside the dashboard and opens live discovery by student ID", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-26-7K4Q2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "Available" }], error: null });
    render(<ConvoDashboard displayName="Ada Lovelace" major="Computer Science" studentId="MTU-SELF" level="300L" department="CBAS" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Convo home" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Find your")).toBeTruthy();
    await waitFor(() => expect(onSearchStudents).toHaveBeenCalledWith(""));
    expect(await screen.findByText("Mariam A.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Global search" }), { target: { value: "MTU-26-7K4Q2" } });
    await waitFor(() => expect(onSearchStudents).toHaveBeenCalledWith("MTU-26-7K4Q2"));
    expect(await screen.findByText("Mariam A.")).toBeTruthy();
  });

  it("keeps one Search entry and hydrates the Discover directory results", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-26-7K4Q2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "Available" }], error: null });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Search" })[0]);
    expect(await screen.findByRole("textbox", { name: "Global search" })).toBeTruthy();
    await waitFor(() => expect(onSearchStudents).toHaveBeenCalledWith(""));
    expect(await screen.findByText("Mariam A.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Global search" }), { target: { value: "MTU-26-7K4Q2" } });
    await waitFor(() => expect(onSearchStudents).toHaveBeenCalledWith("MTU-26-7K4Q2"));
  });

  it("excludes the signed-in profile when its generated public ID is searched", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-1", display_name: "Ada", student_id: "MTU-SELF", is_self: true, programme: "Computer Science", department: "CBAS", level: "300L", status_text: "" }], error: null });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" studentId="MTU-SELF" level="300L" department="CBAS" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Global search" }), { target: { value: "MTU-SELF" } });
    await waitFor(() => expect(onSearchStudents).toHaveBeenCalledWith("MTU-SELF"));
    expect(screen.queryByText("You")).toBeNull();
    expect(document.querySelector(".directory-grid .student-card")).toBeNull();
    expect(screen.getByText("No student found yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Connect/ })).toBeNull();
  });

  it("shows the actual profile identity and sends a connection request", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-26-7K4Q2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "Available" }], error: null });
    const onSendConnectionRequest = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard displayName="Ada Lovelace" major="Computer Science" studentId="MTU-SELF" level="300L" department="CBAS" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onSendConnectionRequest={onSendConnectionRequest} onExit={() => undefined} />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getAllByText("MTU-SELF").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Connect/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);
    expect(await screen.findByText("Request sent")).toBeTruthy();
  });

  it("opens a compact Messages surface without active-chat empty-state marketing copy", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    expect(document.querySelector(".messages-view")).toBeTruthy();
    expect(document.querySelector(".thread-header")).toBeTruthy();
    expect(screen.queryByText("or start a new one.")).toBeNull();
  });
});


describe("live Convo callbacks", () => {
  it("delegates directory search and message sending", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-1", display_name: "Mariam A.", student_id: "MTU-26-7K4Q2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "Online now" }], error: null });
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onSendMessage = vi.fn().mockResolvedValue({ ok: true, data: { id: "message-1", sender_id: "student-1", body: "See you in the library.", created_at: "2026-08-22T22:00:00.000Z" } });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onSearchStudents={onSearchStudents} onLoadConversations={onLoadConversations} onSendMessage={onSendMessage} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(onSearchStudents).toHaveBeenCalledWith(""));
    expect(screen.getByText("Mariam A.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Write a message" }), { target: { value: "See you in the library." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith("conversation-1", "See you in the library."));
  });
});


describe("live message callbacks", () => {
  it("loads live conversations and the selected thread", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: "See you soon." }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [{ id: "message-1", sender_id: "student-2", body: "Bring your notes.", created_at: "2026-08-22T22:00:00.000Z" }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    await waitFor(() => expect(onLoadMessages).toHaveBeenCalledWith("conversation-1"));
    expect(screen.getByText("Bring your notes.")).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".conversation-context-panel")).toBeTruthy());
  });

  it("switches from a mobile thread back to the live conversation list", async () => {
    window.innerWidth = 375;
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: "See you soon." }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    const conversationList = document.querySelector(".conversation-list");
    expect(conversationList).toBeTruthy();
    const conversationRow = await within(conversationList as HTMLElement).findByText("Mariam A.");
    fireEvent.click(conversationRow.closest("button") || conversationRow);
    await waitFor(() => expect(document.querySelector(".messages-view.has-thread")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }));
    expect(document.querySelector(".messages-view.has-list")).toBeTruthy();
  });

  it("moves direct-chat safety and private controls into the tapped student profile panel", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", counterpart_id: "student-2", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [], error: null });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" studentId="MTU-ADA-001" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onBlockStudent={vi.fn().mockResolvedValue({ ok: true })} onReportStudent={vi.fn().mockResolvedValue({ ok: true })} onSetConversationPreference={vi.fn().mockResolvedValue({ ok: true })} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Mariam A\./ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open student profile" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Report student" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open student profile" }));
    expect(await screen.findByRole("dialog", { name: "Student profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy public student ID" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search this chat" })).toBeTruthy();
    expect(document.querySelector("[data-conversation-notifications]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Name this chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Block student" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close conversation profile" }));
  });

  it("exposes the persistent Saved Messages collection from the compact messaging rail", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "group-1", title: "CSC Study Circle", kind: "group", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [], error: null });
    const onLoadSavedMessages = vi.fn().mockResolvedValue({ data: [], error: null });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onLoadSavedMessages={onLoadSavedMessages} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    expect(await screen.findByRole("button", { name: "Open saved messages" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open saved messages" }));
    expect(await screen.findByRole("dialog", { name: "Saved messages" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close saved messages" }));
  });

  it("keeps Appearance out of the group profile and exposes Change group photo only to loaded managers", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "group-1", title: "CSC Study Circle", kind: "group", last_message: null }], error: null });
    let resolveMembers: ((value: { data: Array<{ user_id: string; display_name: string; student_id: string; group_role: "owner" }>; error: null }) => void) | undefined;
    const onLoadGroupMembers = vi.fn().mockImplementation(() => new Promise<{ data: Array<{ user_id: string; display_name: string; student_id: string; group_role: "owner" }>; error: null }>((resolve) => { resolveMembers = resolve; }));
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={vi.fn().mockResolvedValue({ data: [], error: null })} onLoadGroupMembers={onLoadGroupMembers} onUpdateGroupImage={vi.fn().mockResolvedValue({ ok: true, url: "https://example.test/group.jpg" })} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /CSC Study Circle/ }));
    await waitFor(() => expect(onLoadGroupMembers).toHaveBeenCalledWith("group-1"));
    await act(async () => { resolveMembers?.({ data: [{ user_id: "student-1", display_name: "Ada", student_id: "MTU-ADA-001", group_role: "owner" }], error: null }); });
    fireEvent.click((await screen.findAllByRole("button", { name: "Open group profile" })).find((button) => button.classList.contains("thread-profile-trigger"))!);
    expect(await screen.findByRole("dialog", { name: "Group profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change group photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appearance" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close conversation profile" }));
  });
});


describe("realtime message delivery", () => {
  it("renders an incoming message instantly and keeps it after the initial load resolves", async () => {
    let receiveMessage: ((message: Record<string, unknown>) => void) | undefined;
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockImplementation(() => new Promise((resolve) => window.setTimeout(() => resolve({ data: [], error: null }), 10)));
    const onSubscribeToMessages = vi.fn((_conversationId: string, callback: (message: Record<string, unknown>) => void) => { receiveMessage = callback; return vi.fn(); });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onSubscribeToMessages={onSubscribeToMessages} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    await waitFor(() => expect(onSubscribeToMessages).toHaveBeenCalledWith("conversation-1", expect.any(Function)));
    receiveMessage?.({ id: "message-live", sender_id: "student-2", body: "I just arrived at the library.", created_at: "2026-08-23T10:00:00.000Z" });
    expect((await screen.findAllByText("I just arrived at the library.")).length).toBeGreaterThanOrEqual(1);
  });
});


describe("typing and receipts", () => {
  it("does not mark an active-thread message seen from another conversation receipt", async () => {
    let conversationHandlers: { onReadReceipt: (messageId: string, readAt: string) => void } | undefined;
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [{ id: "message-active", sender_id: "student-1", body: "An active thread note.", created_at: "2026-08-23T10:00:00.000Z", read_at: null }], error: null });
    const onSubscribeToConversation = vi.fn((_conversationId: string, handlers: { onMessage: (message: Record<string, unknown>) => void; onTyping: (userId: string, isTyping: boolean) => void; onReadReceipt: (messageId: string, readAt: string) => void }) => { conversationHandlers = handlers; return { sendTyping: vi.fn(async () => undefined), cleanup: vi.fn() }; });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onSubscribeToConversation={onSubscribeToConversation} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    expect(await screen.findByText("An active thread note.")).toBeTruthy();
    conversationHandlers?.onReadReceipt("message-from-another-conversation", "2026-08-23T11:00:00.000Z");
    expect(screen.getByText(/Sent/)).toBeTruthy();
  });

  it("shows a remote typing indicator without treating the current user as remote", async () => {
    let conversationHandlers: { onTyping: (userId: string, isTyping: boolean) => void } | undefined;
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [], error: null });
    const onSubscribeToConversation = vi.fn((_conversationId: string, handlers: { onMessage: (message: Record<string, unknown>) => void; onTyping: (userId: string, isTyping: boolean) => void; onReadReceipt: (messageId: string, readAt: string) => void }) => { conversationHandlers = handlers; return { sendTyping: vi.fn(async () => undefined), cleanup: vi.fn() }; });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onSubscribeToConversation={onSubscribeToConversation} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    await waitFor(() => expect(onSubscribeToConversation).toHaveBeenCalled());
    conversationHandlers?.onTyping("student-2", true);
    expect((await screen.findByRole("status")).textContent).toContain("Someone is typing");
    conversationHandlers?.onTyping("student-1", true);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("marks pending own messages orange and read own messages green", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [{ id: "message-pending", sender_id: "student-1", body: "Waiting to be read", created_at: "2026-08-23T10:00:00.000Z", read_at: null }, { id: "message-read", sender_id: "student-1", body: "Already read", created_at: "2026-08-23T10:01:00.000Z", read_at: "2026-08-23T10:02:00.000Z" }], error: null });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    await waitFor(() => expect(document.querySelectorAll(".thread-message.is-own > small.is-pending").length).toBe(1));
    expect(document.querySelectorAll(".thread-message.is-own > small.is-delivered").length).toBe(1);
  });

  it("exposes a full emoji panel, alias autocomplete, image and real camera controls inside the multiline composer", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Choose emoji" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Write a message" }).tagName).toBe("TEXTAREA");
    expect(await screen.findByRole("button", { name: "Format Bold" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Write a message" }), { target: { value: "/shr" } });
    expect(screen.getByRole("listbox", { name: "Text commands" })).toBeTruthy();
    expect(screen.getByText("/shrug")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Write a message" }), { target: { value: ":heart" } });
    expect(screen.getByRole("listbox", { name: "Emoji suggestions" })).toBeTruthy();
    expect(screen.getByText(":heart:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose emoji" }));
    expect(screen.getByRole("dialog", { name: "Emoji picker" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open attachment menu" }));
    expect(screen.getByRole("button", { name: "Choose image attachment" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open camera" }));
    expect(await screen.findByRole("dialog", { name: "Take a photo" })).toBeTruthy();
    expect(screen.getByText("Take a photo")).toBeTruthy();
  }, 30000);

  it("opens a camera-first video recorder instead of the file picker", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open attachment menu" }));
    const recordVideo = await screen.findByRole("button", { name: "Record video attachment" });
    fireEvent.click(recordVideo);
    expect(await screen.findByRole("dialog", { name: "Record a video" })).toBeTruthy();
    expect(screen.getByText("Choose saved video")).toBeTruthy();
    expect(screen.queryByText("Take a photo")).toBeNull();
  });

  it("opens a microphone-first voice recorder from the attachment menu", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open attachment menu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record voice message" }));
    expect(await screen.findByRole("dialog", { name: "Record a voice message" })).toBeTruthy();
  });

  it("loads persisted reactions and sends a reply with its source message id", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [{ id: "message-1", sender_id: "student-2", body: "Can we meet after class?", created_at: "2026-08-23T10:00:00.000Z" }, { id: "message-2", sender_id: "student-1", body: "Yes, I will be there.", created_at: "2026-08-23T10:01:00.000Z", reply_to_id: "message-1", reply_body: "Can we meet after class?", reply_sender_id: "student-2" }], error: null });
    const onLoadMessageInteractions = vi.fn().mockResolvedValue({ data: [{ message_id: "message-1", emoji: "👍", reaction_count: 2, reacted_by_me: true, saved_by_me: false, pinned_by_me: false }], error: null });
    const onToggleMessageReaction = vi.fn().mockResolvedValue({ ok: true, active: false });
    const onSendMessage = vi.fn().mockResolvedValue({ ok: true, data: { id: "message-3", sender_id: "student-1", body: "Sounds good.", created_at: "2026-08-23T10:02:00.000Z", reply_to_id: "message-1" } });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onLoadMessageInteractions={onLoadMessageInteractions} onToggleMessageReaction={onToggleMessageReaction} onSendMessage={onSendMessage} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    expect(await screen.findByText("Can we meet after class?")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "React to message" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "React to message" })[0]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "React 👍" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "React 👍" })[0]);
    await waitFor(() => expect(onToggleMessageReaction).toHaveBeenCalledWith("message-1", "👍"));
    fireEvent.click(screen.getAllByRole("button", { name: "More message actions" })[0]);
    expect(screen.getAllByRole("button", { name: "Forward" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Copy" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Save" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Info" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]);
    expect(await screen.findByText("Replying to")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Write a message" }), { target: { value: "Sounds good." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith("conversation-1", "Sounds good.", null, "message-1"));
  });
});


describe("message safety", () => {
  it("blocks oversized messages before sending", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    const onSendMessage = vi.fn();
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onSendMessage={onSendMessage} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Mariam A\./ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Mariam A\./ }));
    const input = screen.getByRole("textbox", { name: "Write a message" });
    fireEvent.change(input, { target: { value: "x".repeat(4001) } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("Messages must be 4,000 characters or fewer.")).toBeTruthy();
    expect(onSendMessage).not.toHaveBeenCalled();
  });
});


describe("animated dock refinements", () => {
  it("exposes tooltip labels below dock icons on hover and focus", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    expect(screen.getByRole("tooltip", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("tooltip", { name: "More" })).toBeTruthy();
  });

  it("opens More menu actions and routes logout through the secure confirmation", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLogout={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Log out/ }));
    expect(screen.getByRole("dialog", { name: /Leave Convo/i })).toBeTruthy();
  });

  it("adds attention pulses only to live unread Messages and Notifications", async () => {
    const onLoadConversations = vi.fn(async () => ({ data: [{ id: "conversation-1", title: "Live chat", kind: "direct", last_message: "Hello", unread_count: 2 }], error: null }));
    const onLoadConnectionRequests = vi.fn(async () => ({ data: [{ id: "request-1", requester_id: "student-2", recipient_id: "student-1", status: "pending", direction: "received" }], error: null }));
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onLoadConversations={onLoadConversations} onLoadConnectionRequests={onLoadConnectionRequests} onExit={() => undefined} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Messages" })[0].className).toContain("has-unread"));
    expect(screen.getAllByRole("button", { name: "Notifications" }).at(-1)?.className).toContain("has-unread");
    expect(screen.getByRole("button", { name: "Home" }).className).not.toContain("has-unread");
  });
});

describe("dashboard refinement surfaces", () => {
  it("always returns the student ID card to its public side from the private side", () => {
    render(<StudentIdCard nickname="Ada" displayName="Ada Lovelace" studentId="MTU-SELF" programme="Computer Science" college="CBAS" level="300 Level" />);
    const card = document.querySelector(".student-id-card") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Show private student ID details" }));
    expect(card.dataset.flipState).toBe("private");
    fireEvent.click(card);
    expect(card.dataset.flipState).toBe("public");
    fireEvent.click(screen.getByRole("button", { name: "Show private student ID details" }));
    fireEvent.click(screen.getByRole("button", { name: "Show public student ID" }));
    expect(card.dataset.flipState).toBe("public");
  });

  it("persists a private programme choice from Settings and removes it from the public card", async () => {
    const onUpdatePrivacy = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard displayName="Ada" legalName="Ada Lovelace" major="Computer Science" programme="Computer Science" studentId="MTU-SELF" department="CBAS" level="300 Level" groups={[]} posts={[]} onUpdatePrivacy={onUpdatePrivacy} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Programme to students" }));
    await waitFor(() => expect(onUpdatePrivacy).toHaveBeenCalledWith({ programme: false, college: true, level: true, bio: true, incognito: false, allow_exact_id_lookup: false }));
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.queryAllByText("Computer Science").length).toBe(1);
    expect(screen.getByText("Only the details you chose are shown.")).toBeTruthy();
  });

  it("uses a compact profile summary instead of an oversized cover while preserving public identity controls", async () => {
    render(<ConvoDashboard displayName="Ada" legalName="Ada Lovelace" major="Computer Science" programme="Computer Science" studentId="MTU-SELF" department="CBAS" level="300 Level" groups={[]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(document.querySelector(".profile-summary")).toBeTruthy();
    expect(document.querySelector(".profile-cover")).toBeNull();
    expect(screen.getByText("Your Convo profile")).toBeTruthy();
    expect(screen.getByText("Public student ID")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy student ID" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Copy public student ID" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Update details/i })).toBeTruthy();
  });

  it("stops Discover loading and shows recovery guidance when the directory request rejects", async () => {
    const onSearchStudents = vi.fn(async () => { throw new Error("network stalled"); });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Directory needs one more setup step.")).toBeTruthy();
    expect(screen.queryByText("Searching MTU profiles…")).toBeNull();
  });

  it("renders live Suggested Connections and sends a request", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-26-7K4Q2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "Online now" }], error: null });
    const onSendConnectionRequest = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300L" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onSendConnectionRequest={onSendConnectionRequest} onExit={() => undefined} />);
    expect(await screen.findByText("Suggested connections")).toBeTruthy();
    expect(screen.getAllByText("Mariam A.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onSendConnectionRequest).toHaveBeenCalledWith("student-2"));
  });

  it("opens practical profile actions from a student's More menu", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-26-7K4Q2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "Available" }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Mariam A.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More options for Mariam A." }));
    expect(screen.getByRole("menuitem", { name: /View profile/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Copy student ID/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Connect/ })).toBeTruthy();
  });

  it("uses the requestor nickname and opens chat after accepting a connection request", async () => {
    const onAcceptConnectionRequest = vi.fn(async () => ({ ok: true }));
    const onStartDirectConversation = vi.fn(async () => ({ data: "conversation-1", error: null }));
    const onLoadConnectionRequests = vi.fn(async () => ({ data: [{ id: "request-1", requester_id: "student-2", recipient_id: "student-1", status: "pending", direction: "received", requester_display_name: "Mariam", requester_student_id: "MTU-26-7K4Q2" }], error: null }));
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onLoadConnectionRequests={onLoadConnectionRequests} onAcceptConnectionRequest={onAcceptConnectionRequest} onStartDirectConversation={onStartDirectConversation} onExit={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Notifications" })[0]);
    expect(await screen.findByText("Mariam wants to connect")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onStartDirectConversation).toHaveBeenCalledWith("student-2"));
    expect(document.querySelector(".messages-view")).toBeTruthy();
  });

  it("opens the branded in-app group creator instead of a browser prompt", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onCreateGroupConversation={vi.fn()} onExit={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Groups/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Create group/i }));
    expect(document.querySelector('form[aria-label="Create MTU group"]')).toBeTruthy();
    expect(document.querySelector(".convo-group-composer-backdrop")).toBeTruthy();
  });

  it("opens Edit Profile and persists nickname plus academic details", async () => {
    const onUpdateProfile = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300 Level" groups={[]} posts={[]} onUpdateProfile={onUpdateProfile} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    fireEvent.click(screen.getByRole("button", { name: /Edit profile/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Public nickname" }), { target: { value: "Ada Prime" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith(expect.objectContaining({ nickname: "Ada Prime", programme: "Computer Science", college: "CBAS", level: "300 Level" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep your/i })).toBeNull());
  });

  it("exposes the post-celebration entering class when requested", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} isEntering onExit={() => undefined} />);
    expect(document.querySelector(".dashboard-shell")?.className).toContain("is-entering");
  });
});

describe("suggested connection interactions", () => {
  it("switches between programme and college filters and applies hover tilt", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "programme-peer", display_name: "Programme Peer", student_id: "MTU-P", programme: "Computer Science", department: "Other College", level: "300L", status_text: "" }, { id: "college-peer", display_name: "College Peer", student_id: "MTU-C", programme: "Accounting", department: "CBAS", level: "300L", status_text: "" }], error: null });
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300L" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    expect(await screen.findByText("Programme Peer")).toBeTruthy();
    expect(screen.queryByText("College Peer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "College" }));
    expect(await screen.findByText("College Peer")).toBeTruthy();
    expect(screen.queryByText("Programme Peer")).toBeNull();
    const card = screen.getByText("College Peer").closest("article");
    expect(card).toBeTruthy();
    fireEvent.pointerMove(card as HTMLElement, { clientX: 20, clientY: 8 });
    expect((card as HTMLElement).style.getPropertyValue("--tilt-y")).not.toBe("");
    fireEvent.pointerLeave(card as HTMLElement);
    expect((card as HTMLElement).style.getPropertyValue("--tilt-y")).toBe("0deg");
  });

  it("changes Connect to a checked Pending state after a successful request", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "" }], error: null });
    const onSendConnectionRequest = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300L" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onSendConnectionRequest={onSendConnectionRequest} onExit={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("button", { name: /Pending/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pending/ }).querySelector("svg")).toBeTruthy();
  });
});

describe("suggested connection expansion", () => {
  it("loads additional live students through the skeleton state", async () => {
    const students = Array.from({ length: 5 }, (_, index) => ({ id: `student-${index}`, display_name: `Student ${index}`, student_id: `MTU-${index}`, programme: "Computer Science", department: "CBAS", level: "300L", status_text: "" }));
    const onSearchStudents = vi.fn().mockResolvedValue({ data: students, error: null });
    render(<ConvoDashboard currentUserId="self" displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300L" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    expect(await screen.findByText("Student 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load More" }));
    expect(screen.getAllByLabelText("Loading student").length).toBe(3);
    await waitFor(() => expect(screen.getByText("Student 4")).toBeTruthy(), { timeout: 1000 });
  });

  it("opens and closes a 3D quick-peek profile from an avatar", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "" }], error: null });
    render(<ConvoDashboard currentUserId="self" displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300L" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onExit={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Preview Mariam/i }));
    expect(screen.getByRole("dialog", { name: /Public profile preview for Mariam A/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close profile preview" }));
    expect(screen.queryByRole("dialog", { name: /Public profile preview/ })).toBeNull();
  });

  it("cancels a pending request through the live callback", async () => {
    const onSearchStudents = vi.fn().mockResolvedValue({ data: [{ id: "student-2", display_name: "Mariam A.", student_id: "MTU-2", programme: "Computer Science", department: "CBAS", level: "300L", status_text: "" }], error: null });
    const onSendConnectionRequest = vi.fn(async () => ({ ok: true }));
    const onCancelConnectionRequest = vi.fn(async () => ({ ok: true }));
    render(<ConvoDashboard currentUserId="self" displayName="Ada" major="Computer Science" programme="Computer Science" department="CBAS" level="300L" groups={[]} posts={[]} onSearchStudents={onSearchStudents} onSendConnectionRequest={onSendConnectionRequest} onCancelConnectionRequest={onCancelConnectionRequest} onExit={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const pending = await screen.findByRole("button", { name: /Pending/ });
    fireEvent.click(pending);
    await waitFor(() => expect(onCancelConnectionRequest).toHaveBeenCalledWith("student-2"));
    expect(await screen.findByRole("button", { name: "Connect" })).toBeTruthy();
  });
});

describe("premium workspace foundations", () => {
  it("keeps the composer focused on native media actions without GIF or sticker provider buttons", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={vi.fn().mockResolvedValue({ data: [], error: null })} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    const conversationList = document.querySelector(".conversation-list");
    const row = await within(conversationList as HTMLElement).findByText("Mariam A.");
    fireEvent.click(row.closest("button") || row);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open attachment menu" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open attachment menu" }));
    expect(screen.queryByRole("button", { name: "GIF provider status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sticker provider status" })).toBeNull();
  });

  it("keeps calls inside the conversation experience instead of the primary navigation", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Open Calls" })).toBeNull();
    expect(screen.queryByText("Calls are ready for a provider.")).toBeNull();
    expect(screen.getByRole("button", { name: "Messages" })).toBeTruthy();
  });


  it("opens groups and shows only the supplied live group data", () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[{ id: "g1", name: "Computer Science · 300L", meta: "Programme circle", tone: "sage", members: 12, active: true }]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Groups" }));
    expect(screen.getByText("Campus")).toBeTruthy();
    expect(screen.getByText("Computer Science · 300L")).toBeTruthy();
  });

  it("opens settings and persists a dark appearance preference", () => {
    window.localStorage.clear();
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const toggle = screen.getByRole("switch", { name: "Toggle dark mode" });
    fireEvent.click(toggle);
    expect(document.querySelector(".dashboard-shell")?.className).toContain("theme-dark");
    expect(window.localStorage.getItem("convo-theme")).toBe("dark");
  });

  it("opens the real digital student ID using the current profile values", () => {
    render(<ConvoDashboard displayName="Ada" legalName="Ada Lovelace" studentId="MTU-SELF" major="Computer Science" programme="Computer Science" department="CBAS" level="300 Level" groups={[]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Digital ID" }));
    expect(screen.getByText("Your campus")).toBeTruthy();
    expect(screen.getAllByText("MTU-SELF").length).toBeGreaterThan(0);
  });

});

describe("full-scope collaboration surfaces", () => {
  it("offers the requested categories in group discovery and creation", async () => {
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Groups" }));
    expect(screen.getByRole("tab", { name: "Code & Tech" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cruise" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("combobox", { name: "Group category" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Code & Tech" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Cruise" })).toBeTruthy();
  });

  it("loads an event in the standalone Events section and updates attendance", async () => {
    const onLoadConversations = vi.fn(async () => ({ data: [{ id: "group-1", title: "Cruise Circle", kind: "group", last_message: null }], error: null }));
    const onLoadMessages = vi.fn(async () => ({ data: [], error: null }));
    const onLoadGroupEvents = vi.fn(async () => ({ data: [{ id: "event-1", title: "Campus Cruise", description: "Meet at the main gate.", starts_at: "2026-09-02T12:00:00.000Z", location: "Main gate", created_by: "student-1", going_count: 0, my_response: null }], error: null }));
    const onSetGroupEventResponse = vi.fn(async () => ({ data: "event-1", error: null }));
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onLoadGroupEvents={onLoadGroupEvents} onSetGroupEventResponse={onSetGroupEventResponse} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("Cruise Circle"));
    fireEvent.click(screen.getByRole("button", { name: "Open Events" }));
    expect(await screen.findByText("Campus Cruise")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "going" }));
    await waitFor(() => expect(onSetGroupEventResponse).toHaveBeenCalledWith("event-1", "going"));
  });

  it("loads persisted attachments in Shared Files with device-download metadata", async () => {
    const onLoadConversations = vi.fn(async () => ({ data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }], error: null }));
    const onLoadMessages = vi.fn(async () => ({ data: [], error: null }));
    const onLoadSharedFiles = vi.fn(async () => ({ data: [{ message_id: "message-1", sender_id: "student-2", attachment_url: "https://cdn.test/notes.pdf", attachment_path: "student-2/notes.pdf", attachment_mime: "application/pdf", body: "", created_at: "2026-08-28T10:00:00.000Z" }], error: null }));
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} onLoadSharedFiles={onLoadSharedFiles} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("Mariam A."));
    fireEvent.click(screen.getByRole("button", { name: "Open Files" }));
    expect(await screen.findByText("notes.pdf")).toBeTruthy();
    expect(screen.getByText("notes.pdf").closest("a")?.getAttribute("download")).toBe("notes.pdf");
  });
});
