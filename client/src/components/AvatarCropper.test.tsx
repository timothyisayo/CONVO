// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarCropper } from "./AvatarCropper";

afterEach(() => cleanup());

describe("AvatarCropper", () => {
  it("keeps the cropper available on a narrow mobile viewport", () => {
    window.innerWidth = 375;
    const file = new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" });
    render(<AvatarCropper file={file} onComplete={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Crop your avatar" })).toBeTruthy();
    expect(screen.getByLabelText("Zoom")).toBeTruthy();
  });

  it("renders framing controls and supports cancellation", () => {
    const onCancel = vi.fn();
    const file = new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" });
    render(<AvatarCropper file={file} onComplete={() => undefined} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Crop your avatar" })).toBeTruthy();
    expect(screen.getByLabelText("Zoom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel crop" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
