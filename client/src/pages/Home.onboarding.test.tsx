// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { auth, uploadAvatarMock, syncProfileMock, toastMock, passwordSafetyMock } = vi.hoisted(() => ({ auth: {
  signInWithOtp: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(async () => ({ error: null })),
  updateUser: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  getUser: vi.fn(async () => ({ data: { user: { id: "student-1", email: "ada@mtu.edu.ng", user_metadata: { display_name: "Ada", nickname: "Ada", college: "College of Basic and Applied Sciences", major: "Computer Science", programme: "Computer Science", level: "300 Level", department: "College of Basic and Applied Sciences", avatar_url: "" } } } })),
  signInWithPassword: vi.fn(async () => ({ data: { user: { user_metadata: { display_name: "Ada", nickname: "Ada", college: "College of Basic and Applied Sciences", major: "Computer Science", programme: "Computer Science", level: "300 Level", department: "College of Basic and Applied Sciences", avatar_url: "" } } }, error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
}, uploadAvatarMock: vi.fn(async () => ({ url: "https://cdn.test/cropped-avatar.jpg", error: "" })), syncProfileMock: vi.fn(async () => ({ data: true, error: null })), toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }), passwordSafetyMock: { checkPasswordExposure: vi.fn(async () => "safe"), getRememberedEmail: vi.fn(() => ""), isCommonPassword: vi.fn(() => false), saveRememberedEmail: vi.fn(), passwordSafetyMessage: vi.fn((status: string) => status === "breached" ? "This password has appeared in a data breach. Choose another." : "") } }));

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/password-safety", () => passwordSafetyMock);

vi.mock("@/lib/supabase", () => ({
  supabase: { auth, from: () => ({ upsert: vi.fn(async () => ({ error: null })) }), storage: { from: () => ({ upload: vi.fn(async () => ({ error: null })), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } },
  supabaseConfigured: true,
  supabaseSetupMessage: () => "setup",
  DEFAULT_PROFILE_VISIBILITY: { programme: true, college: true, level: true, bio: true, focus_hour: false },
  isMtuEmail: (email: string) => email.toLowerCase().endsWith("@mtu.edu.ng"),
  getProfileMetadata: (user: any) => ({ displayName: user?.user_metadata?.display_name || "", nickname: user?.user_metadata?.nickname || "", college: user?.user_metadata?.college || "", major: user?.user_metadata?.major || "", avatarUrl: user?.user_metadata?.avatar_url || "", studentId: user?.user_metadata?.student_id || "", level: user?.user_metadata?.level || "", department: user?.user_metadata?.department || "", programme: user?.user_metadata?.programme || user?.user_metadata?.major || "", bio: user?.user_metadata?.bio || "", visibility: user?.user_metadata?.profile_visibility || { programme: true, college: true, level: true, bio: true, focus_hour: false } }),
  uploadAvatar: uploadAvatarMock,
  listMtuConnectionRequests: vi.fn(async () => ({ data: [], error: null })),
  listMtuConversations: vi.fn(async () => ({ data: [], error: null })),
  touchMtuLastSeen: vi.fn(async () => ({ data: null, error: null })),
  searchMtuStudents: vi.fn(async () => ({ data: [], error: null })),
  syncMyMtuDirectoryProfile: syncProfileMock,
  subscribeToMtuPublicProfiles: vi.fn(() => () => undefined),
  subscribeToMtuAllMessages: vi.fn(() => () => undefined),
  subscribeToMtuFocusHours: vi.fn(() => () => undefined),
  getMyMtuFocusHour: vi.fn(async () => ({ data: null, error: null })),
  listMtuFocusHours: vi.fn(async () => ({ data: [], error: null })),
  startMtuFocusHour: vi.fn(async () => ({ data: null, error: null })),
  endMtuFocusHour: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("@/lib/campus-data", () => ({ useCampusData: () => ({ stories: [], posts: [], groups: [], joinedGroupIds: [], joinGroup: vi.fn(async () => ({ ok: true })), isLive: true, isLoading: false, error: null, mode: "live" }) }));
vi.mock("@/components/AvatarCropper", () => ({ AvatarCropper: ({ onComplete, onCancel }: { onComplete: (file: File) => void; onCancel: () => void }) => <div role="dialog" aria-label="Crop your avatar"><button onClick={() => onComplete(new File(["cropped"], "convo-avatar.jpg", { type: "image/jpeg" }))}>Use this crop</button><button onClick={onCancel}>Cancel crop</button></div> }));

import Home, { friendlyAuthMessage, passwordStrength } from "./Home";
import { groupSuccessCopy } from "@/components/ConvoDashboard";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); localStorage.clear(); });

describe("Home persisted Supabase session", () => {
  it("restores a complete profile directly into the workspace after refresh", async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "student-1", email: "ada@mtu.edu.ng", user_metadata: { display_name: "Ada Lovelace", nickname: "Ada", college: "College of Basic and Applied Sciences", major: "Computer Science", programme: "Computer Science", level: "300 Level", department: "College of Basic and Applied Sciences", student_id: "MTU-STUDENT1", avatar_url: "" } } } } } as any);
    render(<Home />);
    expect(await screen.findByText("Welcome back,")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Join Convo/i })).toBeNull();
    expect(toastMock.success).not.toHaveBeenCalledWith("Welcome back", expect.anything());
  });
});

