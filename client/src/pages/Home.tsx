// Style contract: Convo is a mature warm-pastel student social world. Scroll-linked scenes, tactile controls, restrained depth, and live campus activity. Avoid blue-heavy neon, childish cartoon styling, and generic centered layouts.
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  Compass,
  Eye,
  EyeOff,
  Heart,
  Layers3,
  MessageCircle,
  Play,
  Search,
  Sparkles,
  Users,
  Waves,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCampusData } from "@/lib/campus-data";
import { CONVO_TEST_LOGIN_EMAIL, isAllowedConvoLoginEmail } from "@shared/mtu";
import {
  MTU_COLLEGE_OPTIONS,
  MTU_LEVEL_OPTIONS,
  programmesForCollege,
} from "@shared/academic";
import { CampusPanels } from "@/components/CampusPanels";
import { ConvoDashboard } from "@/components/ConvoDashboard";
import { CallOverlay } from "@/components/CallOverlay";
import { askGemini } from "@/lib/providers";
import { AvatarCropper } from "@/components/AvatarCropper";
import { ConvoSuccessCelebration } from "@/components/ConvoSuccessCelebration";
import { ConvoProfilePreview } from "@/components/ConvoProfilePreview";
import {
  acceptMtuConnectionRequest,
  addMtuGroupMembers,
  blockMtuStudent,
  cancelMtuConnectionRequest,
  createMtuGroupInvite,
  createMtuGroupEvent,
  cancelMtuGroupEvent,
  createMtuGroupNote,
  createMtuGroupAnnouncement,
  updateMtuGroupAnnouncement,
  deleteMtuGroupAnnouncement,
  createMtuGroupConversation,
  touchMtuLastSeen,
  searchMtuGroups,
  setMtuGroupPrivate,
  requestMtuGroupJoin,
  endMtuGroup,
  deleteMtuGroupMessage,
  listMtuSharedFiles,
  createMtuGroupPoll,
  updateMtuGroupPoll,
  closeMtuGroupPoll,
  deleteMtuGroupPoll,
  createMtuGroupTask,
  updateMtuGroupTask,
  deleteMtuGroupTask,
  castMtuGroupPollVote,
  deleteMtuMessage,
  editMtuMessage,
  DEFAULT_PROFILE_VISIBILITY,
  getMtuConversationNotificationPreference,
  getMtuConversationAppearance,
  getMtuPrivacySettings,
  getProfileMetadata,
  getMtuGroupPermissions,
  listMtuGroupEvents,
  listMtuGroupNotes,
  listMtuGroupAnnouncements,
  joinMtuGroupInvite,
  listMtuGroupJoinRequests,
  listMtuGroupPolls,
  listMtuGroupTasks,
  setMtuGroupEventResponse,
  updateMtuGroupEvent,
  deleteMtuGroupEvent,
  updateMtuGroupNote,
  listMtuSavedMessages,
  isMtuEmail,
  listMtuConnectionRequests,
  listMtuBlockedStudents,
  listMtuConversations,
  listMtuGroupMembers,
  listMtuMessageInteractions,
  listMtuMessages,
  markMtuConversationRead,
  reportMtuStudent,
  reviewMtuGroupJoinRequest,
  removeMtuGroupMember,
  rotateMtuGroupInvite,
  searchMtuStudents,
  searchMtuConversationMessages,
  syncMyMtuDirectoryProfile,
  sendMtuConnectionRequest,
  sendMtuMessage,
  startMtuDirectConversation,
  subscribeToMtuAllMessages,
  subscribeToMtuPublicProfiles,
  subscribeToMtuConversation,
  subscribeToMtuMessages,
  subscribeToMtuGroupActivity,
  supabase,
  setMtuConversationPreference,
  setMtuConversationRailState,
  setMtuPrivacySettings,
  setMtuConversationNotificationPreference,
  setMtuConversationAppearance,
  setMtuGroupMemberRole,
  setMtuGroupImage,
  setMtuGroupPermissions,
  setMtuGroupTaskCompleted,
  toggleMtuMessageReaction,
  toggleMtuPinnedMessage,
  toggleMtuSavedMessage,
  uploadMessageAttachment,
  createMtuAttachmentSignedUrl,
  uploadMtuGroupImage,
  supabaseConfigured,
  supabaseSetupMessage,
  type MtuConversationAppearance,
  type MtuPrivacySettings,
  type ProfileVisibility,
  uploadAvatar,
  unblockMtuStudent,
} from "@/lib/supabase";
import {
  checkPasswordExposure,
  getRememberedEmail,
  isCommonPassword,
  passwordSafetyMessage,
  saveRememberedEmail,
  type PasswordSafety,
} from "@/lib/password-safety";

const heroAsset = "";
const hubAsset = "";

export function passwordStrength(value: string) {
  const checks = [
    value.length >= 8,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ];
  const score = checks.filter(Boolean).length;
  if (!value)
    return {
      score: 0,
      label: "Start with a strong password",
      tone: "empty" as const,
    };
  if (score <= 2)
    return {
      score,
      label: "Needs a little more strength",
      tone: "low" as const,
    };
  if (score <= 4)
    return { score, label: "Looking good", tone: "medium" as const };
  return { score, label: "Strong password", tone: "high" as const };
}

export function friendlyAuthMessage(
  error: unknown,
  fallback = "We couldn’t complete that action right now. Please try again shortly."
) {
  const message = (
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message || "")
        : String(error || "")
  ).toLowerCase();
  if (
    message.includes("invalid login") ||
    message.includes("invalid email or password") ||
    message.includes("invalid credentials")
  )
    return "That email and password combination doesn’t look right.";
  if (
    message.includes("error sending magic link email") ||
    message.includes("error sending recovery email") ||
    message.includes("email address not authorized") ||
    message.includes("email delivery")
  )
    return "Email delivery is temporarily unavailable. Please try again shortly.";
  if (
    message.includes("expired") ||
    message.includes("invalid token") ||
    message.includes("otp") ||
    message.includes("code")
  )
    return "That verification code is invalid or has expired. Request a new one and try again.";
  if (
    message.includes("rate") ||
    message.includes("too many") ||
    message.includes("limit")
  )
    return "Too many attempts. Please wait a moment and try again.";
  if (
    message.includes("already registered") ||
    message.includes("already been registered")
  )
    return "This MTU email is already registered. Try logging in instead.";
  return fallback;
}

