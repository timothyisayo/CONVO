// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvoDashboard } from "./ConvoDashboard";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

afterEach(() => cleanup());

describe("Messages idle conversation screen", () => {
  it("shows the idle prompt instead of automatically opening a loaded conversation", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({
      data: [{ id: "conversation-1", title: "Mariam A.", kind: "direct", last_message: null }],
      error: null,
    });

    render(
      <ConvoDashboard
        displayName="Ada"
        major="Computer Science"
        groups={[]}
        posts={[]}
        onExit={() => undefined}
        onLoadConversations={onLoadConversations}
        onLoadMessages={vi.fn().mockResolvedValue({ data: [], error: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    await waitFor(() => expect(onLoadConversations).toHaveBeenCalled());
    expect(await screen.findByText("Choose a conversation from the left.")).toBeTruthy();
    expect(document.querySelector(".thread-blank-state")).toBeTruthy();
    expect(document.querySelector(".message-composer textarea")?.hasAttribute("disabled")).toBe(true);
  });

  it("clears group messages and returns to the clean idle screen when a group is closed", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "group-1", title: "Study group", kind: "group", last_message: "Earlier note" }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [{ id: "message-1", conversation_id: "group-1", sender_id: "student-2", body: "Earlier note", created_at: new Date().toISOString() }], error: null });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    fireEvent.click(await screen.findByRole("button", { name: /Study group/ }));
    expect(await screen.findByText("Earlier note")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Close conversation" }));
    await waitFor(() => expect(document.querySelector(".thread-message")).toBeNull());
    expect(document.querySelector(".thread-date-divider")).toBeNull();
    expect(screen.getByText("Choose a conversation from the left.")).toBeTruthy();
  });

  it("never leaks a direct-chat send error into the idle Messages screen after the thread closes", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "direct-1", title: "Mariam", kind: "direct", last_message: null }], error: null });
    const onSendMessage = vi.fn().mockResolvedValue({ ok: false, error: "You have blocked this student from receiving new messages." });
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={vi.fn().mockResolvedValue({ data: [], error: null })} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mariam/ }));
    fireEvent.change(screen.getByLabelText("Write a message"), { target: { value: "Hello" } });
    fireEvent.submit(screen.getByLabelText("Write a message").closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("You have blocked this student");

    fireEvent.click(screen.getByRole("button", { name: "Close conversation" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Choose a conversation from the left.")).toBeTruthy();
  });

  it("does not retain messages from the previously selected conversation while another conversation loads", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "direct-1", title: "Mariam", kind: "direct", last_message: null }, { id: "group-1", title: "Study group", kind: "group", last_message: null }], error: null });
    const onLoadMessages = vi.fn().mockImplementation((conversationId: string) => Promise.resolve({ data: [{ id: `message-${conversationId}`, conversation_id: conversationId, sender_id: "student-2", body: conversationId === "direct-1" ? "Private hello" : "Group agenda", created_at: new Date().toISOString() }], error: null }));
    render(<ConvoDashboard displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Messages" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mariam/ }));
    expect(await screen.findByText("Private hello")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Study group/ }));
    expect(await screen.findByText("Group agenda")).toBeTruthy();
    expect(screen.queryByText("Private hello")).toBeNull();
  });
});
