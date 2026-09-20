// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvoDashboard } from "./ConvoDashboard";

const currentMessage = { id: "message-own", conversation_id: "conversation-1", sender_id: "student-1", body: "Original note", created_at: new Date().toISOString() };
const otherConversation = { id: "conversation-2", title: "Study group", kind: "group", last_message: null };

afterEach(() => cleanup());

function renderThread(overrides: Record<string, unknown> = {}) {
  const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "conversation-1", title: "Mariam", kind: "direct", counterpart_id: "student-2", last_message: null }, otherConversation], error: null });
  const onLoadMessages = vi.fn().mockResolvedValue({ data: [currentMessage], error: null });
  render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} {...overrides} />);
  fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
  return screen.findByRole("button", { name: /Mariam/ }).then((row) => fireEvent.click(row));
}

describe("message action execution", () => {
  it("edits an eligible own message through the real edit callback", async () => {
    const onEditMessage = vi.fn().mockResolvedValue({ ok: true });
    await renderThread({ onEditMessage });
    fireEvent.click(await screen.findByRole("button", { name: "Edit message" }));
    const input = screen.getByRole("textbox", { name: "Edit message" });
    fireEvent.change(input, { target: { value: "Updated note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edited message" }));
    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith("message-own", "Updated note"));
    expect(await screen.findByText("Updated note")).toBeTruthy();
  });

  it("forwards text through the normal send callback after choosing another conversation", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ ok: true, data: null });
    await renderThread({ onSendMessage });
    const sourceMessage = (await screen.findByText("Original note")).closest(".thread-message");
    expect(sourceMessage).toBeTruthy();
    await waitFor(() => expect(within(sourceMessage as HTMLElement).getByRole("button", { name: "More message actions" })).toBeTruthy());
    fireEvent.click(within(sourceMessage as HTMLElement).getByRole("button", { name: "More message actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Forward" }));
    const forwardDialog = await screen.findByRole("dialog", { name: "Forward message" });
    fireEvent.click(within(forwardDialog).getByRole("button", { name: /Study group/ }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith("conversation-2", "Original note"));
  });
});
