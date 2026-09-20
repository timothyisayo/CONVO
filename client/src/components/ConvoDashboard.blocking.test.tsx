// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConvoDashboard } from "./ConvoDashboard";

describe("retained direct-chat block behavior", () => {
  it("keeps the sender's blocked-period message in their thread with a neutral single tick", async () => {
    const onLoadConversations = vi.fn().mockResolvedValue({ data: [{ id: "direct-1", title: "Mariam", kind: "direct", counterpart_id: "student-2", last_message: "Earlier message" }], error: null });
    const onLoadMessages = vi.fn().mockResolvedValue({ data: [{ id: "message-1", conversation_id: "direct-1", sender_id: "student-1", body: "Can we talk?", created_at: "2026-08-27T09:00:00.000Z", delivery_state: "blocked" }], error: null });

    render(<ConvoDashboard currentUserId="student-1" displayName="Ada" major="Computer Science" groups={[]} posts={[]} onExit={() => undefined} onLoadConversations={onLoadConversations} onLoadMessages={onLoadMessages} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Messages/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Mariam/ }));

    await waitFor(() => expect(screen.getByText("Can we talk?")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/✓/)).toBeTruthy());
    expect(screen.queryByText(/Seen/)).toBeNull();
  });
});
