import { describe, expect, it } from "vitest";
import { getCampusPanelState, joinCampusGroup } from "./campus-data";
import { CONVO_ONBOARDING_SEQUENCE, saveMtuProfile, createMtuGroupConversation, createMtuGroupInvite, createMtuGroupPoll, createMtuGroupTask, deleteMtuMessage, editMtuMessage, getMtuConversationNotificationPreference, getMtuPrivacySettings, getMtuGroupPermissions, getProfileMetadata, joinMtuGroupInvite, listMtuGroupPolls, listMtuGroupTasks, listMtuSavedMessages, markMtuConversationRead, rotateMtuGroupInvite, searchMtuConversationMessages, sendMtuMessage, setMtuConversationNotificationPreference, setMtuConversationRailState, setMtuPrivacySettings, setMtuGroupPermissions, setMtuGroupTaskCompleted, createMtuGroupEvent, listMtuGroupEvents, setMtuGroupEventResponse, createMtuGroupNote, updateMtuGroupNote, listMtuGroupNotes, createMtuGroupAnnouncement, listMtuGroupAnnouncements, getMtuConversationAppearance, setMtuConversationAppearance, startMtuDirectConversation, subscribeToMtuAllMessages, subscribeToMtuConversation, subscribeToMtuMessages, syncMyMtuDirectoryProfile, uploadAvatar, uploadMessageImage, validateAvatarFile, validateMessageAttachment, validateMessageImage, castMtuGroupPollVote, revokeMtuGroupInvite } from "./supabase";
import { isMtuEmail } from "./supabase";
import { listMtuBlockedStudents, unblockMtuStudent } from "./supabase";

describe("Supabase auth persistence", () => {
  it("persists the session without storing a password", async () => {
    const { SUPABASE_AUTH_OPTIONS } = await import("./supabase");
    expect(SUPABASE_AUTH_OPTIONS).toMatchObject({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "convo-auth" });
    expect(SUPABASE_AUTH_OPTIONS).not.toHaveProperty("password");
  });
});

describe("isMtuEmail", () => {
  it("accepts official MTU addresses", () => {
    expect(isMtuEmail("student@mtu.edu.ng")).toBe(true);
    expect(isMtuEmail("STUDENT@MTU.EDU.NG")).toBe(true);
  });

  it("rejects lookalike domains and malformed addresses", () => {
    expect(isMtuEmail("student@mtu.edu.ng.example.com")).toBe(false);
    expect(isMtuEmail("student@gmail.com")).toBe(false);
    expect(isMtuEmail("student@mtu.edu")).toBe(false);
    expect(isMtuEmail("student mtu.edu.ng")).toBe(false);
  });
});