const completeRequiredProfile = () => {
  fireEvent.change(screen.getByPlaceholderText("Full name (private)"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByPlaceholderText("Nickname (public)"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByRole("combobox", { name: "College" }), { target: { value: "College of Basic and Applied Sciences" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Programme" }), { target: { value: "Computer Science" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Level" }), { target: { value: "300 Level" } });
};

describe("Home reset guidance", () => {
  it("scores passwords with clear strength guidance", () => {
    expect(passwordStrength("").label).toBe("Start with a strong password");
    expect(passwordStrength("short").tone).toBe("low");
    expect(passwordStrength("BetterPass1").tone).toBe("medium");
    expect(passwordStrength("BetterPass1!").tone).toBe("high");
  });

  it("warns when the chosen reset password has appeared in a breach", async () => {
    passwordSafetyMock.checkPasswordExposure.mockResolvedValueOnce("breached");
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("New password"), { target: { value: "BetterPass1!" } });
    expect(await screen.findByText(/appeared in a data breach/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save new password/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows password strength guidance and toggles both reset fields", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    const passwordInput = await screen.findByPlaceholderText("New password");
    const confirmInput = screen.getByPlaceholderText("Confirm new password");
    fireEvent.change(passwordInput, { target: { value: "BetterPass1!" } });
    expect(screen.getByText("Strong password")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));
    fireEvent.click(screen.getByRole("button", { name: "Show password confirmation" }));
    expect(passwordInput).toHaveProperty("type", "text");
    expect(confirmInput).toHaveProperty("type", "text");
  });

  it("keeps reset strength and success feedback available with reduced motion enabled", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    const passwordInput = await screen.findByPlaceholderText("New password");
    fireEvent.change(passwordInput, { target: { value: "BetterPass1!" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), { target: { value: "BetterPass1!" } });
    await screen.findByText("No known breach match found");
    expect(screen.getByText("Strong password")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save new password/i }));
    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(document.querySelector(".reset-success-state")?.classList.contains("reset-success-state")).toBe(true);
  });

  it("redirects to login after the reset success countdown", async () => {
    vi.useFakeTimers();
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Send reset code/i })); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i })); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "BetterPass1!" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), { target: { value: "BetterPass1!" } });
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save new password/i })); await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector(".reset-success-state p")?.textContent).toContain("Returning you to login in 5");
    await act(async () => { for (let second = 0; second < 6; second += 1) { vi.advanceTimersByTime(1000); await Promise.resolve(); } });
    expect(screen.getByRole("button", { name: /Log in to Convo/i })).toBeTruthy();
  });
});