export default function Home() {
  const {
    stories,
    posts,
    groups,
    joinedGroupIds,
    joinGroup,
    isLive,
    isLoading,
    error,
    mode,
  } = useCampusData();
  const [activeSection, setActiveSection] = useState("home");
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [authMode, setAuthMode] = useState<"signup" | "login" | "reset">(
    "signup"
  );
  const [authStep, setAuthStep] = useState<
    "email" | "code" | "password" | "profile"
  >("email");
  const [email, setEmail] = useState(() => getRememberedEmail());
  const [authenticatedEmail, setAuthenticatedEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(() =>
    Boolean(getRememberedEmail())
  );
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetRedirectCountdown, setResetRedirectCountdown] = useState(5);
  const [passwordSafety, setPasswordSafety] = useState<PasswordSafety>("idle");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [profileNeedsPassword, setProfileNeedsPassword] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => window.localStorage.getItem("convo-notifications-enabled") !== "false");
  const [signupNotificationsChoice, setSignupNotificationsChoice] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("");
  const [college, setCollege] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [major, setMajor] = useState("");
  const [studentId, setStudentId] = useState("");
  const [level, setLevel] = useState("");
  const [department, setDepartment] = useState("");
  const [programme, setProgramme] = useState("");
  const [bio, setBio] = useState("");
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>(DEFAULT_PROFILE_VISIBILITY);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [showDashboard, setShowDashboard] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [dashboardRevealed, setDashboardRevealed] = useState(true);
  const [dashboardExiting, setDashboardExiting] = useState(false);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [heroTilt, setHeroTilt] = useState({ x: 0, y: 0 });
  const tokenRef = useRef<HTMLDivElement>(null);
  const directoryProfileSyncedRef = useRef(false);
  const isUsingApprovedTestEmail =
    email.trim().toLowerCase() === CONVO_TEST_LOGIN_EMAIL;

  useEffect(() => {
    const robotsSelector = 'meta[name="robots"]';
    const existingRobots = document.head.querySelector(robotsSelector);
    if (showDashboard) {
      const robots = existingRobots || document.head.appendChild(document.createElement("meta"));
      robots.setAttribute("name", "robots");
      robots.setAttribute("content", "noindex, nofollow, noarchive");
      document.title = "Convo — School Communication Platform";
    } else if (existingRobots) {
      existingRobots.remove();
      document.title = "Convo — School Communication Platform";
    }
  }, [showDashboard]);

  useEffect(() => {
    if (!resetSuccess) return;
    const countdownTimer = window.setInterval(
      () => setResetRedirectCountdown(current => Math.max(0, current - 1)),
      1000
    );
    const redirectTimer = window.setTimeout(() => {
      setResetSuccess(false);
      setShowModal(true);
      setAuthMode("login");
      setAuthStep("password");
      setPassword("");
      setPasswordConfirm("");
      setCode("");
    }, 5000);
    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [resetSuccess]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(
      () => setResendCooldown(current => Math.max(0, current - 1)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max ? Math.min(1, window.scrollY / max) : 0;
      setScrollProgress(progress);
      if (window.scrollY < window.innerHeight * 0.72) setActiveSection("home");
      else if (window.scrollY < window.innerHeight * 1.45)
        setActiveSection("commons");
      else setActiveSection("rhythm");
      if (tokenRef.current)
        tokenRef.current.style.transform = `rotateY(${progress * 540}deg) rotateZ(${progress * 8}deg)`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const comingSoon = (label: string) =>
    toast(`${label} is part of the next Convo release.`);
  const openAuth = (mode: "signup" | "login") => {
    setAuthMode(mode);
    setAuthStep(mode === "login" ? "password" : "email");
    setProfileNeedsPassword(false);
    setAuthError("");
    setCode("");
    setShowModal(true);
  };
  const openReset = () => {
    setAuthMode("reset");
    setAuthStep("email");
    setAuthError("");
    setCode("");
    setPassword("");
    setPasswordConfirm("");
    setShowResetPassword(false);
    setShowResetConfirm(false);
    setResetSuccess(false);
    setResetRedirectCountdown(5);
    setResendCooldown(0);
    setShowModal(true);
  };

  const resetStrength = passwordStrength(password);

  useEffect(() => {
    if (
      authMode !== "reset" ||
      authStep !== "password" ||
      password.length < 8
    ) {
      setPasswordSafety("idle");
      return;
    }
    let active = true;
    if (isCommonPassword(password)) {
      setPasswordSafety("common");
      return () => {
        active = false;
      };
    }
    setPasswordSafety("checking");
    const timer = window.setTimeout(() => {
      void checkPasswordExposure(password).then(status => {
        if (active) setPasswordSafety(status);
      });
    }, 420);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [authMode, authStep, password]);
  const showSuccessToast = (title: string, description: string) =>
    toast.success(title, {
      description,
      duration: 4200,
      className: "convo-success-toast",
    });

  const sendOtp = async () => {
    const normalized = email.trim().toLowerCase();
    if (!isAllowedConvoLoginEmail(normalized)) {
      setAuthError("Use your official MTU email ending in @mtu.edu.ng.");
      return;
    }
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: true },
    });
    setAuthBusy(false);
    if (error)
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t send your verification code. Please try again shortly."
        )
      );
    else {
      setAuthStep("code");
      setResendCooldown(30);
      showSuccessToast(
        "Your code is on its way",
        isUsingApprovedTestEmail
          ? "Check the approved testing inbox for the six digits."
          : "Check your MTU inbox for the six digits."
      );
    }
  };

  const requestReset = async () => {
    const normalized = email.trim().toLowerCase();
    if (!isAllowedConvoLoginEmail(normalized)) {
      setAuthError("Use your official MTU email ending in @mtu.edu.ng.");
      return;
    }
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.resetPasswordForEmail(normalized);
    setAuthBusy(false);
    if (error)
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t send a reset code. Please try again shortly."
        )
      );
    else {
      setAuthStep("code");
      setResendCooldown(30);
      showSuccessToast(
        "Reset code is on its way",
        "Check your MTU inbox to continue."
      );
    }
  };

  const resendCode = () => {
    if (resendCooldown > 0 || authBusy) return;
    if (authMode === "reset") void requestReset();
    else void sendOtp();
  };

  const verifyCode = async () => {
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const emailOtpResult = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    const signupOtpResult =
      emailOtpResult.error && isUsingApprovedTestEmail
        ? await supabase.auth.verifyOtp({
            email: email.trim().toLowerCase(),
            token: code.trim(),
            type: "signup",
          })
        : null;
    const error = signupOtpResult?.error ?? emailOtpResult.error;
    setAuthBusy(false);
    if (error)
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t verify that code. Please request a new one and try again."
        )
      );
    else {
      setOtpSuccess(true);
      window.setTimeout(() => {
        setOtpSuccess(false);
        setAuthStep("password");
      }, 720);
      showSuccessToast("Email verified", "Your Convo space is almost ready.");
    }
  };

  const verifyResetCode = async () => {
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setAuthError("Enter the six-digit code from your email.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "recovery",
    });
    setAuthBusy(false);
    if (error)
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t verify that code. Please request a new one and try again."
        )
      );
    else {
      setAuthStep("password");
      showSuccessToast(
        "Code verified",
        "Choose a new password to get back in."
      );
    }
  };

  const finishReset = async () => {
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    if (password.length < 8) {
      setAuthError("Choose a password with at least 8 characters.");
      return;
    }
    if (passwordSafety === "breached" || passwordSafety === "common") {
      setAuthError(passwordSafetyMessage(passwordSafety));
      return;
    }
    if (passwordSafety === "checking") {
      setAuthError("We’re still checking that password. Please wait a moment.");
      return;
    }
    if (password !== passwordConfirm) {
      setAuthError(
        "Those passwords don’t match yet. Check them and try again."
      );
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.updateUser({ password });
    setAuthBusy(false);
    if (error)
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t update your password right now. Please try again shortly."
        )
      );
    else {
      setShowModal(true);
      setResetSuccess(true);
      setResetRedirectCountdown(5);
      setAuthError("");
      showSuccessToast("Password updated", "You’re ready to log in again.");
    }
  };

  const hydrateDashboard = async () => {
    if (!supabase) {
      setShowDashboard(true);
      return;
    }
    const { data } = await supabase.auth.getUser();
    const profile = getProfileMetadata(data.user);
    setCurrentUserId(data.user?.id || "");
    setDisplayName(profile.displayName || displayName);
    setNickname(profile.nickname);
    setCollege(profile.college);
    setMajor(profile.major || major);
    setStudentId(profile.studentId);
    setLevel(profile.level);
    setDepartment(profile.department);
    setProgramme(profile.programme);
    setBio(profile.bio);
    setProfileVisibility(profile.visibility);
    setAvatarPreview(profile.avatarUrl || avatarPreview);
    setShowDashboard(true);
  };

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    const applySession = (user: { id?: string; email?: string; user_metadata?: Record<string, unknown> } | null | undefined) => {
      if (!active || !user) return;
      const profile = getProfileMetadata(user);
      const complete = Boolean(profile.displayName && profile.nickname && profile.college && profile.programme && profile.level);
      const generatedStudentId = profile.studentId || (user.id ? `MTU-${user.id.replace(/-/g, "").slice(0, 8).toUpperCase()}` : "");
      setCurrentUserId(user.id || "");
      setAuthenticatedEmail(user.email || "");
      setDisplayName(profile.displayName);
      setNickname(profile.nickname);
      setCollege(profile.college);
      setMajor(profile.major);
      setStudentId(generatedStudentId);
      setLevel(profile.level);
      setDepartment(profile.department);
      setProgramme(profile.programme);
      setBio(profile.bio);
      setAvatarPreview(profile.avatarUrl);
      setProfileVisibility(profile.visibility);
      if (!complete) {
        setProfileNeedsPassword(false);
        setAuthMode("signup");
        setAuthStep("profile");
        setShowModal(true);
        setShowDashboard(false);
        return;
      }
      setShowModal(false);
      setShowCelebration(false);
      setDashboardRevealed(true);
      setShowDashboard(true);
      if (isAllowedConvoLoginEmail(user.email || "") && user.id) void syncMyMtuDirectoryProfile(client).catch(() => undefined);
    };
    const restore = async () => {
      const { data } = await client.auth.getSession();
      applySession(data.session?.user);
    };
    void restore();
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setShowDashboard(false);
        return;
      }
      if (event !== "INITIAL_SESSION") applySession(session?.user);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const continueToProfile = () => {
    if (password.length < 8) {
      setAuthError("Choose a password with at least 8 characters.");
      return;
    }
    setProfileNeedsPassword(true);
    setAuthError("");
    setAuthStep("profile");
  };

  const finishSignup = async () => {
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    if (
      !displayName.trim() ||
      !nickname.trim() ||
      !college ||
      !programme ||
      !level
    ) {
      setAuthError(
        "Complete your name, nickname, college, programme, and level before entering Convo."
      );
      return;
    }
    if (profileNeedsPassword && password.length < 8) {
      setAuthError("Choose a password with at least 8 characters.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const { data: authState, error: sessionError } =
        await supabase.auth.getUser();
      if (sessionError) {
        setAuthError(
          "Your verification session has expired. Please start again to finish your profile."
        );
        return;
      }
      if (!authState.user) {
        setAuthError(
          "Your verification session has expired. Please start again to finish your profile."
        );
        return;
      }
      const publicStudentId = `MTU-${authState.user.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      let avatarUrl = "";
      if (avatarFile) {
        const upload = await uploadAvatar(
          supabase,
          avatarFile,
          authState.user.id
        );
        if (upload.error || !upload.url) {
          setAuthError(
            "We couldn’t save that profile photo. Please try another image."
          );
          return;
        }
        avatarUrl = upload.url;
      }
      const profileData = {
        display_name: displayName.trim(),
        nickname: nickname.trim(),
        college,
        major: programme,
        programme,
        level,
        department: college,
        bio: bio.trim() || undefined,
        student_id: publicStudentId,
        avatar_url: avatarUrl || undefined,
        profile_visibility: profileVisibility,
      };
      const { error } = await supabase.auth.updateUser(
        profileNeedsPassword
          ? { password, data: profileData }
          : { data: profileData }
      );
      if (error) {
        console.error("[Convo] profile auth update failed", error);
        setAuthError(
          friendlyAuthMessage(
            error,
            "We couldn’t save your profile right now. Please try again shortly."
          )
        );
        return;
      }
      setNotificationsEnabled(signupNotificationsChoice);
      window.localStorage.setItem("convo-notifications-enabled", String(signupNotificationsChoice));
      if (signupNotificationsChoice && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      if (isAllowedConvoLoginEmail(authState.user.email || "")) {
        const profileSync = await syncMyMtuDirectoryProfile(supabase);
        if (profileSync.error || !profileSync.data) {
          console.error("[Convo] public profile sync failed", profileSync.error);
          setAuthError("Your account is verified, but Convo could not create your public student profile. Refresh once, then try again.");
          return;
        }
      }
      setShowModal(false);
      await hydrateDashboard();
      setDashboardRevealed(false);
      setShowCelebration(true);
      showSuccessToast(
        "Profile complete",
        "Welcome to Convo. Your student profile is ready."
      );
    } catch (error) {
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t save your profile right now. Please try again shortly."
        )
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const login = async () => {
    if (!supabase) {
      setAuthError(supabaseSetupMessage());
      return;
    }
    if (!isAllowedConvoLoginEmail(email)) {
      setAuthError("Only verified @mtu.edu.ng accounts can log in.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setAuthBusy(false);
    if (error)
      setAuthError(
        friendlyAuthMessage(
          error,
          "We couldn’t sign you in right now. Please try again shortly."
        )
      );
    else {
      const profile = getProfileMetadata(data.user);
      const needsProfile = !(
        profile.displayName &&
        profile.nickname &&
        profile.college &&
        profile.programme &&
        profile.level
      );
      saveRememberedEmail(email.trim().toLowerCase(), rememberMe);
      setDisplayName(profile.displayName);
      setNickname(profile.nickname);
      setCollege(profile.college);
      setMajor(profile.major);
      setStudentId(profile.studentId);
      setLevel(profile.level);
      setDepartment(profile.department);
      setProgramme(profile.programme);
      setBio(profile.bio);
      setAvatarPreview(profile.avatarUrl);
      setProfileVisibility(profile.visibility);
      if (needsProfile) {
        setAuthMode("signup");
        setAuthStep("profile");
        setProfileNeedsPassword(false);
        setShowModal(true);
        showSuccessToast(
          "One quick setup step",
          "Complete your MTU identity before entering Convo."
        );
      } else {
        setShowModal(false);
        await hydrateDashboard();
        setShowCelebration(false);
        setDashboardRevealed(true);
        showSuccessToast(
          "Welcome back",
          "Your campus conversations are waiting."
        );
      }
    }
  };

  const updateProfile = async (updates: {
    nickname: string;
    programme: string;
    college: string;
    level: string;
    bio: string;
  }) => {
    if (!supabase) return { ok: false, error: supabaseSetupMessage() };
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        nickname: updates.nickname.trim(),
        programme: updates.programme.trim(),
        major: updates.programme.trim(),
        college: updates.college.trim(),
        department: updates.college.trim(),
        level: updates.level.trim(),
        bio: updates.bio.trim(),
      },
    });
    if (updateError)
      return {
        ok: false,
        error: friendlyAuthMessage(updateError, "Please try again shortly."),
      };
    const { data: userState } = await supabase.auth.getUser();
    const user = userState.user;
    if (user?.id && isAllowedConvoLoginEmail(user.email || "")) {
      const profileSync = await syncMyMtuDirectoryProfile(supabase);
      if (profileSync.error || !profileSync.data) return { ok: false, error: "Your public student profile could not be updated. Please refresh once, then try again." };
    }
    setNickname(updates.nickname.trim());
    setProgramme(updates.programme.trim());
    setMajor(updates.programme.trim());
    setCollege(updates.college.trim());
    setDepartment(updates.college.trim());
    setLevel(updates.level.trim());
    setBio(updates.bio.trim());
    return { ok: true };
  };
  const updateAvatar = async (file: File) => {
    if (!supabase) return { ok: false, error: supabaseSetupMessage() };
    const { data: userState } = await supabase.auth.getUser();
    if (!userState.user) return { ok: false, error: "Your session has expired. Please sign in again." };
    const upload = await uploadAvatar(supabase, file, userState.user.id);
    if (upload.error || !upload.url) return { ok: false, error: upload.error || "Please choose a PNG, JPG, or WebP image below 5 MB." };
    const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: upload.url } });
    if (updateError) return { ok: false, error: friendlyAuthMessage(updateError, "Please try again shortly.") };
    setAvatarPreview(upload.url);
    if (isAllowedConvoLoginEmail(userState.user.email || "")) {
      const synced = await syncMyMtuDirectoryProfile(supabase);
      if (synced.error || !synced.data) return { ok: false, error: "Your profile photo was uploaded, but could not be made visible in Convo. Refresh once, then try again." };
    }
    return { ok: true, url: upload.url };
  };
  const updatePrivacy = async (visibility: ProfileVisibility) => {
    if (!supabase) return { ok: false, error: supabaseSetupMessage() };
    const { error: updateError } = await supabase.auth.updateUser({ data: { profile_visibility: visibility } });
    if (updateError) return { ok: false, error: friendlyAuthMessage(updateError, "Please try again shortly.") };
    const synced = await syncMyMtuDirectoryProfile(supabase);
    if (synced.error || !synced.data) return { ok: false, error: "Your privacy choice could not be saved. Please refresh once, then try again." };
    setProfileVisibility(visibility);
    return { ok: true };
  };
  const searchStudents = React.useCallback(async (query: string) => {
    if (!supabase) return { data: [], error: null };
    if (!directoryProfileSyncedRef.current) {
      const sync = await syncMyMtuDirectoryProfile(supabase);
      if (sync.error) return { data: [], error: sync.error };
      directoryProfileSyncedRef.current = true;
    }
    return searchMtuStudents(supabase, query);
  }, []);
  const sendConnectionRequest = async (recipientId: string) => {
    if (!supabase)
      return { ok: false, error: "Sign in to connect with another student." };
    const result = await sendMtuConnectionRequest(supabase, recipientId);
    return result.error
      ? { ok: false, error: result.error.message }
      : { ok: true };
  };
  const cancelConnectionRequest = async (recipientId: string) => {
    if (!supabase)
      return { ok: false, error: "Sign in to manage connection requests." };
    const result = await cancelMtuConnectionRequest(supabase, recipientId);
    return result.error
      ? { ok: false, error: result.error.message }
      : { ok: true };
  };
  const startDirectConversation = async (studentId: string) => {
    if (!supabase)
      return {
        data: null,
        error: { message: "Sign in to start a conversation." },
      };
    const result = await startMtuDirectConversation(supabase, studentId);
    return result.error
      ? { data: null, error: result.error }
      : { data: result.data, error: null };
  };
  const createGroupConversation = async (
    title: string,
    memberIds: string[] = [],
    category: import("@/lib/supabase").MtuGroupCategory = "academic"
  ) => {
    if (!supabase)
      return { data: null, error: { message: "Sign in to create a group." } };
    const result = await createMtuGroupConversation(supabase, title, memberIds, category);
    return result.error
      ? { data: null, error: result.error }
      : { data: result.data, error: null };
  };
  const updateGroupImage = async (conversationId: string, image: File) => {
    if (!supabase) return { ok: false, error: "Sign in to update a group image." };
    const { data: authState } = await supabase.auth.getUser();
    if (!authState.user?.id) return { ok: false, error: "Your session has expired. Please sign in again." };
    const uploaded = await uploadMtuGroupImage(supabase, image, authState.user.id, conversationId);
    if (uploaded.error) return { ok: false, error: uploaded.error };
    const saved = await setMtuGroupImage(supabase, conversationId, uploaded.url, uploaded.path);
    return saved.error || !saved.data ? { ok: false, error: saved.error?.message || "Couldn’t save the group image." } : { ok: true, url: saved.data };
  };
  const setGroupPrivate = async (conversationId: string, isPrivate: boolean) => {
    if (!supabase) return { ok: false, error: "Sign in to update group privacy." };
    const result = await setMtuGroupPrivate(supabase, conversationId, isPrivate);
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  };
  const loadGroupMembers = async (conversationId: string) => {
    if (!supabase) return { data: [], error: null };
    const result = await listMtuGroupMembers(supabase, conversationId);
    return result.error ? { data: [], error: result.error } : { data: result.data, error: null };
  };
  const addGroupMembers = async (conversationId: string, memberIds: string[]) => {
    if (!supabase) return { ok: false, error: "Sign in to add group members.", added: 0 };
    const result = await addMtuGroupMembers(supabase, conversationId, memberIds);
    return result.error ? { ok: false, error: result.error.message, added: 0 } : { ok: true, added: result.data };
  };
  const updateGroupMemberRole = async (conversationId: string, memberId: string, role: "admin" | "member") => {
    if (!supabase) return { ok: false, error: "Sign in to manage group roles." };
    const result = await setMtuGroupMemberRole(supabase, conversationId, memberId, role);
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  };
  const removeGroupMember = async (conversationId: string, memberId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to manage group members." };
    const result = await removeMtuGroupMember(supabase, conversationId, memberId);
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  };
  const createGroupInvite = async (conversationId: string) => {
    if (!supabase) return { data: null, error: "Sign in to create an invite link." };
    const result = await createMtuGroupInvite(supabase, conversationId);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadGroupPermissions = async (conversationId: string) => {
    if (!supabase) return { data: null, error: "Sign in to view group permissions." };
    const result = await getMtuGroupPermissions(supabase, conversationId);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const updateGroupPermissions = async (conversationId: string, permissions: { allow_member_messages: boolean; allow_member_invites: boolean; require_join_approval: boolean }) => {
    if (!supabase) return { data: null, error: "Sign in to update group permissions." };
    const result = await setMtuGroupPermissions(supabase, conversationId, permissions);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const joinGroupInvite = async (token: string) => {
    if (!supabase) return { data: null, error: "Sign in to open this group invitation." };
    const result = await joinMtuGroupInvite(supabase, token);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadGroupJoinRequests = async (conversationId: string) => {
    if (!supabase) return { data: [], error: "Sign in to review join requests." };
    const result = await listMtuGroupJoinRequests(supabase, conversationId);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const reviewGroupJoinRequest = async (conversationId: string, userId: string, approve: boolean) => {
    if (!supabase) return { ok: false, error: "Sign in to review join requests." };
    const result = await reviewMtuGroupJoinRequest(supabase, conversationId, userId, approve);
    return result.error ? { ok: false, error: result.error.message } : { ok: result.data };
  };
  const sendMessage = async (
    conversationId: string,
    body: string,
    attachment?: File | null,
    replyToId?: string | null
  ) => {
    if (!supabase) return { ok: false, error: "Sign in to send messages." };
    let attachmentUrl: string | null = null;
    let attachmentPath: string | null = null;
    if (attachment) {
      const { data: authState } = await supabase.auth.getUser();
      if (!authState.user?.id)
        return {
          ok: false,
          error: "Your session has expired. Please sign in again.",
        };
      const uploaded = await uploadMessageAttachment(
        supabase,
        attachment,
        authState.user.id
      );
      if (uploaded.error) return { ok: false, error: uploaded.error };
      attachmentUrl = uploaded.url;
      attachmentPath = uploaded.path;
    }
    const result = await sendMtuMessage(
      supabase,
      conversationId,
      body,
      attachmentUrl,
      attachmentPath,
      replyToId || null,
      attachment?.type.split(";")[0].trim().toLowerCase() || null
    );
    if (result.error) return { ok: false, error: result.error.message };
    const saved = result.data as {
      id: string;
      sender_id: string;
      body: string;
      created_at: string;
      attachment_url?: string | null;
      attachment_path?: string | null;
      attachment_mime?: string | null;
      edited_at?: string | null;
      deleted_at?: string | null;
      delivery_state?: "delivered" | "blocked";
    } | null;
    return { ok: true, data: saved };
  };
  const editMessage = async (messageId: string, body: string) => {
    if (!supabase) return { ok: false, error: "Sign in to edit messages." };
    const result = await editMtuMessage(supabase, messageId, body);
    return result.error
      ? { ok: false, error: result.error.message }
      : { ok: true, data: result.data as Record<string, unknown> | null };
  };
  const deleteMessage = async (messageId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete messages." };
    const result = await deleteMtuMessage(supabase, messageId);
    return result.error
      ? { ok: false, error: result.error.message }
      : { ok: true, data: result.data as Record<string, unknown> | null };
  };
  const loadMessageInteractions = async (conversationId: string) => {
    if (!supabase) return { data: [], error: null };
    const result = await listMtuMessageInteractions(supabase, conversationId);
    return result.error ? { data: [], error: result.error } : { data: result.data, error: null };
  };
  const toggleMessageReaction = async (messageId: string, emoji: string) => {
    if (!supabase) return { ok: false, error: "Sign in to react to a message.", active: false };
    const result = await toggleMtuMessageReaction(supabase, messageId, emoji);
    return result.error ? { ok: false, error: result.error.message, active: false } : { ok: true, active: result.data };
  };
  const toggleSavedMessage = async (messageId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to save a message.", active: false };
    const result = await toggleMtuSavedMessage(supabase, messageId);
    return result.error ? { ok: false, error: result.error.message, active: false } : { ok: true, active: result.data };
  };
  const togglePinnedMessage = async (conversationId: string, messageId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to pin a message.", active: false };
    const result = await toggleMtuPinnedMessage(supabase, conversationId, messageId);
    return result.error ? { ok: false, error: result.error.message, active: false } : { ok: true, active: result.data };
  };
  const setConversationPreference = async (conversationId: string, privateLabel: string | null, isArchived: boolean) => {
    if (!supabase) return { ok: false, error: "Sign in to update this conversation." };
    const result = await setMtuConversationPreference(supabase, conversationId, privateLabel, isArchived);
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  };
  const setConversationRailState = async (conversationId: string, pinned: boolean | null, archived: boolean | null, draftBody: string | null, markUnread: boolean | null = null) => {
    if (!supabase) return { data: null, error: "Sign in to update this conversation." };
    const result = await setMtuConversationRailState(supabase, conversationId, pinned, archived, draftBody, markUnread);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadPrivacySettings = async () => {
    if (!supabase) return { data: null, error: "Sign in to manage privacy." };
    const result = await getMtuPrivacySettings(supabase);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const updatePrivacySettings = async (settings: MtuPrivacySettings) => {
    if (!supabase) return { data: null, error: "Sign in to manage privacy." };
    const result = await setMtuPrivacySettings(supabase, settings);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadConversationNotificationPreference = async (conversationId: string) => {
    if (!supabase) return { data: null, error: "Sign in to manage notifications." };
    const result = await getMtuConversationNotificationPreference(supabase, conversationId);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const updateConversationNotificationPreference = async (conversationId: string, muted: boolean, mutedUntil: string | null) => {
    if (!supabase) return { data: null, error: "Sign in to manage notifications." };
    const result = await setMtuConversationNotificationPreference(supabase, conversationId, muted, mutedUntil);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadConversationAppearance = async (conversationId: string) => {
    if (!supabase) return { data: null, error: "Sign in to personalize this conversation." };
    const result = await getMtuConversationAppearance(supabase, conversationId);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const updateConversationAppearance = async (conversationId: string, appearance: MtuConversationAppearance) => {
    if (!supabase) return { data: null, error: "Sign in to personalize this conversation." };
    const result = await setMtuConversationAppearance(supabase, conversationId, appearance);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadSavedMessages = async () => {
    if (!supabase) return { data: [], error: "Sign in to view saved messages." };
    const result = await listMtuSavedMessages(supabase);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const searchConversationMessages = async (conversationId: string, query: string) => {
    if (!supabase) return { data: [], error: "Sign in to search messages." };
    const result = await searchMtuConversationMessages(supabase, conversationId, query);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const createGroupEvent = async (conversationId: string, title: string, description: string, startsAt: string, location: string) => {
    if (!supabase) return { data: null, error: { message: "Sign in to create an event." } };
    const result = await createMtuGroupEvent(supabase, conversationId, title, description, startsAt, location);
    return result.error ? { data: null, error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const loadGroupEvents = async (conversationId: string) => {
    if (!supabase) return { data: [], error: { message: "Sign in to view group events." } };
    const result = await listMtuGroupEvents(supabase, conversationId);
    return result.error ? { data: [], error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const updateGroupEvent = async (eventId: string, title: string, description: string, startsAt: string, location: string) => {
    if (!supabase) return { ok: false, error: "Sign in to edit this event." };
    const result = await updateMtuGroupEvent(supabase, eventId, title, description, startsAt, location);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const deleteGroupEvent = async (eventId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete this event." };
    const result = await deleteMtuGroupEvent(supabase, eventId);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const setGroupEventResponse = async (eventId: string, response: "going" | "maybe" | "declined") => {
    if (!supabase) return { data: null, error: { message: "Sign in to respond to this event." } };
    const result = await setMtuGroupEventResponse(supabase, eventId, response);
    return result.error ? { data: null, error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const cancelGroupEvent = async (eventId: string) => {
    if (!supabase) return { data: null, error: { message: "Sign in to cancel this event." } };
    const result = await cancelMtuGroupEvent(supabase, eventId);
    return result.error ? { data: null, error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const createGroupNote = async (conversationId: string, title: string, body: string) => {
    if (!supabase) return { data: null, error: { message: "Sign in to create a note." } };
    const result = await createMtuGroupNote(supabase, conversationId, title, body);
    return result.error ? { data: null, error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const updateGroupNote = async (noteId: string, title: string, body: string) => {
    if (!supabase) return { data: null, error: { message: "Sign in to update a note." } };
    const result = await updateMtuGroupNote(supabase, noteId, title, body);
    return result.error ? { data: null, error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const loadGroupNotes = async (conversationId: string) => {
    if (!supabase) return { data: [], error: { message: "Sign in to view group notes." } };
    const result = await listMtuGroupNotes(supabase, conversationId);
    return result.error ? { data: [], error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const createGroupAnnouncement = async (conversationId: string, title: string, body: string, expiresAt: string | null) => {
    if (!supabase) return { data: null, error: { message: "Sign in to publish an announcement." } };
    const result = await createMtuGroupAnnouncement(supabase, conversationId, title, body, expiresAt);
    return result.error ? { data: null, error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const loadGroupAnnouncements = async (conversationId: string) => {
    if (!supabase) return { data: [], error: { message: "Sign in to view announcements." } };
    const result = await listMtuGroupAnnouncements(supabase, conversationId);
    return result.error ? { data: [], error: { message: result.error.message } } : { data: result.data, error: null };
  };
  const updateGroupAnnouncement = async (announcementId: string, title: string, body: string, expiresAt: string | null) => {
    if (!supabase) return { ok: false, error: "Sign in to edit this announcement." };
    const result = await updateMtuGroupAnnouncement(supabase, announcementId, title, body, expiresAt);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const deleteGroupAnnouncement = async (announcementId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete this announcement." };
    const result = await deleteMtuGroupAnnouncement(supabase, announcementId);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const createGroupPoll = async (conversationId: string, question: string, options: string[], closesAt: string | null, anonymousVoters: boolean) => {
    if (!supabase) return { data: null, error: "Sign in to create a poll." };
    const result = await createMtuGroupPoll(supabase, conversationId, question, options, closesAt, anonymousVoters);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadGroupPolls = async (conversationId: string) => {
    if (!supabase) return { data: [], error: "Sign in to view polls." };
    const result = await listMtuGroupPolls(supabase, conversationId);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const updateGroupPoll = async (pollId: string, question: string, options: string[], closesAt: string | null, anonymousVoters: boolean) => {
    if (!supabase) return { ok: false, error: "Sign in to edit this poll." };
    const result = await updateMtuGroupPoll(supabase, pollId, question, options, closesAt, anonymousVoters);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const closeGroupPoll = async (pollId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to close this poll." };
    const result = await closeMtuGroupPoll(supabase, pollId);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const deleteGroupPoll = async (pollId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete this poll." };
    const result = await deleteMtuGroupPoll(supabase, pollId);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const voteOnGroupPoll = async (pollId: string, optionId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to vote." };
    const result = await castMtuGroupPollVote(supabase, pollId, optionId);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const createGroupTask = async (conversationId: string, title: string, assigneeId: string | null, dueAt: string | null) => {
    if (!supabase) return { data: null, error: "Sign in to create a task." };
    const result = await createMtuGroupTask(supabase, conversationId, title, assigneeId, dueAt);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadGroupTasks = async (conversationId: string) => {
    if (!supabase) return { data: [], error: "Sign in to view group tasks." };
    const result = await listMtuGroupTasks(supabase, conversationId);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const updateGroupTask = async (taskId: string, title: string, assigneeId: string | null, dueAt: string | null) => {
    if (!supabase) return { ok: false, error: "Sign in to edit this task." };
    const result = await updateMtuGroupTask(supabase, taskId, title, assigneeId, dueAt);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const deleteGroupTask = async (taskId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete this task." };
    const result = await deleteMtuGroupTask(supabase, taskId);
    return result.error ? { ok: false, error: result.error.message } : { ok: Boolean(result.data) };
  };
  const setGroupTaskCompleted = async (taskId: string, completed: boolean) => {
    if (!supabase) return { ok: false, error: "Sign in to update a task." };
    const result = await setMtuGroupTaskCompleted(supabase, taskId, completed);
    return result.error ? { ok: false, error: result.error.message } : { ok: result.data };
  };
  const rotateGroupInvite = async (conversationId: string) => {
    if (!supabase) return { data: null, error: "Sign in to rotate this invitation." };
    const result = await rotateMtuGroupInvite(supabase, conversationId);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const loadConnectionRequests = async () => {
    if (!supabase) return { data: [], error: null };
    const result = await listMtuConnectionRequests(supabase);
    return result.error
      ? { data: [], error: result.error }
      : { data: result.data, error: null };
  };
  const subscribeToConnectionRequests = (onRefresh: () => void) => {
    if (!supabase || typeof (supabase as any).channel !== "function") return () => undefined;
    const channel = supabase.channel("convo-connection-request-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests" }, () => onRefresh())
      .subscribe();
    return () => {
      const client = supabase;
      if (client && typeof client.removeChannel === "function") {
        void client.removeChannel(channel);
      }
    };
  };
  const subscribeToGroupActivity = (conversationId: string, onChange: () => void) => {
    if (!supabase) return () => undefined;
    return subscribeToMtuGroupActivity(supabase, conversationId, onChange);
  };
  const acceptConnectionRequest = async (requestId: string) => {
    if (!supabase)
      return { ok: false, error: "Sign in to accept a connection request." };
    const result = await acceptMtuConnectionRequest(supabase, requestId);
    return result.error
      ? { ok: false, error: result.error.message }
      : { ok: true };
  };
  const blockStudent = async (studentId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to block a student." };
    const result = await blockMtuStudent(supabase, studentId);
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  };
  const loadBlockedStudents = async () => {
    if (!supabase) return { data: [], error: "Sign in to view blocked students." };
    const result = await listMtuBlockedStudents(supabase);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const unblockStudent = async (studentId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to unblock a student." };
    const result = await unblockMtuStudent(supabase, studentId);
    return result.error || !result.data ? { ok: false, error: result.error?.message || "Please try again shortly." } : { ok: true };
  };
  const reportStudent = async (studentId: string, reason: string) => {
    if (!supabase) return { ok: false, error: "Sign in to report a student." };
    const result = await reportMtuStudent(supabase, studentId, reason);
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  };
  const touchLastSeen = async () => {
    if (!supabase) return { data: null, error: "Sign in to update activity." };
    const result = await touchMtuLastSeen(supabase);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const searchGroups = async (query: string, category = "all") => {
    if (!supabase) return { data: [], error: "Sign in to search groups." };
    const result = await searchMtuGroups(supabase, query, category);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const requestGroupJoin = async (conversationId: string) => {
    if (!supabase) return { data: null, error: "Sign in to request group access." };
    const result = await requestMtuGroupJoin(supabase, conversationId);
    return result.error ? { data: null, error: result.error.message } : { data: result.data, error: null };
  };
  const endGroup = async (conversationId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to end this group." };
    const result = await endMtuGroup(supabase, conversationId);
    return result.error || !result.data ? { ok: false, error: result.error?.message || "The group could not be ended." } : { ok: true };
  };
  const deleteGroupMessage = async (messageId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to moderate this group." };
    const result = await deleteMtuGroupMessage(supabase, messageId);
    return result.error || !result.data ? { ok: false, error: result.error?.message || "The message could not be removed." } : { ok: true };
  };
  const loadSharedFiles = async (conversationId: string) => {
    if (!supabase) return { data: [], error: "Sign in to view shared files." };
    const result = await listMtuSharedFiles(supabase, conversationId);
    return result.error ? { data: [], error: result.error.message } : { data: result.data, error: null };
  };
  const loadConversations = async () => {
    if (!supabase) return { data: [], error: null };
    const result = await listMtuConversations(supabase);
    return result.error
      ? { data: [], error: result.error }
      : { data: result.data, error: null };
  };
  const loadMessages = async (conversationId: string) => {
    if (!supabase) return { data: [], error: null };
    const result = await listMtuMessages(supabase, conversationId);
    if (result.error) return { data: [], error: result.error };
    const data = await Promise.all(result.data.map(async (message) => { if (!message.attachment_path) return message; const secured = await createMtuAttachmentSignedUrl(supabase!, message.attachment_path); return secured.url ? { ...message, attachment_url: secured.url } : message; }));
    return { data, error: null };
  };
  const markConversationRead = async (conversationId: string) => {
    if (!supabase) return { error: null };
    const result = await markMtuConversationRead(supabase, conversationId);
    return { error: result.error ? { message: result.error.message } : null };
  };
  const subscribeToPublicProfiles = (onProfile: (profile: Record<string, unknown>) => void) => {
    if (!supabase) return () => undefined;
    return subscribeToMtuPublicProfiles(supabase, onProfile);
  };
  const subscribeToAllMessages = (
    onMessage: (message: Record<string, unknown>) => void
  ) => {
    if (!supabase) return () => undefined;
    return subscribeToMtuAllMessages(supabase, onMessage);
  };
  const subscribeToMessages = (
    conversationId: string,
    onMessage: (message: Record<string, unknown>) => void
  ) => {
    if (!supabase) return () => undefined;
    return subscribeToMtuMessages(supabase, conversationId, onMessage);
  };
  const subscribeToConversation = (
    conversationId: string,
    handlers: {
      onMessage: (message: Record<string, unknown>) => void;
      onTyping: (userId: string, isTyping: boolean) => void;
      onReadReceipt: (messageId: string, readAt: string) => void;
      onPresence?: (userIds: string[]) => void;
    },
    currentUserId?: string
  ) => {
    if (!supabase)
      return { sendTyping: async () => undefined, cleanup: () => undefined };
    return subscribeToMtuConversation(supabase, conversationId, currentUserId || "", handlers);
  };

  const logout = async () => {
    if (dashboardExiting) return;
    setDashboardExiting(true);
    const result = supabase ? await supabase.auth.signOut() : { error: null };
    if (result.error) {
      setDashboardExiting(false);
      toast.error("We couldn’t sign you out", {
        description: "Please try again in a moment.",
      });
      return;
    }
    await new Promise<void>(resolve => window.setTimeout(resolve, 280));
    setShowDashboard(false);
    setShowModal(false);
    setDashboardExiting(false);
    setAuthMode("login");
    setAuthStep("password");
    toast.success("You’re safely signed out", {
      description: "Your Convo session has been closed.",
      duration: 4200,
      className: "convo-success-toast",
    });
  };

  const askAssistant = async (
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    attachments: Array<{ name: string; mimeType: string; data: string }> = [],
    sharedFiles: Array<{ name: string; mimeType: string }> = [],
  ) => {
    if (!supabase) throw new Error("Sign in to use the study assistant.");
    return await askGemini(supabase, messages, attachments, sharedFiles, {
      name: displayName || "Ajewole Timothy Ayomide Moyin",
      email: authenticatedEmail,
      age: 17,
      birthday: "21 April 2009",
      year: "300 level",
      programme: programme || major || "Computer Science",
      goal: "achieving a first-class GPA",
    });
  };

  if (showDashboard)
    return (
      <>
        <ConvoDashboard
          currentUserId={currentUserId}
          displayName={nickname || displayName}
          major={major}
          avatarUrl={avatarPreview}
          studentId={studentId}
          level={level}
          department={department}
          programme={programme}
          bio={bio}
          profileVisibility={profileVisibility}
          groups={groups}
          posts={posts}
          joinedGroupIds={joinedGroupIds}
          onJoinGroup={mode === "live" ? joinGroup : undefined}
          onSearchStudents={supabase ? searchStudents : undefined}
          onSendConnectionRequest={supabase ? sendConnectionRequest : undefined}
          onCancelConnectionRequest={
            supabase ? cancelConnectionRequest : undefined
          }
          onStartDirectConversation={
            supabase ? startDirectConversation : undefined
          }
          onCreateGroupConversation={
            supabase ? createGroupConversation : undefined
          }
          onUpdateGroupImage={supabase ? updateGroupImage : undefined}
          onLoadGroupMembers={supabase ? loadGroupMembers : undefined}
          onAddGroupMembers={supabase ? addGroupMembers : undefined}
          onSetGroupMemberRole={supabase ? updateGroupMemberRole : undefined}
          onRemoveGroupMember={supabase ? removeGroupMember : undefined}
          onCreateGroupInvite={supabase ? createGroupInvite : undefined}
          onRotateGroupInvite={supabase ? rotateGroupInvite : undefined}
          onLoadGroupPermissions={supabase ? loadGroupPermissions : undefined}
          onSetGroupPermissions={supabase ? updateGroupPermissions : undefined}
          onJoinGroupInvite={supabase ? joinGroupInvite : undefined}
          onLoadGroupJoinRequests={supabase ? loadGroupJoinRequests : undefined}
          onReviewGroupJoinRequest={supabase ? reviewGroupJoinRequest : undefined}
          onSendMessage={supabase ? sendMessage : undefined}
          onEditMessage={supabase ? editMessage : undefined}
          onDeleteMessage={supabase ? deleteMessage : undefined}
          onLoadMessageInteractions={supabase ? loadMessageInteractions : undefined}
          onToggleMessageReaction={supabase ? toggleMessageReaction : undefined}
          onToggleSavedMessage={supabase ? toggleSavedMessage : undefined}
          onTogglePinnedMessage={supabase ? togglePinnedMessage : undefined}
          onSetConversationPreference={supabase ? setConversationPreference : undefined}
          onSetConversationRailState={supabase ? setConversationRailState : undefined}
          onLoadPrivacySettings={supabase ? loadPrivacySettings : undefined}
          onSetPrivacySettings={supabase ? updatePrivacySettings : undefined}
          notificationsEnabled={notificationsEnabled}
          onSetNotificationsEnabled={(enabled) => { setNotificationsEnabled(enabled); window.localStorage.setItem("convo-notifications-enabled", String(enabled)); }}
          onLoadConversationNotificationPreference={supabase ? loadConversationNotificationPreference : undefined}
          onSetConversationNotificationPreference={supabase ? updateConversationNotificationPreference : undefined}
          onLoadConversationAppearance={supabase ? loadConversationAppearance : undefined}
          onSetConversationAppearance={supabase ? updateConversationAppearance : undefined}
          onLoadSavedMessages={supabase ? loadSavedMessages : undefined}
          onSearchConversationMessages={supabase ? searchConversationMessages : undefined}
          onCreateGroupPoll={supabase ? createGroupPoll : undefined}
          onUpdateGroupPoll={supabase ? updateGroupPoll : undefined}
          onCloseGroupPoll={supabase ? closeGroupPoll : undefined}
          onDeleteGroupPoll={supabase ? deleteGroupPoll : undefined}
          onLoadGroupPolls={supabase ? loadGroupPolls : undefined}
          onCreateGroupEvent={supabase ? createGroupEvent : undefined}
          onUpdateGroupEvent={supabase ? updateGroupEvent : undefined}
          onDeleteGroupEvent={supabase ? deleteGroupEvent : undefined}
          onLoadGroupEvents={supabase ? loadGroupEvents : undefined}
          onSetGroupEventResponse={supabase ? setGroupEventResponse : undefined}
          onCancelGroupEvent={supabase ? cancelGroupEvent : undefined}
          onCreateGroupNote={supabase ? createGroupNote : undefined}
          onUpdateGroupNote={supabase ? updateGroupNote : undefined}
          onLoadGroupNotes={supabase ? loadGroupNotes : undefined}
          onCreateGroupAnnouncement={supabase ? createGroupAnnouncement : undefined}
          onUpdateGroupAnnouncement={supabase ? updateGroupAnnouncement : undefined}
          onDeleteGroupAnnouncement={supabase ? deleteGroupAnnouncement : undefined}
          onLoadGroupAnnouncements={supabase ? loadGroupAnnouncements : undefined}
          onVoteOnGroupPoll={supabase ? voteOnGroupPoll : undefined}
          onCreateGroupTask={supabase ? createGroupTask : undefined}
          onUpdateGroupTask={supabase ? updateGroupTask : undefined}
          onDeleteGroupTask={supabase ? deleteGroupTask : undefined}
          onLoadGroupTasks={supabase ? loadGroupTasks : undefined}
          onSetGroupTaskCompleted={supabase ? setGroupTaskCompleted : undefined}
          onSubscribeToGroupActivity={supabase ? subscribeToGroupActivity : undefined}
          onLoadConnectionRequests={
            supabase ? loadConnectionRequests : undefined
          }
          onSubscribeToConnectionRequests={
            supabase ? subscribeToConnectionRequests : undefined
          }
          onAcceptConnectionRequest={
            supabase ? acceptConnectionRequest : undefined
          }
          onBlockStudent={supabase ? blockStudent : undefined}
          onLoadBlockedStudents={supabase ? loadBlockedStudents : undefined}
          onUnblockStudent={supabase ? unblockStudent : undefined}
          onReportStudent={supabase ? reportStudent : undefined}
          onTouchLastSeen={supabase ? touchLastSeen : undefined}
          onSearchGroups={supabase ? searchGroups : undefined}
          onRequestGroupJoin={supabase ? requestGroupJoin : undefined}
          onEndGroup={supabase ? endGroup : undefined}
          onSetGroupPrivate={supabase ? setGroupPrivate : undefined}
          onDeleteGroupMessage={supabase ? deleteGroupMessage : undefined}
          onLoadSharedFiles={supabase ? loadSharedFiles : undefined}
          onLoadConversations={supabase ? loadConversations : undefined}
          onLoadMessages={supabase ? loadMessages : undefined}
          onMarkConversationRead={supabase ? markConversationRead : undefined}
          onSubscribeToPublicProfiles={supabase ? subscribeToPublicProfiles : undefined}
          onSubscribeToAllMessages={
            supabase ? subscribeToAllMessages : undefined
          }
          onSubscribeToMessages={supabase ? subscribeToMessages : undefined}
          onSubscribeToConversation={
            supabase ? subscribeToConversation : undefined
          }
          onExit={() => setShowDashboard(false)}
          onLogout={logout}
          onUpdateProfile={updateProfile}
          onUpdateAvatar={updateAvatar}
          onUpdatePrivacy={updatePrivacy}
          onAskAssistant={supabase ? askAssistant : undefined}
          vaultClient={supabase}
          isEntering={dashboardRevealed}
          isExiting={dashboardExiting}
        />
        <CallOverlay supabase={supabase} userId={currentUserId} displayName={nickname || displayName} />
        {showCelebration && (
          <ConvoSuccessCelebration
            nickname={nickname || displayName}
            onDone={() => {
              setShowCelebration(false);
              setDashboardRevealed(true);
            }}
          />
        )}
      </>
    );

  return (
    <div className="mtu-page">
      <div className="reading-progress">
        <span style={{ transform: `scaleX(${scrollProgress})` }} />
      </div>
      <header className="site-nav">
        <button
          className="brand"
          onClick={() => goTo("home")}
          aria-label="Convo home"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            <b>Convo</b>
            <small>MTU COMMUNITY</small>
          </span>
        </button>
        <div className="nav-actions">
          <button className="text-button" onClick={() => openAuth("login")}>
            Log in
          </button>
          <button
            className="primary-button small"
            onClick={() => openAuth("signup")}
          >
            Join Convo <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <main>
        <section
          id="home"
          className="hero-scene"
          onPointerMove={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHeroTilt({
              x: ((event.clientX - rect.left) / rect.width - 0.5) * 8,
              y: ((event.clientY - rect.top) / rect.height - 0.5) * -6,
            });
          }}
          onPointerLeave={() => setHeroTilt({ x: 0, y: 0 })}
        >
          <div
            className="hero-image"
            style={{
              backgroundImage: `linear-gradient(90deg, rgba(49,31,37,.92) 0%, rgba(49,31,37,.72) 35%, rgba(49,31,37,.10) 76%), url(${heroAsset})`,
              transform: `scale(1.04) translate3d(${heroTilt.x * -0.35}px, ${heroTilt.y * -0.35}px, 0)`,
            }}
          />
          <div className="hero-wash" />
          <div
            className="hero-orbit orbit-one"
            style={{
              transform: `translate3d(${heroTilt.x * 1.2}px, ${heroTilt.y * 1.2}px, 0) rotate(-12deg)`,
            }}
          />
          <div
            className="hero-orbit orbit-two"
            style={{
              transform: `translate3d(${heroTilt.x * -0.7}px, ${heroTilt.y * -0.7}px, 0) rotate(25deg)`,
            }}
          />
          <span
            className="hero-node node-a"
            style={{
              transform: `translate(${heroTilt.x * 0.8}px, ${heroTilt.y * 0.8}px)`,
            }}
          />
          <span
            className="hero-node node-b"
            style={{
              transform: `translate(${heroTilt.x * -0.55}px, ${heroTilt.y * -0.55}px)`,
            }}
          />
          <span
            className="hero-node node-c"
            style={{
              transform: `translate(${heroTilt.x * 0.45}px, ${heroTilt.y * 0.45}px)`,
            }}
          />
          <div className="hero-copy reveal-up">
            <p className="eyebrow">
              <span className="eyebrow-dot" /> A digital commons for MTU
            </p>
            <h1>
              Your campus,
              <br />
              <em>in motion.</em>
            </h1>
            <p className="hero-lede">
              Convo brings MTU students into the same thoughtful space for
              feeds, circles, stories, and the conversations between the big
              moments.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={() => openAuth("signup")}
              >
                Enter Convo <ArrowRight size={17} />
              </button>
            </div>
            <div className="hero-note">
              <span className="presence-dot" /> Verified MTU community{" "}
              <span className="note-rule" /> Your people, in one place.
            </div>
          </div>
          <div className="hero-floating-note note-one">
            <span className="note-icon">
              <MessageCircle size={15} />
            </span>
            <span>
              <b>{posts[0]?.author_meta || "Your circles"}</b>
              <small>
                {posts.length
                  ? `${posts.length} live updates`
                  : "Waiting for your first update"}
              </small>
            </span>
          </div>
          <div className="hero-floating-note note-two">
            <span className="note-icon sage">
              <Users size={15} />
            </span>
            <span>
              <b>
                {groups.length
                  ? `${groups.length} live circles`
                  : "Your circles"}
              </b>
              <small>
                {groups.length
                  ? "from your MTU community"
                  : "Appear after you connect"}
              </small>
            </span>
          </div>
          <div className="hero-token" ref={tokenRef} aria-hidden="true">
            <div className="token-face front">
              <Compass size={22} />
              <span>CONVO</span>
            </div>
            <div className="token-face back">
              <Sparkles size={20} />
              <span>MEET</span>
            </div>
          </div>
          <div className="scroll-cue">
            <span>Live campus updates</span>
            <ChevronDown size={18} />
          </div>
        </section>
      </main>

      {(showModal || resetSuccess) && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className={`join-modal auth-mode-${authMode} auth-step-${authStep}`}
            onClick={event => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setShowModal(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <span className="modal-kicker">Convo for MTU</span>
            <h3>
              {otpSuccess ? (
                <>
                  Email
                  <br />
                  <em>verified.</em>
                </>
              ) : authMode === "login" ? (
                <>
                  Welcome
                  <br />
                  <em>back.</em>
                </>
              ) : authMode === "reset" && authStep === "email" ? (
                <>
                  Reset your
                  <br />
                  <em>password.</em>
                </>
              ) : authMode === "reset" && authStep === "code" ? (
                <>
                  Enter your
                  <br />
                  <em>reset code.</em>
                </>
              ) : authMode === "reset" && authStep === "password" ? (
                <>
                  Choose a new
                  <br />
                  <em>password.</em>
                </>
              ) : authStep === "email" ? (
                <>
                  Enter the
                  <br />
                  <em>commons.</em>
                </>
              ) : authStep === "code" ? (
                <>
                  Check your
                  <br />
                  <em>inbox.</em>
                </>
              ) : authStep === "profile" ? (
                <>
                  Make it
                  <br />
                  <em>yours.</em>
                </>
              ) : (
                <>
                  Set your
                  <br />
                  <em>password.</em>
                </>
              )}
            </h3>
            <p>
              {otpSuccess
                ? "You’re in. Let’s shape your Convo profile."
                : authMode === "login"
                  ? "Use your verified MTU email and Convo password."
                  : authMode === "reset" && authStep === "email"
                    ? "Enter your MTU email and we’ll send a secure reset code."
                    : authMode === "reset" && authStep === "code"
                      ? `We sent a six-digit reset code to ${email}.`
                      : authMode === "reset" && authStep === "password"
                        ? "Choose a new password with at least 8 characters."
                        : authStep === "email"
                          ? isUsingApprovedTestEmail
                            ? "Testing is enabled for this approved account. We’ll send its one-time verification code."
                            : "Start with your official MTU email. We’ll send a one-time verification code."
                          : authStep === "code"
                            ? `We sent a six-digit code to ${email}.`
                            : profileNeedsPassword
                              ? "Your email is verified. Your password will be saved with this profile."
                              : "Complete your student profile to enter Convo. Your existing password stays unchanged."}
            </p>
            {resetSuccess ? (
              <div className="reset-success-state" aria-live="polite">
                <span className="reset-success-orbit">
                  <span>✓</span>
                </span>
                <strong>Password updated</strong>
                <p>
                  You’re all set. Returning you to login in{" "}
                  <b>{resetRedirectCountdown}</b>…
                </p>
                <span className="redirect-track">
                  <i
                    style={{
                      transform: `scaleX(${resetRedirectCountdown / 5})`,
                    }}
                  />
                </span>
                <button
                  className="switch-auth"
                  onClick={() => {
                    setResetSuccess(false);
                    setShowModal(true);
                    setAuthMode("login");
                    setAuthStep("password");
                  }}
                >
                  Log in now
                </button>
              </div>
            ) : otpSuccess ? (
              <div className="otp-success-mark" aria-label="Email verified">
                <span>✓</span>
                <small>MTU email confirmed</small>
              </div>
            ) : authMode === "login" ? (
              <>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="you@mtu.edu.ng"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                />
                <input
                  className="auth-input"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
                <label className="remember-me">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={event => setRememberMe(event.target.checked)}
                  />
                  <span className="remember-check" aria-hidden="true">
                    ✓
                  </span>
                  <span>Remember this email</span>
                </label>
                <button
                  className="primary-button full"
                  disabled={authBusy}
                  onClick={() => void login()}
                >
                  {authBusy ? "Signing in…" : "Log in to Convo"}{" "}
                  <ArrowRight size={17} />
                </button>
                <button className="switch-auth" onClick={openReset}>
                  Forgot password?
                </button>
                <button
                  className="switch-auth"
                  onClick={() => {
                    setAuthMode("signup");
                    setAuthStep("email");
                    setAuthError("");
                  }}
                >
                  Need an account? Sign up
                </button>
              </>
            ) : authMode === "reset" && authStep === "email" ? (
              <div className="reset-code-stage">
                <input
                  className="auth-input"
                  type="email"
                  placeholder="you@mtu.edu.ng"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                />
                <button
                  className="primary-button full"
                  disabled={authBusy}
                  onClick={() => void requestReset()}
                >
                  {authBusy ? "Sending reset code…" : "Send reset code"}{" "}
                  <ArrowRight size={17} />
                </button>
                <button
                  className="switch-auth"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthStep("password");
                  }}
                >
                  Back to log in
                </button>
              </div>
            ) : authMode === "reset" && authStep === "code" ? (
              <div className="reset-code-stage">
                <input
                  className="auth-input code-input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit reset code"
                  value={code}
                  onChange={event =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <button
                  className="primary-button full"
                  disabled={authBusy}
                  onClick={() => void verifyResetCode()}
                >
                  {authBusy ? "Checking code…" : "Verify reset code"}{" "}
                  <ArrowRight size={17} />
                </button>
                <div className="resend-code-status" aria-live="polite">
                  <span>
                    {resendCooldown
                      ? `Resend available in ${resendCooldown}s`
                      : "Didn’t get a code?"}
                  </span>
                  <span className="resend-track">
                    <i
                      style={{ transform: `scaleX(${resendCooldown / 30})` }}
                    />
                  </span>
                  <button
                    className="switch-auth resend-button"
                    disabled={Boolean(resendCooldown) || authBusy}
                    onClick={resendCode}
                  >
                    {resendCooldown ? "Wait to resend" : "Resend code"}
                  </button>
                </div>
              </div>
            ) : authMode === "reset" && authStep === "password" ? (
              <div className="reset-code-stage">
                <div className="password-field">
                  <input
                    className="auth-input"
                    type={showResetPassword ? "text" : "password"}
                    placeholder="New password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={
                      showResetPassword
                        ? "Hide new password"
                        : "Show new password"
                    }
                    onClick={() => setShowResetPassword(visible => !visible)}
                  >
                    {showResetPassword ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </div>
                {password && (
                  <div
                    className={`password-strength ${resetStrength.tone}`}
                    aria-live="polite"
                  >
                    <div className="strength-heading">
                      <span>Password strength</span>
                      <b>{resetStrength.label}</b>
                    </div>
                    <div className="strength-bars">
                      {[0, 1, 2, 3, 4].map(bar => (
                        <i
                          key={bar}
                          className={
                            bar < resetStrength.score ? "is-filled" : ""
                          }
                        />
                      ))}
                    </div>
                    <small>
                      Use 8+ characters with upper/lowercase letters, a number,
                      and a symbol.
                    </small>
                  </div>
                )}
                <div className="password-field">
                  <input
                    className="auth-input"
                    type={showResetConfirm ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={passwordConfirm}
                    onChange={event => setPasswordConfirm(event.target.value)}
                    aria-invalid={Boolean(
                      passwordConfirm && password !== passwordConfirm
                    )}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={
                      showResetConfirm
                        ? "Hide password confirmation"
                        : "Show password confirmation"
                    }
                    onClick={() => setShowResetConfirm(visible => !visible)}
                  >
                    {showResetConfirm ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </div>
                {passwordConfirm && (
                  <p
                    className={`password-match ${password === passwordConfirm ? "is-match" : ""}`}
                  >
                    {password === passwordConfirm
                      ? "Passwords match"
                      : "Passwords still need to match"}
                  </p>
                )}
                {passwordSafety !== "idle" && (
                  <p
                    className={`password-safety ${passwordSafety}`}
                    aria-live="polite"
                  >
                    {passwordSafety === "checking"
                      ? "Checking this password privately…"
                      : passwordSafety === "safe"
                        ? "No known breach match found"
                        : passwordSafetyMessage(passwordSafety)}
                  </p>
                )}
                <button
                  className="primary-button full"
                  disabled={
                    authBusy ||
                    passwordSafety === "breached" ||
                    passwordSafety === "common" ||
                    passwordSafety === "checking"
                  }
                  onClick={() => void finishReset()}
                >
                  {authBusy ? "Updating password…" : "Save new password"}{" "}
                  <ArrowRight size={17} />
                </button>
              </div>
            ) : authStep === "email" ? (
              <>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="you@mtu.edu.ng"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                />
                <button
                  className="primary-button full"
                  disabled={authBusy}
                  onClick={() => void sendOtp()}
                >
                  {authBusy ? "Sending code…" : "Send verification code"}{" "}
                  <ArrowRight size={17} />
                </button>
                <button
                  className="switch-auth"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthStep("password");
                  }}
                >
                  Already registered? Log in
                </button>
              </>
            ) : authStep === "code" ? (
              <>
                <input
                  className="auth-input code-input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={code}
                  onChange={event =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <button
                  className="primary-button full"
                  disabled={authBusy}
                  onClick={() => void verifyCode()}
                >
                  {authBusy ? "Verifying…" : "Verify MTU email"}{" "}
                  <ArrowRight size={17} />
                </button>
                <div className="resend-code-status" aria-live="polite">
                  <span>
                    {resendCooldown
                      ? `Resend available in ${resendCooldown}s`
                      : "Didn’t get a code?"}
                  </span>
                  <span className="resend-track">
                    <i
                      style={{ transform: `scaleX(${resendCooldown / 30})` }}
                    />
                  </span>
                  <button
                    className="switch-auth resend-button"
                    disabled={Boolean(resendCooldown) || authBusy}
                    onClick={resendCode}
                  >
                    {resendCooldown ? "Wait to resend" : "Resend code"}
                  </button>
                </div>
              </>
            ) : authStep === "password" ? (
              <>
                <input
                  className="auth-input"
                  type="password"
                  placeholder="Create password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
                <button
                  className="primary-button full"
                  disabled={authBusy}
                  onClick={continueToProfile}
                >
                  {authBusy ? "Preparing profile…" : "Continue to profile"}{" "}
                  <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <>
                <div className="profile-step-layout">
                  <div className="profile-step-form">
                    {cropFile ? (
                      <AvatarCropper
                        file={cropFile}
                        onCancel={() => setCropFile(null)}
                        onComplete={file => {
                          setAvatarFile(file);
                          setAvatarPreview(
                            typeof URL.createObjectURL === "function"
                              ? URL.createObjectURL(file)
                              : ""
                          );
                          setCropFile(null);
                        }}
                      />
                    ) : (
                      <label className="avatar-picker">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={event => {
                            const file = event.target.files?.[0] || null;
                            if (file) setCropFile(file);
                          }}
                        />
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Avatar preview" />
                        ) : (
                          <span>
                            +<small>Add avatar</small>
                          </span>
                        )}
                      </label>
                    )}
                    <div className="profile-field-grid">
                      <input
                        className="auth-input"
                        type="text"
                        placeholder="Full name (private)"
                        value={displayName}
                        onChange={event => setDisplayName(event.target.value)}
                      />
                      <input
                        className="auth-input"
                        type="text"
                        placeholder="Nickname (public)"
                        value={nickname}
                        onChange={event => setNickname(event.target.value)}
                      />
                    </div>
                    <select
                      className="auth-input auth-select"
                      aria-label="College"
                      value={college}
                      onChange={event => {
                        const nextCollege = event.target.value;
                        setCollege(nextCollege);
                        setDepartment(nextCollege);
                        if (!programmesForCollege(nextCollege).includes(programme as never)) {
                          setProgramme("");
                          setMajor("");
                        }
                      }}
                    >
                      <option value="">Choose your college</option>
                      {MTU_COLLEGE_OPTIONS.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      className="auth-input auth-select"
                      aria-label="Programme"
                      value={programme}
                      disabled={!college}
                      onChange={event => {
                        setProgramme(event.target.value);
                        setMajor(event.target.value);
                      }}
                    >
                      <option value="">{college ? "Choose your programme" : "Choose your college first"}</option>
                      {programmesForCollege(college).map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      className="auth-input auth-select"
                      aria-label="Level"
                      value={level}
                      onChange={event => setLevel(event.target.value)}
                    >
                      <option value="">Choose your level</option>
                      {MTU_LEVEL_OPTIONS.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="auth-input profile-bio-input"
                      placeholder="A short note about you (optional)"
                      value={bio}
                      onChange={event => setBio(event.target.value)}
                      rows={3}
                    />
                    <p className="profile-privacy-note">
                      Your nickname is the only identity shown to other
                      students. Your full name stays private.
                    </p>
                    <label className="remember-me">
                      <input type="checkbox" checked={signupNotificationsChoice} onChange={event => setSignupNotificationsChoice(event.target.checked)} />
                      <span className="remember-check" aria-hidden="true">✓</span>
                      <span>Notify me about new messages and calls</span>
                    </label>
                    <button
                      type="button"
                      className="skip-profile-button"
                      onClick={() => {
                        setBio("");
                        void finishSignup();
                      }}
                    >
                      Skip for now
                    </button>
                    <button
                      type="button"
                      className="primary-button full"
                      disabled={authBusy || Boolean(cropFile)}
                      onClick={() => void finishSignup()}
                    >
                      {authBusy ? "Saving profile…" : "Complete Profile"}{" "}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <aside
                    className="profile-preview-dock"
                    aria-label="Live public profile preview"
                  >
                    <ConvoProfilePreview
                      nickname={nickname}
                      college={college}
                      programme={programme}
                      level={level}
                      avatarUrl={avatarPreview}
                    />
                  </aside>
                </div>
              </>
            )}
            {authError && <p className="auth-error">{authError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