describe("avatar and profile helpers", () => {
  it("rejects unsupported or oversized avatars", () => {
    expect(validateAvatarFile({ type: "image/gif", size: 10 }).valid).toBe(false);
    expect(validateAvatarFile({ type: "image/png", size: 6 * 1024 * 1024 }).valid).toBe(false);
    expect(validateAvatarFile({ type: "image/webp", size: 1000 }).valid).toBe(true);
  });

  it("accepts the cropped JPEG output used by profile setup", async () => {
    const client = { storage: { from: () => ({ upload: async (_path: string, file: File) => ({ error: file.name === "convo-avatar.jpg" ? null : { message: "unexpected file" } }), getPublicUrl: () => ({ data: { publicUrl: "https://cdn.test/cropped.jpg" } }) }) } } as never;
    await expect(uploadAvatar(client, new File(["cropped"], "convo-avatar.jpg", { type: "image/jpeg" }), "cropped")).resolves.toMatchObject({ url: "https://cdn.test/cropped.jpg", error: "" });
  });

  it("validates and uploads message images", async () => {
    expect(validateMessageImage(new File(["x"], "note.txt", { type: "text/plain" })).valid).toBe(false);
    expect(validateMessageImage(new File([new Uint8Array(9 * 1024 * 1024)], "large.png", { type: "image/png" })).valid).toBe(false);
    const client = { storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://cdn.test/message.png" } }) }) } } as never;
    await expect(uploadMessageImage(client, new File(["image"], "study.png", { type: "image/png" }), "student-1")).resolves.toMatchObject({ url: "https://cdn.test/message.png", error: "" });
  });

  it("allows bounded supported video attachments and rejects unsupported or oversized video", () => {
    expect(validateMessageAttachment(new File(["video"], "clip.webm", { type: "video/webm" })).valid).toBe(true);
    expect(validateMessageAttachment({ type: "video/webm;codecs=vp9,opus", size: 1024 }).valid).toBe(true);
    expect(validateMessageAttachment(new File(["video"], "clip.avi", { type: "video/x-msvideo" })).valid).toBe(false);
    expect(validateMessageAttachment(new File([new Uint8Array(26 * 1024 * 1024)], "large.mp4", { type: "video/mp4" })).valid).toBe(false);
  });

  it("accepts bounded voice messages and rejects unsupported or oversized audio", () => {
    expect(validateMessageAttachment(new File(["voice"], "note.webm", { type: "audio/webm" })).valid).toBe(true);
    expect(validateMessageAttachment({ type: "audio/webm;codecs=opus", size: 1024 }).valid).toBe(true);
    expect(validateMessageAttachment(new File(["voice"], "note.m4a", { type: "audio/mp4" })).valid).toBe(true);
    expect(validateMessageAttachment(new File([new Uint8Array(11 * 1024 * 1024)], "large.webm", { type: "audio/webm" })).valid).toBe(false);
    expect(validateMessageAttachment(new File(["voice"], "note.wav", { type: "audio/wav" })).valid).toBe(false);
  });

  it("covers avatar upload success and failure", async () => {
    const calls: string[] = [];
    const successClient = { storage: { from: () => ({ upload: async (path: string) => { calls.push(path); return { error: null }; }, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }) } } as never;
    const success = await uploadAvatar(successClient, new File(["avatar"], "me.png", { type: "image/png" }), "fixed");
    expect(success.url).toMatch(/^https:\/\/cdn\.test\/avatars\/fixed\/[0-9a-f-]+-me\.png$/);
    expect(calls[0]).toMatch(/^avatars\/fixed\/[0-9a-f-]+-me\.png$/);

    const failureClient = { storage: { from: () => ({ upload: async () => ({ error: { message: "bucket missing" } }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } } as never;
    await expect(uploadAvatar(failureClient, new File(["avatar"], "me.png", { type: "image/png" }), "fixed")).resolves.toEqual({ url: "", error: "bucket missing" });
  });

  it("upserts the public MTU profile and surfaces persistence errors", async () => {
    const calls: unknown[] = [];
    const client = { from: (table: string) => ({ upsert: async (row: unknown, options: unknown) => { calls.push([table, row, options]); return { error: null }; } }) } as never;
    await expect(saveMtuProfile(client, { id: "student-1", display_name: "Private Name", nickname: "Moyin", college: "College of Basic and Applied Sciences", programme: "Computer Science", level: "300 Level", student_id: "MTU-ABC12345", bio: "Hello" })).resolves.toEqual({ error: null });
    expect(calls[0]).toEqual(["profiles", { id: "student-1", display_name: "Moyin", level: "300 Level", department: "College of Basic and Applied Sciences", programme: "Computer Science", avatar_url: null, student_id: "MTU-ABC12345", bio: "Hello" }, { onConflict: "id" }]);
    const failedClient = { from: () => ({ upsert: async () => ({ error: { message: "profiles table unavailable" } }) }) } as never;
    await expect(saveMtuProfile(failedClient, { id: "student-1", display_name: "Private Name", nickname: "Moyin", college: "College of Basic and Applied Sciences", programme: "Computer Science", level: "300 Level" })).resolves.toEqual({ error: { message: "profiles table unavailable" } });
  });

  it("synchronizes the signed-in profile through the directory recovery RPC", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: true, error: null }; } } as never;
    await expect(syncMyMtuDirectoryProfile(client)).resolves.toEqual({ data: true, error: null });
    expect(calls).toEqual([["sync_my_mtu_profile", undefined]]);
    const failedClient = { rpc: async () => ({ data: null, error: { message: "Directory recovery is not installed" } }) } as never;
    await expect(syncMyMtuDirectoryProfile(failedClient)).resolves.toEqual({ data: false, error: { message: "Directory recovery is not installed" } });
  });

  it("hydrates profile fields from Supabase user metadata", () => {
    expect(getProfileMetadata({ id: "12345678-aaaa-bbbb-cccc-ddddeeeeffff", email: "ada@mtu.edu.ng", user_metadata: { display_name: "Ada", nickname: "Ada", college: "College of Basic and Applied Sciences", major: "Computer Science", avatar_url: "https://cdn/avatar.png", level: "300L", department: "CBAS", student_id: "MTU-26-7K4Q2", bio: "Study, build, connect.", profile_visibility: { programme: false, college: true, level: false, bio: true } } })).toEqual({ displayName: "Ada", nickname: "Ada", college: "College of Basic and Applied Sciences", major: "Computer Science", avatarUrl: "https://cdn/avatar.png", studentId: "MTU-26-7K4Q2", level: "300L", department: "CBAS", programme: "Computer Science", bio: "Study, build, connect.", visibility: { programme: false, college: true, level: false, bio: true } });
    expect(getProfileMetadata({ id: "12345678-aaaa-bbbb-cccc-ddddeeeeffff", email: "ada@mtu.edu.ng", user_metadata: {} })).toMatchObject({ displayName: "", studentId: "", level: "", department: "", bio: "", visibility: { programme: true, college: true, level: true, bio: true } });
    expect(getProfileMetadata(null)).toEqual({ displayName: "", nickname: "", college: "", major: "", avatarUrl: "", studentId: "", level: "", department: "", programme: "", bio: "", visibility: { programme: true, college: true, level: true, bio: true } });
  });
});