describe("Home remembered session and logout safety", () => {
  it("rehydrates a remembered email into the login form", () => {
    passwordSafetyMock.getRememberedEmail.mockReturnValueOnce("remembered@mtu.edu.ng");
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    expect((screen.getByPlaceholderText("you@mtu.edu.ng") as HTMLInputElement).value).toBe("remembered@mtu.edu.ng");
  });

  it("keeps the dashboard open and reports a logout failure", async () => {
    auth.signOut.mockResolvedValueOnce({ error: { message: "network unavailable" } } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    await screen.findByRole("button", { name: "Log out" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    fireEvent.click(screen.getByRole("button", { name: /Log out safely/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("We couldn’t sign you out", { description: "Please try again in a moment." }));
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });
});

describe("Home success feedback", () => {
  it("keeps group join confirmations distinct", () => {
    expect(groupSuccessCopy("Computer Science")).toEqual({ title: "You’re in Computer Science", description: "Your new circle is ready to explore." });
    expect(groupSuccessCopy("Computer Science", true)).toEqual({ title: "Already part of Computer Science", description: "Your circle is waiting for you." });
  });
  it("uses a distinct verification success toast", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Email verified", expect.objectContaining({ description: "Your Convo space is almost ready.", duration: 4200, className: "convo-success-toast" })));
  });

  it("shows a resend countdown and blocks repeated signup-code requests", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    expect(await screen.findByText("Resend available in 30s")).toBeTruthy();
    const resendButton = screen.getByRole("button", { name: "Wait to resend" });
    expect((resendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resendButton);
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("keeps verification success available with reduced motion enabled", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    expect(await screen.findByText("MTU email confirmed")).toBeTruthy();
    expect(toastMock.success).toHaveBeenCalledWith("Email verified", expect.objectContaining({ description: "Your Convo space is almost ready.", duration: 4200, className: "convo-success-toast" }));
  });

  it("uses a distinct welcome-back toast after login", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByText("Remember this email"));
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Welcome back", expect.objectContaining({ description: "Your campus conversations are waiting.", duration: 4200, className: "convo-success-toast" })));
    expect(screen.queryByText("Profile complete. Let the conversations begin.")).toBeNull();
    expect(passwordSafetyMock.saveRememberedEmail).toHaveBeenCalledWith("ada@mtu.edu.ng", true);
  });
});

describe("Home authentication copy", () => {
  it("maps provider errors to student-facing messages", () => {
    expect(friendlyAuthMessage(new Error("Invalid login credentials"))).toBe("That email and password combination doesn’t look right.");
    expect(friendlyAuthMessage(new Error("Token has expired"))).toBe("That verification code is invalid or has expired. Request a new one and try again.");
    expect(friendlyAuthMessage(new Error("rate limit exceeded"))).toBe("Too many attempts. Please wait a moment and try again.");
    expect(friendlyAuthMessage(new Error("Error sending magic link email"))).toBe("Email delivery is temporarily unavailable. Please try again shortly.");
    expect(friendlyAuthMessage(new Error("Error sending recovery email"))).toBe("Email delivery is temporarily unavailable. Please try again shortly.");
    expect(friendlyAuthMessage(new Error("unexpected backend failure"))).toBe("We couldn’t complete that action right now. Please try again shortly.");
  });
});

describe("Home authentication failure UI", () => {
  it("shows friendly copy when sending the signup code fails", async () => {
    (auth.signInWithOtp as any).mockResolvedValueOnce({ error: { message: "SMTP connection failed" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    expect(await screen.findByText("We couldn’t send your verification code. Please try again shortly.")).toBeTruthy();
  });

  it("shows a delivery-unavailable message for the provider email failure", async () => {
    (auth.signInWithOtp as any).mockResolvedValueOnce({ error: { message: "Error sending magic link email" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    expect(await screen.findByText("Email delivery is temporarily unavailable. Please try again shortly.")).toBeTruthy();
  });

  it("shows a delivery-unavailable message for the provider recovery-email failure", async () => {
    (auth.resetPasswordForEmail as any).mockResolvedValueOnce({ error: { message: "Error sending recovery email" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    expect(await screen.findByText("Email delivery is temporarily unavailable. Please try again shortly.")).toBeTruthy();
  });

  it("shows friendly copy when login fails", async () => {
    (auth.signInWithPassword as any).mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid login credentials" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "wrongpass" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    expect(await screen.findByText("That email and password combination doesn’t look right.")).toBeTruthy();
  });

  it("shows friendly copy when profile save fails", async () => {
    (auth.updateUser as any).mockResolvedValueOnce({ error: { message: "database update failed" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    await screen.findByText("MTU email confirmed");
    await screen.findByPlaceholderText("Create password");
    fireEvent.change(screen.getByPlaceholderText("Create password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to profile/i }));
    await screen.findByText(/Make it/i);
    completeRequiredProfile();
    fireEvent.click(screen.getByRole("button", { name: /Complete Profile/i }));
    expect(await screen.findByText("We couldn’t save your profile right now. Please try again shortly.")).toBeTruthy();
  });

  it("shows safe recovery guidance when the secure profile-sync RPC rejects", async () => {
    syncProfileMock.mockResolvedValueOnce({ data: false, error: { message: "not allowed" } } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    fireEvent.change(await screen.findByPlaceholderText("Create password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to profile/i }));
    completeRequiredProfile();
    fireEvent.click(screen.getByRole("button", { name: /Complete Profile/i }));
    expect(await screen.findByText("Your account is verified, but Convo could not create your public student profile. Refresh once, then try again.")).toBeTruthy();
  });
});

describe("Home signup failure UI", () => {
  it("shows friendly copy when the signup code is rejected", async () => {
    (auth.verifyOtp as any).mockResolvedValueOnce({ error: { message: "Token has expired" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    expect(await screen.findByText("That verification code is invalid or has expired. Request a new one and try again.")).toBeTruthy();
  });

  it("shows friendly copy when avatar upload fails", async () => {
    uploadAvatarMock.mockResolvedValueOnce({ url: "", error: "upload rejected" });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    await screen.findByText("MTU email confirmed");
    await screen.findByPlaceholderText("Create password");
    fireEvent.change(screen.getByPlaceholderText("Create password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to profile/i }));
    await screen.findByText(/Make it/i);
    completeRequiredProfile();
    const avatarInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(avatarInput, { target: { files: [new File(["source"], "source.png", { type: "image/png" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Use this crop" }));
    fireEvent.click(screen.getByRole("button", { name: /Complete Profile/i }));
    expect(await screen.findByText("We couldn’t save that profile photo. Please try another image.")).toBeTruthy();
  });
});

describe("Home password recovery", () => {
  it("requests a reset code, verifies it, and saves a new password", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    expect(await screen.findByText(/six-digit reset code/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    expect(await screen.findByPlaceholderText("New password")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "newsecurepass" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), { target: { value: "newsecurepass" } });
    await screen.findByText("No known breach match found");
    fireEvent.click(screen.getByRole("button", { name: /Save new password/i }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "newsecurepass" }));
    await screen.findByText("Password updated");
    expect(toastMock.success.mock.calls.some(([title]) => title === "Password updated")).toBe(true);
  });

  it("rejects mismatched new passwords before sending an update", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("New password"), { target: { value: "newsecurepass" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), { target: { value: "differentpass" } });
    await screen.findByText("No known breach match found");
    fireEvent.click(screen.getByRole("button", { name: /Save new password/i }));
    expect(await screen.findByText("Those passwords don’t match yet. Check them and try again.")).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("shows a friendly message when the reset code is rejected", async () => {
    (auth.verifyOtp as any).mockResolvedValueOnce({ error: { message: "Token has expired" } });
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit reset code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    expect(await screen.findByText("That verification code is invalid or has expired. Request a new one and try again.")).toBeTruthy();
  });

  it("rejects a reset code that is not six digits", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit reset code"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify reset code/i }));
    expect(await screen.findByText("Enter the six-digit code from your email.")).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("Home onboarding", () => {
  it("drives the real OTP, password, profile, and dashboard flow", async () => {
    vi.useRealTimers();
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ada@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    expect(await screen.findByText(/six-digit code/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    expect(await screen.findByText("MTU email confirmed")).toBeTruthy();
    expect(await screen.findByText(/Set your/i, {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Create password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to profile/i }));
    expect(await screen.findByText(/Make it/i)).toBeTruthy();
    completeRequiredProfile();
    const avatarInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(avatarInput, { target: { files: [new File(["source"], "source.png", { type: "image/png" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Use this crop" }));
    fireEvent.click(screen.getByRole("button", { name: /Complete Profile/i }));
    await waitFor(() => expect(screen.getByText("Ada.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Complete Profile/i })).toBeNull();
    expect(await screen.findByText("Profile complete. Let the conversations begin.")).toBeTruthy();
    expect(toastMock.success).toHaveBeenCalledWith("Profile complete", expect.objectContaining({ description: "Welcome to Convo. Your student profile is ready.", duration: 4200, className: "convo-success-toast" }));
    const updateCall = (auth.updateUser.mock.calls as unknown[][]).at(-1)?.[0] as { data?: { avatar_url?: string } } | undefined;
    expect(updateCall?.data?.avatar_url).toBe("https://cdn.test/cropped-avatar.jpg");
  });

  it("shows explicit profile setup copy when the authenticated profile is incomplete", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: "student-1", user_metadata: {} } }, error: null } as any);
    auth.getUser.mockResolvedValueOnce({ data: { user: { id: "student-1", user_metadata: {} } } } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "student@mtu.edu.ng" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    expect(await screen.findByText(/Make it/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("Full name (private)")).toBeTruthy();
    expect(screen.getByPlaceholderText("Nickname (public)")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "College" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Programme" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Level" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Public profile preview" })).toBeTruthy();
    expect(screen.getByText("What other students will see")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    expect(screen.queryByText("MTU-26-7K4Q2")).toBeNull();
    expect(screen.getByText("Complete your student profile to enter Convo. Your existing password stays unchanged.")).toBeTruthy();
    completeRequiredProfile();
    fireEvent.click(screen.getByRole("button", { name: /Complete Profile/i }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    const updateCall = (auth.updateUser.mock.calls as unknown[][]).at(-1)?.[0] as { password?: string; data?: { nickname?: string } } | undefined;
    expect(updateCall).not.toHaveProperty("password");
    expect(updateCall?.data?.nickname).toBe("Ada");
  });

  it("keeps the real onboarding modal usable at mobile width", async () => {
    window.innerWidth = 375;
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    expect(screen.getByText(/Enter the/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("you@mtu.edu.ng")).toBeTruthy();
  });
});


describe("Convo test-account login exception", () => {
  it("allows the approved test email to request a signup verification code with explicit testing guidance", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ajewoletimothymtu@gmail.com" } });
    expect(screen.getByText("Testing is enabled for this approved account. We’ll send its one-time verification code.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: "ajewoletimothymtu@gmail.com", options: { shouldCreateUser: true } }));
  });

  it("tries the signup-code verification route only for the approved test account when normal email OTP fails", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: { message: "invalid token type" } } as any).mockResolvedValueOnce({ error: null } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ajewoletimothymtu@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send verification code/i }));
    fireEvent.change(await screen.findByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify MTU email/i }));
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenLastCalledWith({ email: "ajewoletimothymtu@gmail.com", token: "123456", type: "signup" }));
  });

  it("allows the explicitly provided test email to reach password authentication", async () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ajewoletimothymtu@gmail.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "ajewoletimothymtu@gmail.com", password: "securepass123" }));
  });

  it("continues to block other non-MTU login addresses", () => {
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "someone@gmail.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    expect(screen.getByText("Only verified @mtu.edu.ng accounts can log in.")).toBeTruthy();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});


describe("public nickname identity and post-auth feedback", () => {
  it("uses nickname for the public dashboard identity without reusing the profile-complete celebration", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { user_metadata: { display_name: "Ajewole Timothy", nickname: "Moyin", college: "College of Basic and Applied Sciences", programme: "Computer Science", major: "Computer Science", level: "300 Level", department: "College of Basic and Applied Sciences" } } }, error: null } as any);
    auth.getUser.mockResolvedValueOnce({ data: { user: { user_metadata: { display_name: "Ajewole Timothy", nickname: "Moyin", college: "College of Basic and Applied Sciences", programme: "Computer Science", major: "Computer Science", level: "300 Level", department: "College of Basic and Applied Sciences" } } } } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Already registered/i }));
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "ajewoletimothymtu@gmail.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in to Convo/i }));
    expect(await screen.findByText("Moyin.")).toBeTruthy();
    expect(screen.queryByText("Ajewole Timothy.")).toBeNull();
    expect(screen.queryByText("Profile complete. Let the conversations begin.")).toBeNull();
  });
});


describe("optional profile field", () => {
  it("skips bio while saving the required public profile fields", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "student-1", user_metadata: {} } } } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "student@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify MTU email" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Create password")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Create password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to profile/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy());
    completeRequiredProfile();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalled());
    const updateCall = (auth.updateUser.mock.calls as unknown[][]).at(-1)?.[0] as { data?: { bio?: string } } | undefined;
    expect(updateCall?.data?.bio).toBeUndefined();
  });

  it("keeps the public preview outside the form and synchronized with profile fields", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "student-1", user_metadata: {} } } } as any);
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Join Convo" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("you@mtu.edu.ng"), { target: { value: "student@mtu.edu.ng" } });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await waitFor(() => expect(screen.getByPlaceholderText("6-digit code")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify MTU email" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Create password")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Create password"), { target: { value: "securepass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to profile/i }));
    const preview = await screen.findByRole("complementary", { name: "Public profile preview" });
    const form = screen.getByPlaceholderText("Full name (private)").closest(".profile-step-form");
    expect(form).toBeTruthy();
    expect(form?.contains(preview)).toBe(false);
    fireEvent.change(screen.getByPlaceholderText("Nickname (public)"), { target: { value: "Moyin" } });
    expect(await screen.findByText("Moyin")).toBeTruthy();
  });
});