describe("Convo onboarding sequence", () => {
  it("keeps the OTP-to-dashboard path explicit", () => {
    expect(CONVO_ONBOARDING_SEQUENCE).toEqual(["email", "code", "password", "profile", "dashboard"]);
  });
});

describe("persisted group membership", () => {
  it("writes the authenticated user and group ids", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: true, error: null }; } };
    await expect(joinCampusGroup(client, "user-1", "group-1")).resolves.toEqual({ ok: true, alreadyJoined: false });
    expect(calls).toEqual([["join_campus_group", { p_group_id: "group-1" }]]);
  });

  it("treats duplicate membership as an idempotent success and surfaces other errors", async () => {
    const duplicate = { rpc: async () => ({ data: false, error: null }) };
    await expect(joinCampusGroup(duplicate, "user-1", "group-1")).resolves.toEqual({ ok: true, alreadyJoined: true });
    const failed = { rpc: async () => ({ data: null, error: { code: "42501", message: "not allowed" } }) };
    await expect(joinCampusGroup(failed, "user-1", "group-1")).resolves.toEqual({ ok: false, error: "not allowed" });
  });
});

describe("live messaging helpers", () => {
  it("uses group invite and owner-permission RPC contracts without exposing raw storage queries", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: name === "create_mtu_group_invite" ? "invite-token" : name === "join_mtu_group_invite" ? { conversation_id: "group-1", group_title: "Study Circle", joined: true, pending: false } : { allow_member_messages: false, allow_member_invites: false, require_join_approval: true }, error: null }; } } as never;
    await expect(createMtuGroupInvite(client, "group-1")).resolves.toEqual({ data: "invite-token", error: null });
    await expect(getMtuGroupPermissions(client, "group-1")).resolves.toMatchObject({ data: { allow_member_messages: false } });
    await expect(setMtuGroupPermissions(client, "group-1", { allow_member_messages: false, allow_member_invites: false, require_join_approval: true })).resolves.toMatchObject({ data: { require_join_approval: true } });
    await expect(joinMtuGroupInvite(client, "invite-token")).resolves.toMatchObject({ data: { conversation_id: "group-1", joined: true } });
    expect(calls).toEqual([
      ["create_mtu_group_invite", { p_conversation_id: "group-1" }],
      ["get_mtu_group_permissions", { p_conversation_id: "group-1" }],
      ["set_mtu_group_permissions", { p_conversation_id: "group-1", p_allow_member_messages: false, p_allow_member_invites: false, p_require_join_approval: true }],
      ["join_mtu_group_invite", { p_token: "invite-token" }],
    ]);
  });

  it("uses typed server RPCs for polls, group tasks, saved-message retrieval, chat mute preferences, invite rotation, and scoped search", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: name === "rotate_mtu_group_invite" ? "fresh-invite" : name === "create_mtu_group_task" ? "task-1" : name === "create_mtu_group_poll" ? { poll_id: "poll-1", message_id: "message-1" } : name === "get_mtu_conversation_notification_preference" || name === "set_mtu_conversation_notification_preference" ? { muted_until: null, is_muted: false } : name.startsWith("list_") || name.startsWith("search_") ? [] : true, error: null }; } } as never;
    await expect(getMtuConversationNotificationPreference(client, "conversation-1")).resolves.toMatchObject({ data: { is_muted: false } });
    await expect(setMtuConversationNotificationPreference(client, "conversation-1", true, "2026-08-26T12:00:00.000Z")).resolves.toMatchObject({ data: { is_muted: false } });
    await expect(listMtuSavedMessages(client)).resolves.toEqual({ data: [], error: null });
    await expect(searchMtuConversationMessages(client, "conversation-1", "deadline")).resolves.toEqual({ data: [], error: null });
    await expect(createMtuGroupPoll(client, "group-1", "When should we meet?", ["Tuesday", "Thursday"], null, true)).resolves.toMatchObject({ data: { poll_id: "poll-1" } });
    await expect(listMtuGroupPolls(client, "group-1")).resolves.toEqual({ data: [], error: null });
    await expect(castMtuGroupPollVote(client, "poll-1", "option-1")).resolves.toMatchObject({ data: true });
    await expect(createMtuGroupTask(client, "group-1", "Prepare slides", "student-2", "2026-08-27T12:00:00.000Z")).resolves.toEqual({ data: "task-1", error: null });
    await expect(listMtuGroupTasks(client, "group-1")).resolves.toEqual({ data: [], error: null });
    await expect(setMtuGroupTaskCompleted(client, "task-1", true)).resolves.toMatchObject({ data: true });
    await expect(revokeMtuGroupInvite(client, "group-1", "invite-1")).resolves.toMatchObject({ data: true });
    await expect(rotateMtuGroupInvite(client, "group-1")).resolves.toEqual({ data: "fresh-invite", error: null });
    expect(calls).toEqual([
      ["get_mtu_conversation_notification_preference", { p_conversation_id: "conversation-1" }],
      ["set_mtu_conversation_notification_preference", { p_conversation_id: "conversation-1", p_muted: true, p_muted_until: "2026-08-26T12:00:00.000Z" }],
      ["list_mtu_saved_messages", { p_limit: 100 }],
      ["search_mtu_conversation_messages", { p_conversation_id: "conversation-1", p_query: "deadline" }],
      ["create_mtu_group_poll", { p_conversation_id: "group-1", p_question: "When should we meet?", p_options: ["Tuesday", "Thursday"], p_closes_at: null, p_anonymous_voters: true }],
      ["list_mtu_group_polls", { p_conversation_id: "group-1" }],
      ["cast_mtu_group_poll_vote", { p_poll_id: "poll-1", p_option_id: "option-1" }],
      ["create_mtu_group_task", { p_conversation_id: "group-1", p_title: "Prepare slides", p_assignee_id: "student-2", p_due_at: "2026-08-27T12:00:00.000Z" }],
      ["list_mtu_group_tasks", { p_conversation_id: "group-1" }],
      ["set_mtu_group_task_completed", { p_task_id: "task-1", p_completed: true }],
      ["revoke_mtu_group_invite", { p_conversation_id: "group-1", p_token: "invite-1" }],
      ["rotate_mtu_group_invite", { p_conversation_id: "group-1" }],
    ]);
  });

  it("uses the conversation appearance RPCs with the secure contract", async () => {
    const calls: unknown[] = [];
    const appearance = { chat_theme: "sage" as const, wallpaper_variant: "organic" as const };
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: appearance, error: null }; } } as never;
    await expect(getMtuConversationAppearance(client, "conversation-1")).resolves.toEqual({ data: appearance, error: null });
    await expect(setMtuConversationAppearance(client, "conversation-1", appearance)).resolves.toEqual({ data: appearance, error: null });
    expect(calls).toEqual([["get_mtu_conversation_appearance", { p_conversation_id: "conversation-1" }], ["set_mtu_conversation_appearance", { p_conversation_id: "conversation-1", p_chat_theme: "sage", p_wallpaper_variant: "organic" }]]);
  });

  it("persists group artwork through the owner-admin scoped RPC contract", async () => {
    const { setMtuGroupImage } = await import("./supabase");
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: "https://cdn.test/group.png", error: null }; } } as never;
    await expect(setMtuGroupImage(client, "group-1", "https://cdn.test/group.png", "student-1/group-1/image.png")).resolves.toEqual({ data: "https://cdn.test/group.png", error: null });
    expect(calls).toEqual([["set_mtu_group_image", { p_conversation_id: "group-1", p_image_url: "https://cdn.test/group.png", p_image_path: "student-1/group-1/image.png" }]]);
  });

  it("uses typed RPCs for group events, attendance, shared notes, and announcements", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: name.startsWith("list_") ? [] : name === "set_mtu_group_event_response" ? "going" : name === "update_mtu_group_note" ? true : "entity-1", error: null }; } } as never;
    await expect(createMtuGroupEvent(client, "group-1", "Study session", "Bring notes", "2026-08-28T12:00:00.000Z", "Library")).resolves.toEqual({ data: "entity-1", error: null });
    await expect(listMtuGroupEvents(client, "group-1")).resolves.toEqual({ data: [], error: null });
    await expect(setMtuGroupEventResponse(client, "event-1", "going")).resolves.toEqual({ data: "going", error: null });
    await expect(createMtuGroupNote(client, "group-1", "Reading list", "Chapter 4")).resolves.toEqual({ data: "entity-1", error: null });
    await expect(updateMtuGroupNote(client, "note-1", "Reading list", "Chapter 5")).resolves.toEqual({ data: true, error: null });
    await expect(listMtuGroupNotes(client, "group-1")).resolves.toEqual({ data: [], error: null });
    await expect(createMtuGroupAnnouncement(client, "group-1", "Reminder", "Submit by Friday", null)).resolves.toEqual({ data: "entity-1", error: null });
    await expect(listMtuGroupAnnouncements(client, "group-1")).resolves.toEqual({ data: [], error: null });
    expect(calls).toEqual([
      ["create_mtu_group_event", { p_conversation_id: "group-1", p_title: "Study session", p_description: "Bring notes", p_starts_at: "2026-08-28T12:00:00.000Z", p_location: "Library" }],
      ["list_mtu_group_events", { p_conversation_id: "group-1" }],
      ["set_mtu_group_event_response", { p_event_id: "event-1", p_response: "going" }],
      ["create_mtu_group_note", { p_conversation_id: "group-1", p_title: "Reading list", p_body: "Chapter 4" }],
      ["update_mtu_group_note", { p_note_id: "note-1", p_title: "Reading list", p_body: "Chapter 5" }],
      ["list_mtu_group_notes", { p_conversation_id: "group-1" }],
      ["create_mtu_group_announcement", { p_conversation_id: "group-1", p_title: "Reminder", p_body: "Submit by Friday", p_expires_at: null }],
      ["list_mtu_group_announcements", { p_conversation_id: "group-1" }],
    ]);
  });

  it("persists private conversation rail state through the typed RPC contract", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: { is_pinned: true, is_archived: false, draft_body: "See you after class" }, error: null }; } } as never;
    await expect(setMtuConversationRailState(client, "conversation-1", true, false, "See you after class")).resolves.toEqual({ data: { is_pinned: true, is_archived: false, draft_body: "See you after class" }, error: null });
    expect(calls).toEqual([["set_mtu_conversation_rail_state", { p_conversation_id: "conversation-1", p_pinned: true, p_archived: false, p_draft_body: "See you after class" }]]);
  });

  it("accepts bounded document attachments and rejects oversized files", () => {
    expect(validateMessageAttachment({ type: "application/pdf", size: 1024 })).toEqual({ valid: true, error: "" });
    expect(validateMessageAttachment({ type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1024 })).toEqual({ valid: true, error: "" });
    expect(validateMessageAttachment({ type: "application/pdf", size: 26 * 1024 * 1024 })).toEqual({ valid: false, error: "Files must be 25 MB or smaller." });
  });

  it("uses the privacy settings RPC without exposing private account fields", async () => {
    const calls: unknown[] = [];
    const settings = { allow_messages: "connections" as const, allow_calls: "nobody" as const, show_read_receipts: true, show_online_status: false, allow_group_invites: true, disappearing_messages_seconds: 604800 as const };
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: settings, error: null }; } } as never;
    await expect(getMtuPrivacySettings(client)).resolves.toEqual({ data: settings, error: null });
    await expect(setMtuPrivacySettings(client, settings)).resolves.toEqual({ data: settings, error: null });
    expect(calls).toEqual([["get_mtu_privacy_settings", undefined], ["set_mtu_privacy_settings", { p_allow_messages: "connections", p_allow_calls: "nobody", p_show_read_receipts: true, p_show_online_status: false, p_allow_group_invites: true, p_disappearing_messages_seconds: 604800 }]]);
  });

  it("calls attachment, edit, and delete RPCs with the secure contract", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: { id: "message-1" }, error: null }; } };
    await expect(sendMtuMessage(client, "conversation-1", "", "https://cdn.test/image.png", "student-1/image.png")).resolves.toMatchObject({ data: { id: "message-1" } });
    await expect(editMtuMessage(client, "message-1", "Updated")).resolves.toMatchObject({ data: { id: "message-1" } });
    await expect(deleteMtuMessage(client, "message-1")).resolves.toMatchObject({ data: { id: "message-1" } });
    expect(calls).toEqual([
      ["send_mtu_message", { p_conversation_id: "conversation-1", p_body: "", p_attachment_url: "https://cdn.test/image.png", p_attachment_path: "student-1/image.png", p_reply_to_id: null, p_attachment_mime: null }],
      ["edit_mtu_message", { p_message_id: "message-1", p_body: "Updated" }],
      ["delete_mtu_message", { p_message_id: "message-1" }],
    ]);
  });

  it("lists and unblocks only the signed-in student's blocked accounts through dedicated RPCs", async () => {
    const calls: unknown[] = [];
    const blocked = [{ blocked_id: "student-2", display_name: null, nickname: "Sam", student_id: "MTU-SAM-001", avatar_url: null, blocked_at: "2026-08-27T08:00:00.000Z" }];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: name === "list_mtu_blocked_students" ? blocked : true, error: null }; } } as never;
    await expect(listMtuBlockedStudents(client)).resolves.toEqual({ data: blocked, error: null });
    await expect(unblockMtuStudent(client, "student-2")).resolves.toEqual({ data: true, error: null });
    expect(calls).toEqual([["list_mtu_blocked_students", undefined], ["unblock_mtu_student", { p_student_id: "student-2" }]]);
  });

  it("calls the secure conversation and message RPCs", async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: name === "start_mtu_direct_conversation" || name === "create_mtu_group_conversation" ? "conversation-1" : { id: "message-1" }, error: null }; } };
    await expect(startMtuDirectConversation(client, "student-2")).resolves.toEqual({ data: "conversation-1", error: null });
    await expect(createMtuGroupConversation(client, "Study Circle", ["student-2"])).resolves.toEqual({ data: "conversation-1", error: null });
    await expect(sendMtuMessage(client, "conversation-1", "Hello")).resolves.toEqual({ data: { id: "message-1" }, error: null });
    await expect(markMtuConversationRead(client, "conversation-1")).resolves.toEqual({ data: { id: "message-1" }, error: null });
    expect(calls).toEqual([
      ["start_mtu_direct_conversation", { p_other_user_id: "student-2" }],
      ["create_mtu_group_conversation", { p_title: "Study Circle", p_category: "academic", p_member_ids: ["student-2"] }],
      ["send_mtu_message", { p_conversation_id: "conversation-1", p_body: "Hello", p_attachment_url: null, p_attachment_path: null, p_reply_to_id: null, p_attachment_mime: null }],
      ["mark_mtu_conversation_read", { p_conversation_id: "conversation-1" }],
    ]);
  });

  it("handles typing and read-receipt events on the conversation channel", async () => {
    const handlers: Record<string, (payload: Record<string, unknown>) => void> = {};
    const updates: unknown[] = [];
    const sent: unknown[] = [];
    const channel = { on: (event: string, filter: Record<string, unknown>, handler: (payload: Record<string, unknown>) => void) => { if (filter.table === "message_reads") expect(filter.filter).toBe("conversation_id=eq.conversation-1"); handlers[`${event}:${String(filter.table || filter.event)}:${String(filter.event || "")}`] = handler; return channel; }, subscribe: () => channel, send: async (payload: unknown) => { sent.push(payload); return "ok"; } };
    const client = { channel: () => channel, removeChannel: () => Promise.resolve("ok") };
    const typing: unknown[] = [];
    const receipts: unknown[] = [];
    const conversation = subscribeToMtuConversation(client, "conversation-1", { onMessage: (message) => updates.push(message), onTyping: (...value) => typing.push(value), onReadReceipt: (...value) => receipts.push(value) });
    handlers["broadcast:typing:typing"]?.({ payload: { user_id: "student-2", is_typing: true } });
    handlers["postgres_changes:message_reads:INSERT"]?.({ new: { message_id: "message-1", conversation_id: "conversation-1", read_at: "2026-08-23T12:00:00.000Z" } });
    handlers["postgres_changes:messages:UPDATE"]?.({ new: { id: "message-1", body: "Edited" } });
    await conversation.sendTyping("student-1", true);
    conversation.cleanup();
    expect(typing).toEqual([["student-2", true]]);
    expect(receipts).toEqual([["message-1", "2026-08-23T12:00:00.000Z"]]);
    expect(updates).toEqual([{ id: "message-1", body: "Edited" }]);
    expect(sent).toEqual([{ type: "broadcast", event: "typing", payload: { user_id: "student-1", is_typing: true } }]);
  });

  it("subscribes to all incoming message inserts and removes the channel on cleanup", () => {
    let callback: ((payload: unknown) => void) | undefined;
    const removed: unknown[] = [];
    const channel = { on: (_event: string, _filter: unknown, handler: (payload: unknown) => void) => { callback = handler; return channel; }, subscribe: () => channel };
    const client = { channel: () => channel, removeChannel: (value: unknown) => { removed.push(value); return Promise.resolve("ok"); } };
    const received: unknown[] = [];
    const cleanup = subscribeToMtuAllMessages(client, (message) => received.push(message));
    callback?.({ new: { id: "message-2", conversation_id: "conversation-1", sender_id: "student-2", body: "Hello" } });
    cleanup();
    expect(received).toEqual([{ id: "message-2", conversation_id: "conversation-1", sender_id: "student-2", body: "Hello" }]);
    expect(removed).toEqual([channel]);
  });

  it("subscribes to inserts and removes the channel on cleanup", () => {
    let callback: ((payload: unknown) => void) | undefined;
    const removed: unknown[] = [];
    const channel = { on: (_event: string, _filter: unknown, handler: (payload: unknown) => void) => { callback = handler; return channel; }, subscribe: () => channel };
    const client = { channel: () => channel, removeChannel: (value: unknown) => { removed.push(value); return Promise.resolve("ok"); } };
    const received: unknown[] = [];
    const cleanup = subscribeToMtuMessages(client, "conversation-1", (message) => received.push(message));
    callback?.({ new: { id: "message-1", body: "Hello" } });
    cleanup();
    expect(received).toEqual([{ id: "message-1", body: "Hello" }]);
    expect(removed).toEqual([channel]);
  });
});

describe("getCampusPanelState", () => {
  it("covers loading, error, empty, preview, and live states", () => {
    expect(getCampusPanelState({ isLoading: true, error: null, hasItems: false, isPreview: false })).toBe("loading");
    expect(getCampusPanelState({ isLoading: false, error: "tables unavailable", hasItems: false, isPreview: false })).toBe("error");
    expect(getCampusPanelState({ isLoading: false, error: null, hasItems: false, isPreview: false })).toBe("empty");
    expect(getCampusPanelState({ isLoading: false, error: null, hasItems: true, isPreview: true })).toBe("preview");
    expect(getCampusPanelState({ isLoading: false, error: null, hasItems: true, isPreview: false })).toBe("live");
  });
});
