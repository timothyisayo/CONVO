import React from "react";
import EmojiPicker, { EmojiClickData, EmojiStyle, SuggestionMode, Theme } from "emoji-picker-react";
import "@/profile-privacy.css";
import "../directory-refinement.css";
import "../messages-thread-repair.css";
import { Archive, ArrowDown, ArrowLeft, ArrowRight, Ban, Bell, Bookmark, Bot, CalendarDays, Camera, Check, ChevronRight, Compass, Copy, Download, FileText, FolderOpen, Headphones, Home, IdCard, Layers3, LayoutGrid, MailOpen, MessageCircle, MoreHorizontal, Paperclip, Pencil, Phone, Pin, Plus, Reply, Search, Send, Share2, ShieldCheck, Sparkles, Star, SunMoon, Trash2, UserRound, Users, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import QRCode from "qrcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampusGroup, CampusPost } from "@/lib/campus-data";
import { ConvoOrbit } from "@/components/ConvoOrbit";
import { StudentIdCard, StudentIdCardVisibilityContext } from "@/components/StudentIdCard";
import { VaultPanel } from "@/components/VaultPanel";
import { MTU_COLLEGE_OPTIONS, MTU_LEVEL_OPTIONS, MTU_PROGRAMME_OPTIONS, programmesForCollege } from "@shared/academic";
import type { MtuConversationAppearance, MtuNotification, MtuPrivacySettings, ProfileVisibility } from "@/lib/supabase";

type DashboardView = "home" | "discover" | "messages" | "notifications" | "profile" | "groups" | "campus" | "events" | "files" | "assistant" | "vault" | "settings" | "id";
type AssistantMessage = { role: "user" | "assistant"; content: string; attachmentNames?: string[] };
type AssistantChat = { id: string; title: string; messages: AssistantMessage[]; updatedAt: number };

type DirectoryStudent = {
  id: string;
  studentId: string;
  avatarUrl: string | null;
  isSelf?: boolean;
  name: string;
  initials: string;
  programme: string;
  department: string;
  level: string;
  bio: string;
  tone: string;
  status: string;
  mutual: string;
};

type SharedFile = {
  message_id: string;
  sender_id: string;
  attachment_url: string;
  attachment_path: string | null;
  attachment_mime: string | null;
  body: string;
  created_at: string;
  conversation_id?: string;
  conversation_name?: string;
  sender_name?: string;
};

type ActivityNotification = {
  id: string;
  kind: "message" | "connection" | "group";
  title: string;
  body: string;
  createdAt: string;
  conversationId?: string;
  unread: boolean;
};

type Props = {
  currentUserId?: string;
  displayName: string;
  legalName?: string;
  major: string;
  avatarUrl?: string;
  studentId?: string;
  level?: string;
  department?: string;
  programme?: string;
  bio?: string;
  profileVisibility?: ProfileVisibility;
  groups: CampusGroup[];
  posts: CampusPost[];
  joinedGroupIds?: string[];
  onJoinGroup?: (groupId: string) => Promise<{ ok: boolean; error?: string; alreadyJoined?: boolean }>;
  onSearchStudents?: (query: string) => Promise<{ data: Array<{ id: string; display_name: string; student_id: string; is_self?: boolean; programme: string | null; department: string | null; level: string | null; avatar_url: string | null; bio: string | null; status_text: string | null }>; error: { message: string } | null }>;
  onSendConnectionRequest?: (recipientId: string) => Promise<{ ok: boolean; error?: string }>;
  onCancelConnectionRequest?: (recipientId: string) => Promise<{ ok: boolean; error?: string }>;
  onStartDirectConversation?: (studentId: string) => Promise<{ data: string | null; error: { message: string } | null }>;
  onCreateGroupConversation?: (title: string, memberIds?: string[], category?: "academic" | "social" | "sports" | "technology" | "business" | "arts" | "club" | "project" | "code_tech" | "cruise") => Promise<{ data: string | null; error: { message: string } | null }>;
  onUpdateGroupImage?: (conversationId: string, image: File) => Promise<{ ok: boolean; url?: string; error?: string }>;
  onLoadGroupMembers?: (conversationId: string) => Promise<{ data: Array<{ user_id: string; display_name: string; student_id: string; group_role: "owner" | "admin" | "member" }>; error: { message: string } | null }>;
  onAddGroupMembers?: (conversationId: string, memberIds: string[]) => Promise<{ ok: boolean; error?: string; added: number }>;
  onSetGroupMemberRole?: (conversationId: string, memberId: string, role: "admin" | "member") => Promise<{ ok: boolean; error?: string }>;
  onRemoveGroupMember?: (conversationId: string, memberId: string) => Promise<{ ok: boolean; error?: string }>;
  onCreateGroupInvite?: (conversationId: string) => Promise<{ data: string | null; error: string | null }>;
  onRotateGroupInvite?: (conversationId: string) => Promise<{ data: string | null; error: string | null }>;
  onLoadGroupPermissions?: (conversationId: string) => Promise<{ data: { allow_member_messages: boolean; allow_member_invites: boolean; require_join_approval: boolean } | null; error: string | null }>;
  onSetGroupPermissions?: (conversationId: string, permissions: { allow_member_messages: boolean; allow_member_invites: boolean; require_join_approval: boolean }) => Promise<{ data: { allow_member_messages: boolean; allow_member_invites: boolean; require_join_approval: boolean } | null; error: string | null }>;
  onJoinGroupInvite?: (token: string) => Promise<{ data: { conversation_id: string; group_title: string; joined: boolean; pending: boolean } | null; error: string | null }>;
  onLoadGroupJoinRequests?: (conversationId: string) => Promise<{ data: Array<{ user_id: string; display_name: string; student_id: string; created_at: string }>; error: string | null }>;
  onReviewGroupJoinRequest?: (conversationId: string, userId: string, approve: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSendMessage?: (conversationId: string, body: string, attachment?: File | null, replyToId?: string | null) => Promise<{ ok: boolean; error?: string; data?: { id: string; sender_id: string; body: string; created_at: string; attachment_url?: string | null; attachment_path?: string | null; attachment_mime?: string | null; edited_at?: string | null; deleted_at?: string | null; reply_to_id?: string | null; reply_body?: string | null; reply_sender_id?: string | null } | null }>;
  onEditMessage?: (messageId: string, body: string) => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> | null }>;
  onDeleteMessage?: (messageId: string) => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> | null }>;
  onLoadMessageInteractions?: (conversationId: string) => Promise<{ data: Array<{ message_id: string; emoji: string | null; reaction_count: number; reacted_by_me: boolean; saved_by_me: boolean; pinned_by_me: boolean }>; error: { message: string } | null }>;
  onToggleMessageReaction?: (messageId: string, emoji: string) => Promise<{ ok: boolean; error?: string; active: boolean }>;
  onToggleSavedMessage?: (messageId: string) => Promise<{ ok: boolean; error?: string; active: boolean }>;
  onTogglePinnedMessage?: (conversationId: string, messageId: string) => Promise<{ ok: boolean; error?: string; active: boolean }>;
  onSetConversationPreference?: (conversationId: string, privateLabel: string | null, isArchived: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetConversationRailState?: (conversationId: string, pinned: boolean | null, archived: boolean | null, draftBody: string | null, markUnread?: boolean | null) => Promise<{ data: { is_pinned: boolean; is_archived: boolean; draft_body: string | null; is_marked_unread?: boolean } | null; error: string | null }>;
  onLoadPrivacySettings?: () => Promise<{ data: MtuPrivacySettings | null; error: string | null }>;
  onSetPrivacySettings?: (settings: MtuPrivacySettings) => Promise<{ data: MtuPrivacySettings | null; error: string | null }>;
  onLoadConversationNotificationPreference?: (conversationId: string) => Promise<{ data: { muted_until: string | null; is_muted: boolean } | null; error: string | null }>;
  onSetConversationNotificationPreference?: (conversationId: string, muted: boolean, mutedUntil: string | null) => Promise<{ data: { muted_until: string | null; is_muted: boolean } | null; error: string | null }>;
  notificationsEnabled?: boolean;
  onSetNotificationsEnabled?: (enabled: boolean) => void;
  onLoadNotifications?: () => Promise<{ data: MtuNotification[]; error: string | null }>;
  onMarkNotificationRead?: (notificationId: string) => Promise<{ error: string | null }>;
  onClearNotifications?: () => Promise<{ error: string | null }>;
  onSubscribeToNotifications?: (onNotification: (notification: Record<string, unknown>) => void) => () => void;
  onLoadConversationAppearance?: (conversationId: string) => Promise<{ data: MtuConversationAppearance | null; error: string | null }>;
  onSetConversationAppearance?: (conversationId: string, appearance: MtuConversationAppearance) => Promise<{ data: MtuConversationAppearance | null; error: string | null }>;
  onLoadSavedMessages?: () => Promise<{ data: Array<{ message_id: string; conversation_id: string; conversation_title: string; sender_id: string; sender_display_name: string; body: string; created_at: string; attachment_url?: string | null; attachment_mime?: string | null }>; error: string | null }>;
  onSearchConversationMessages?: (conversationId: string, query: string) => Promise<{ data: Array<{ id: string; sender_id: string; sender_display_name: string; body: string; created_at: string; attachment_url?: string | null; attachment_mime?: string | null; reply_to_id?: string | null }>; error: string | null }>;
  onCreateGroupPoll?: (conversationId: string, question: string, options: string[], closesAt: string | null, anonymousVoters: boolean) => Promise<{ data: { poll_id: string; message_id: string } | null; error: string | null }>;
  onUpdateGroupPoll?: (pollId: string, question: string, options: string[], closesAt: string | null, anonymousVoters: boolean) => Promise<{ ok: boolean; error?: string }>;
  onCloseGroupPoll?: (pollId: string) => Promise<{ ok: boolean; error?: string }>;
  onDeleteGroupPoll?: (pollId: string) => Promise<{ ok: boolean; error?: string }>;
  onCreateGroupEvent?: (conversationId: string, title: string, description: string, startsAt: string, location: string) => Promise<{ data: string | null; error: { message: string } | null }>;
  onLoadGroupEvents?: (conversationId: string) => Promise<{ data: Array<{ id: string; title: string; description: string; starts_at: string; location: string; created_by: string; going_count: number; my_response: "going" | "maybe" | "declined" | null }>; error: { message: string } | null }>;
  onSetGroupEventResponse?: (eventId: string, response: "going" | "maybe" | "declined") => Promise<{ data: string | null; error: { message: string } | null }>;
  onCancelGroupEvent?: (eventId: string) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  onUpdateGroupEvent?: (eventId: string, title: string, description: string, startsAt: string, location: string) => Promise<{ ok: boolean; error?: string }>;
  onDeleteGroupEvent?: (eventId: string) => Promise<{ ok: boolean; error?: string }>;
  onCreateGroupNote?: (conversationId: string, title: string, body: string) => Promise<{ data: string | null; error: { message: string } | null }>;
  onUpdateGroupNote?: (noteId: string, title: string, body: string) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  onLoadGroupNotes?: (conversationId: string) => Promise<{ data: Array<{ id: string; title: string; body: string; created_by: string; updated_by: string; created_at: string; updated_at: string }>; error: { message: string } | null }>;
  onCreateGroupAnnouncement?: (conversationId: string, title: string, body: string, expiresAt: string | null) => Promise<{ data: string | null; error: { message: string } | null }>;
  onUpdateGroupAnnouncement?: (announcementId: string, title: string, body: string, expiresAt: string | null) => Promise<{ ok: boolean; error?: string }>;
  onDeleteGroupAnnouncement?: (announcementId: string) => Promise<{ ok: boolean; error?: string }>;
  onLoadGroupAnnouncements?: (conversationId: string) => Promise<{ data: Array<{ id: string; title: string; body: string; created_by: string; publish_at: string; expires_at: string | null }>; error: { message: string } | null }>;
  onLoadGroupPolls?: (conversationId: string) => Promise<{ data: Array<{ poll_id: string; message_id: string; question: string; closes_at?: string | null; is_closed: boolean; anonymous_voters: boolean; created_by: string; option_id: string; option_label: string; option_position: number; vote_count: number; selected_by_me: boolean }>; error: string | null }>;
  onVoteOnGroupPoll?: (pollId: string, optionId: string) => Promise<{ ok: boolean; error?: string }>;
  onCreateGroupTask?: (conversationId: string, title: string, assigneeId: string | null, dueAt: string | null) => Promise<{ data: string | null; error: string | null }>;
  onUpdateGroupTask?: (taskId: string, title: string, assigneeId: string | null, dueAt: string | null) => Promise<{ ok: boolean; error?: string }>;
  onDeleteGroupTask?: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
  onLoadGroupTasks?: (conversationId: string) => Promise<{ data: Array<{ task_id: string; title: string; due_at?: string | null; completed_at?: string | null; created_by: string; assignee_id?: string | null; assignee_display_name?: string | null; completed_by?: string | null; created_at: string }>; error: string | null }>;
  onSetGroupTaskCompleted?: (taskId: string, completed: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSubscribeToGroupActivity?: (conversationId: string, onChange: () => void) => () => void;
  onLoadConnectionRequests?: () => Promise<{ data: Array<{ id: string; requester_id: string; recipient_id: string; status: string; direction: string; requester_display_name?: string | null; requester_student_id?: string | null }>; error: { message: string } | null }>;
  onSubscribeToConnectionRequests?: (onUpdate: () => void) => () => void;
  onAcceptConnectionRequest?: (requestId: string) => Promise<{ ok: boolean; error?: string }>;
  onBlockStudent?: (studentId: string) => Promise<{ ok: boolean; error?: string }>;
  onLoadBlockedStudents?: () => Promise<{ data: Array<{ blocked_id: string; display_name: string | null; nickname: string | null; student_id: string | null; avatar_url: string | null; blocked_at: string }>; error: string | null }>;
  onUnblockStudent?: (studentId: string) => Promise<{ ok: boolean; error?: string }>;
  onReportStudent?: (studentId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  onTouchLastSeen?: () => Promise<{ data: string | null; error: string | null }>;
  onSearchGroups?: (query: string, category?: string) => Promise<{ data: Array<{ conversation_id: string; title: string; category: string | null; group_image_url: string | null; member_count: number; is_member: boolean; my_request_status: string | null }>; error: string | null }>;
  onRequestGroupJoin?: (conversationId: string) => Promise<{ data: { status: "member" | "pending"; group_title: string } | null; error: string | null }>;
  onEndGroup?: (conversationId: string) => Promise<{ ok: boolean; error?: string }>;
  onSetGroupPrivate?: (conversationId: string, isPrivate: boolean) => Promise<{ ok: boolean; error?: string }>;
  onDeleteGroupMessage?: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  onLoadSharedFiles?: (conversationId: string) => Promise<{ data: Array<{ message_id: string; sender_id: string; attachment_url: string; attachment_path: string | null; attachment_mime: string | null; body: string; created_at: string }>; error: string | null }>;
  onLoadConversations?: () => Promise<{ data: Array<{ id: string; title: string | null; kind: string; last_message: string | null; unread_count?: number; counterpart_id?: string | null; group_image_url?: string | null; group_category?: string | null; ended_at?: string | null; counterpart_last_seen_at?: string | null; counterpart_avatar_url?: string | null; is_pinned?: boolean; is_archived?: boolean; muted_until?: string | null; draft_body?: string | null; is_marked_unread?: boolean }>; error: { message: string } | null }>;
  onLoadMessages?: (conversationId: string) => Promise<{ data: Array<{ id: string; conversation_id?: string; sender_id: string; body: string; created_at: string; read_at?: string | null; attachment_url?: string | null; attachment_path?: string | null; attachment_mime?: string | null; edited_at?: string | null; deleted_at?: string | null; reply_to_id?: string | null; reply_body?: string | null; reply_sender_id?: string | null }>; error: { message: string } | null }>;
  onMarkConversationRead?: (conversationId: string) => Promise<{ error: { message: string } | null }>;
  onSubscribeToMessages?: (conversationId: string, onMessage: (message: Record<string, unknown>) => void) => () => void;
  onSubscribeToPublicProfiles?: (onProfile: (profile: Record<string, unknown>) => void) => () => void;
  onSubscribeToAllMessages?: (onMessage: (message: Record<string, unknown>) => void) => () => void;
  onSubscribeToConversation?: (conversationId: string, handlers: { onMessage: (message: Record<string, unknown>) => void; onTyping: (userId: string, isTyping: boolean) => void; onReadReceipt: (messageId: string, readAt: string) => void; onPresence?: (userIds: string[]) => void }, currentUserId?: string) => { sendTyping: (userId: string, isTyping: boolean) => Promise<unknown>; cleanup: () => void };
  onExit: () => void;
  onLogout?: () => Promise<void>;
  onUpdateProfile?: (updates: { nickname: string; programme: string; college: string; level: string; bio: string }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateAvatar?: (file: File) => Promise<{ ok: boolean; url?: string; error?: string }>;
  onUpdatePrivacy?: (visibility: ProfileVisibility) => Promise<{ ok: boolean; error?: string }>;
  onLoadApprovedPeople?: () => Promise<{ data: Array<{ approved_id: string; display_name: string | null; student_id: string | null; avatar_url: string | null; approved_at: string }>; error: string | null }>;
  onSetApprovedPerson?: (studentId: string, approved: boolean) => Promise<{ ok: boolean; error?: string }>;
  onAskAssistant?: (messages: Array<{ role: "user" | "assistant"; content: string }>, attachments?: Array<{ name: string; mimeType: string; data: string }>, sharedFiles?: Array<{ name: string; mimeType: string }>) => Promise<{ text: string; sessionSeconds?: number }>;
  vaultClient?: SupabaseClient | null;
  isExiting?: boolean;
  isEntering?: boolean;
};

export function groupSuccessCopy(groupName: string, alreadyJoined = false) { return alreadyJoined ? { title: `Already part of ${groupName}`, description: "Your circle is waiting for you." } : { title: `You’re in ${groupName}`, description: "Your new circle is ready to explore." }; }
export function groupInviteUrl(origin: string, token: string) { return `${origin.replace(/\/$/, "")}/?group-invite=${encodeURIComponent(token)}`; }

function navLabel(view: DashboardView) { return { home: "Home", discover: "Search", messages: "Messages", notifications: "Notifications", profile: "Profile", groups: "Groups", campus: "Campus", events: "Events", files: "Files", assistant: "Study assistant", vault: "Convo Vault", settings: "Settings", id: "Digital ID" }[view]; }

function messageDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function messageDateKey(value: string) { return new Date(value).toLocaleDateString(); }
function messageTime(value: string) { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

export function ConvoDashboard({ currentUserId = "", displayName, legalName = "", major, avatarUrl, studentId = "", level = "", department = "", programme, bio = "", profileVisibility = { programme: true, college: true, level: true, bio: true, incognito: false, allow_exact_id_lookup: false }, groups, posts, joinedGroupIds,   onJoinGroup, onSearchStudents, onSendConnectionRequest, onCancelConnectionRequest, onStartDirectConversation, onCreateGroupConversation, onUpdateGroupImage, onLoadGroupMembers, onAddGroupMembers, onSetGroupMemberRole, onRemoveGroupMember, onCreateGroupInvite, onRotateGroupInvite, onLoadGroupPermissions, onSetGroupPermissions, onJoinGroupInvite, onLoadGroupJoinRequests, onReviewGroupJoinRequest, onSendMessage, onEditMessage, onDeleteMessage, onLoadMessageInteractions, onToggleMessageReaction, onToggleSavedMessage, onTogglePinnedMessage, onSetConversationPreference, onSetConversationRailState, onLoadPrivacySettings, onSetPrivacySettings, onLoadConversationNotificationPreference, onSetConversationNotificationPreference, notificationsEnabled = false, onSetNotificationsEnabled, onLoadNotifications, onMarkNotificationRead, onClearNotifications, onSubscribeToNotifications, onLoadConversationAppearance, onSetConversationAppearance, onLoadSavedMessages, onSearchConversationMessages, onCreateGroupPoll, onUpdateGroupPoll, onCloseGroupPoll, onDeleteGroupPoll, onLoadGroupEvents, onSetGroupEventResponse, onCreateGroupEvent, onCancelGroupEvent, onUpdateGroupEvent, onDeleteGroupEvent, onLoadGroupNotes, onUpdateGroupNote, onCreateGroupNote, onLoadGroupAnnouncements, onCreateGroupAnnouncement, onUpdateGroupAnnouncement, onDeleteGroupAnnouncement, onLoadGroupPolls, onVoteOnGroupPoll, onCreateGroupTask, onUpdateGroupTask, onDeleteGroupTask, onLoadGroupTasks, onSetGroupTaskCompleted, onSubscribeToGroupActivity, onLoadConnectionRequests, onSubscribeToConnectionRequests, onAcceptConnectionRequest, onBlockStudent, onLoadBlockedStudents, onUnblockStudent, onReportStudent, onTouchLastSeen, onSearchGroups, onRequestGroupJoin, onEndGroup, onSetGroupPrivate, onDeleteGroupMessage, onLoadSharedFiles, onLoadConversations,   onLoadMessages, onMarkConversationRead, onSubscribeToPublicProfiles, onSubscribeToMessages, onSubscribeToAllMessages, onSubscribeToConversation, onExit, onLogout, onUpdateProfile, onUpdateAvatar, onUpdatePrivacy, onLoadApprovedPeople, onSetApprovedPerson, onAskAssistant, vaultClient, isExiting = false, isEntering = false }: Props) {

  const [joinedGroups, setJoinedGroups] = React.useState<string[]>(() => joinedGroupIds || []);
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);
  const [activeView, setActiveView] = React.useState<DashboardView>("home");
  const [directoryQuery, setDirectoryQuery] = React.useState("");
  const [requestStates, setRequestStates] = React.useState<Record<string, "idle" | "pending" | "connected">>({});
  const [connectionRequests, setConnectionRequests] = React.useState<Array<{ id: string; requester_id: string; recipient_id: string; status: string; direction: string; requester_display_name?: string | null; requester_student_id?: string | null }>>([]);
  const [liveStudents, setLiveStudents] = React.useState<DirectoryStudent[]>([]);
  const [directoryLoading, setDirectoryLoading] = React.useState(false);
  const [directoryError, setDirectoryError] = React.useState("");
  const [suggestionFilter, setSuggestionFilter] = React.useState<"college" | "programme">("programme");
  const [suggestionLimit, setSuggestionLimit] = React.useState(3);
  const [loadingMoreSuggestions, setLoadingMoreSuggestions] = React.useState(false);
  const [peekStudent, setPeekStudent] = React.useState<DirectoryStudent | null>(null);
  const [openStudentMenuId, setOpenStudentMenuId] = React.useState("");
  const [showEditProfile, setShowEditProfile] = React.useState(false);
  const [showGroupComposer, setShowGroupComposer] = React.useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = React.useState("");
  const [groupCategoryDraft, setGroupCategoryDraft] = React.useState<"academic" | "social" | "sports" | "technology" | "business" | "arts" | "club" | "project" | "code_tech" | "cruise">("academic");
  const [isDarkMode, setIsDarkMode] = React.useState(() => window.localStorage.getItem("convo-theme") === "dark");
  const [assistantDraft, setAssistantDraft] = React.useState("");
  const [assistantMessages, setAssistantMessages] = React.useState<AssistantMessage[]>([]);
  const [assistantChats, setAssistantChats] = React.useState<AssistantChat[]>([]);
  const [activeAssistantChatId, setActiveAssistantChatId] = React.useState("");
  const [assistantBusy, setAssistantBusy] = React.useState(false);
  const [assistantAttachments, setAssistantAttachments] = React.useState<Array<{ name: string; mimeType: string; data: string }>>([]);
  const [assistantSecondsLeft, setAssistantSecondsLeft] = React.useState(0);
  const assistantFileInputRef = React.useRef<HTMLInputElement>(null);
  const assistantTranscriptRef = React.useRef<HTMLDivElement>(null);
  const assistantHistoryLoadedRef = React.useRef(false);
  const renderEventsPreview = () => {
    if (activeConversation?.kind !== "group") return <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Your circles</span><h1>Choose a group<br /><em>for Events.</em></h1><p>Only groups you belong to can appear here. Select a group to view its events, polls, tasks, and announcements.</p></div></div>{groupDirectoryLoading ? <div className="event-list event-list-loading" aria-busy="true"><div /><div /><div /></div> : groupDirectoryError ? <div className="premium-empty-state"><h2>Groups are unavailable.</h2><p>{groupDirectoryError}</p></div> : <div className="group-row-list">{liveGroupDirectory.filter((group) => group.is_member).map((group, index) => <article className={`group-row ${["rose", "sage", "butter", "apricot"][index % 4]}`} key={group.conversation_id}><span className="group-row-mark" aria-hidden="true">{group.group_image_url ? <img src={group.group_image_url} alt="" /> : <Users size={17} />}</span><div><span className="eyebrow dark">Your circle</span><h2>{group.title}</h2><p>{group.category ? group.category.replace("_", " & ") : "MTU group"}</p></div><small>{group.member_count} members</small><button type="button" className="primary-button" onClick={() => { setLiveConversations((current) => current.some((conversation) => conversation.id === group.conversation_id) ? current : [{ id: group.conversation_id, name: group.title, kind: "group", meta: group.category ? group.category.replace("_", " & ") : "MTU group", message: "Group activity", tone: "rose", unread: "", groupImageUrl: group.group_image_url }, ...current]); setSelectedConversationId(group.conversation_id); setActiveView("events"); }}>{`Open ${group.title}`} <ArrowRight size={14} /></button></article>)}{!liveGroupDirectory.some((group) => group.is_member) && <div className="premium-empty-state"><CalendarDays size={22} /><h2>No groups available.</h2><p>Join a group first, then its Events workspace will appear here.</p></div>}</div>}</section>;
    const reload = () => setGroupEventsVersion((version) => version + 1);
    return <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Campus calendar</span><h1>Make space<br /><em>for moments.</em></h1><p>Events and shared activity for {activeConversation.name}.</p></div><div className="workspace-heading-actions"><button className="primary-button" onClick={openGroupEventsDialog} disabled={!onCreateGroupEvent}><CalendarDays size={16} /> Create event</button><button className="outline-button" onClick={() => setEventComposer("poll")} disabled={!onCreateGroupPoll}>New poll</button><button className="outline-button" onClick={() => setEventComposer("task")} disabled={!onCreateGroupTask}>New task</button><button className="outline-button" onClick={() => setEventComposer("announcement")} disabled={!onCreateGroupAnnouncement}>Announce</button></div></div>{standaloneActivityLoading ? <div className="event-list event-list-loading" aria-busy="true"><div /><div /><div /></div> : standaloneActivityError ? <div className="premium-empty-state"><h2>Activity is unavailable.</h2><p>{standaloneActivityError}</p></div> : <div className="event-list">{standaloneEvents.map((event) => <article className="event-row" key={event.id}><div><h2>{event.title}</h2><p>{event.description}</p><small>{new Date(event.starts_at).toLocaleString()} · {event.location}</small></div><div className="event-response-actions">{(["going", "maybe", "declined"] as const).map((response) => <button type="button" className={event.my_response === response ? "is-active" : ""} key={response} onClick={() => { if (!onSetGroupEventResponse) return; void onSetGroupEventResponse(event.id, response).then((result) => result.error ? toast.error("Couldn’t update attendance", { description: result.error.message }) : reload()); }}>{response}</button>)}</div>{onCancelGroupEvent && <button type="button" className="ghost-button" onClick={() => void onCancelGroupEvent(event.id).then((result) => result.error ? toast.error("Couldn’t cancel event", { description: result.error.message }) : reload())}>Cancel</button>}</article>)}{standalonePolls.map((poll) => <article className="event-row" key={poll.poll_id}><div><span className="eyebrow dark">Poll</span><h2>{poll.question}</h2>{poll.options.map((option) => <button type="button" className="outline-button" key={option.option_id} disabled={poll.is_closed || !onVoteOnGroupPoll} onClick={() => onVoteOnGroupPoll && void onVoteOnGroupPoll(poll.poll_id, option.option_id).then((result) => result.ok ? reload() : toast.error("Couldn’t cast vote", { description: result.error }))}>{option.option_label} · {option.vote_count}</button>)}</div></article>)}{standaloneTasks.map((task) => <article className="event-row" key={task.task_id}><div><span className="eyebrow dark">Task</span><h2>{task.title}</h2><small>{task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : "No deadline"}</small></div>{onSetGroupTaskCompleted && <button type="button" className="outline-button" onClick={() => void onSetGroupTaskCompleted(task.task_id, !task.completed_at).then((result) => result.ok ? reload() : toast.error("Couldn’t update task", { description: result.error }))}>{task.completed_at ? "Reopen" : "Complete"}</button>}</article>)}{standaloneAnnouncements.map((announcement) => <article className="event-row" key={announcement.id}><div><span className="eyebrow dark">Announcement</span><h2>{announcement.title}</h2><p>{announcement.body}</p></div></article>)}{!standaloneEvents.length && !standalonePolls.length && !standaloneTasks.length && !standaloneAnnouncements.length && <div className="premium-empty-state"><h2>No group activity yet.</h2><p>Create the first event, poll, task, or announcement.</p></div>}</div>}</section>;
  };
  React.useEffect(() => {
    if (!currentUserId) return;
    assistantHistoryLoadedRef.current = false;
    try {
      const saved = window.localStorage.getItem(`convo-timothy-chats:${currentUserId}`);
      const parsed = saved ? JSON.parse(saved) as AssistantChat[] : [];
      if (Array.isArray(parsed) && parsed.length) {
        setAssistantChats(parsed);
        setActiveAssistantChatId(parsed[0].id);
        setAssistantMessages(parsed[0].messages || []);
      } else {
        const legacy = window.localStorage.getItem(`convo-timothy-history:${currentUserId}`);
        const messages = legacy ? JSON.parse(legacy) as AssistantMessage[] : [];
        const initial = { id: crypto.randomUUID(), title: messages[0]?.content?.slice(0, 34) || "New chat", messages: Array.isArray(messages) ? messages.slice(-100) : [], updatedAt: Date.now() };
        setAssistantChats([initial]);
        setActiveAssistantChatId(initial.id);
        setAssistantMessages(initial.messages);
      }
    } catch {
      setAssistantMessages([]);
    } finally {
      assistantHistoryLoadedRef.current = true;
    }
  }, [currentUserId]);
  React.useEffect(() => {
    if (!currentUserId || !assistantHistoryLoadedRef.current) return;
    setAssistantChats((current) => current.map((chat) => chat.id === activeAssistantChatId ? { ...chat, messages: assistantMessages.slice(-100), updatedAt: Date.now(), title: chat.title === "New chat" && assistantMessages[0]?.content ? assistantMessages[0].content.slice(0, 34) : chat.title } : chat));
  }, [assistantMessages, activeAssistantChatId, currentUserId]);
  React.useEffect(() => {
    if (!currentUserId || !assistantHistoryLoadedRef.current) return;
    window.localStorage.setItem(`convo-timothy-chats:${currentUserId}`, JSON.stringify(assistantChats));
  }, [assistantChats, currentUserId]);
  React.useEffect(() => {
    const transcript = assistantTranscriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  }, [assistantMessages.length, assistantBusy]);
  const createAssistantChat = () => {
    const chat = { id: crypto.randomUUID(), title: "New chat", messages: [], updatedAt: Date.now() };
    setAssistantChats((current) => [chat, ...current]);
    setActiveAssistantChatId(chat.id);
    setAssistantMessages([]);
    setAssistantDraft("");
    setAssistantAttachments([]);
  };
  const selectAssistantChat = (chat: AssistantChat) => {
    setActiveAssistantChatId(chat.id);
    setAssistantMessages(chat.messages);
    setAssistantDraft("");
    setAssistantAttachments([]);
  };
  React.useEffect(() => {
    if (activeView !== "assistant") return;
    const view = document.querySelector<HTMLElement>(".assistant-view");
    if (!view) return;
    view.classList.add("assistant-chatgpt");
    view.querySelector(".assistant-chat-sidebar")?.remove();
    const sidebar = document.createElement("aside");
    sidebar.className = "assistant-chat-sidebar";
    const newChat = document.createElement("button");
    newChat.type = "button";
    newChat.className = "assistant-new-chat";
    newChat.textContent = "+  New chat";
    newChat.addEventListener("click", createAssistantChat);
    sidebar.appendChild(newChat);
    const label = document.createElement("span");
    label.className = "assistant-sidebar-label";
    label.textContent = "Recent";
    sidebar.appendChild(label);
    const list = document.createElement("nav");
    list.setAttribute("aria-label", "Timothy chats");
    assistantChats.forEach((chat) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `assistant-chat-item ${chat.id === activeAssistantChatId ? "is-active" : ""}`;
      item.textContent = chat.title;
      item.addEventListener("click", () => selectAssistantChat(chat));
      list.appendChild(item);
    });
    sidebar.appendChild(list);
    view.prepend(sidebar);
    return () => {
      sidebar.remove();
      view.classList.remove("assistant-chatgpt");
    };
  }, [activeView, assistantChats, activeAssistantChatId]);
  React.useEffect(() => {
    if (!assistantSecondsLeft || activeView !== "assistant") return;
    const timer = window.setInterval(() => setAssistantSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [assistantSecondsLeft > 0, activeView]);
  React.useEffect(() => {
    if (assistantSecondsLeft === 300 || assistantSecondsLeft === 60) toast(`Timothy’s study window ends in ${assistantSecondsLeft === 300 ? "5 minutes" : "1 minute"}.`, { description: "Save your notes or come back after the cooldown." });
  }, [assistantSecondsLeft]);
  const [profileDraft, setProfileDraft] = React.useState({ nickname: displayName, programme: programme || major, college: department, level, bio });
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [visibilityDraft, setVisibilityDraft] = React.useState<ProfileVisibility>(profileVisibility);
  const [privacySaving, setPrivacySaving] = React.useState(false);
  const [approvedPeople, setApprovedPeople] = React.useState<Array<{ approved_id: string; display_name: string | null; student_id: string | null; avatar_url: string | null; approved_at: string }>>([]);
  const [approvedPeopleLoading, setApprovedPeopleLoading] = React.useState(false);
  const [approvedPeopleError, setApprovedPeopleError] = React.useState("");
  const [approvedIdDraft, setApprovedIdDraft] = React.useState("");
  const defaultMessagingPrivacy: MtuPrivacySettings = { allow_messages: "connections", allow_calls: "connections", show_read_receipts: true, show_online_status: true, allow_group_invites: true, disappearing_messages_seconds: 0 };
  const [messagingPrivacy, setMessagingPrivacy] = React.useState<MtuPrivacySettings>(defaultMessagingPrivacy);
  const [messagingPrivacyLoaded, setMessagingPrivacyLoaded] = React.useState(false);
  const [messagingPrivacySaving, setMessagingPrivacySaving] = React.useState(false);
  const [blockedStudents, setBlockedStudents] = React.useState<Array<{ blocked_id: string; display_name: string | null; nickname: string | null; student_id: string | null; avatar_url: string | null; blocked_at: string }>>([]);
  const [blockedStudentsLoading, setBlockedStudentsLoading] = React.useState(false);
  const [blockedStudentsError, setBlockedStudentsError] = React.useState("");
  const [conversationAppearance, setConversationAppearance] = React.useState<MtuConversationAppearance>({ chat_theme: "convo", wallpaper_variant: "plain" });
  React.useEffect(() => {
    const programmeSelect = document.querySelector<HTMLSelectElement>('select[aria-label="Edit programme"]');
    if (!programmeSelect) return;
    const allowedProgrammes = new Set(programmesForCollege(profileDraft.college));
    Array.from(programmeSelect.options).forEach((option) => {
      if (!option.value) return;
      const allowed = allowedProgrammes.has(option.value);
      option.hidden = !allowed;
      option.disabled = !allowed;
    });
    programmeSelect.disabled = !profileDraft.college;
    if (profileDraft.programme && !allowedProgrammes.has(profileDraft.programme)) {
      setProfileDraft((current) => ({ ...current, programme: "" }));
    }
  }, [profileDraft.college, profileDraft.programme]);
  const [messageDraft, setMessageDraft] = React.useState("");
  const [threadMessageError, setThreadMessageError] = React.useState({ conversationId: "", message: "" });
  const setMessageError = (message: string) => setThreadMessageError({ conversationId: selectedConversationId, message });
  const [conversationFilter, setConversationFilter] = React.useState<"all" | "unread" | "people" | "groups" | "archived" | "pinned">("all");
  const [conversationSearch, setConversationSearch] = React.useState("");
  const [groupSearchQuery, setGroupSearchQuery] = React.useState("");
  const [groupCategoryFilter, setGroupCategoryFilter] = React.useState("all");
  const [liveGroupDirectory, setLiveGroupDirectory] = React.useState<Array<{ conversation_id: string; title: string; category: string | null; group_image_url: string | null; member_count: number; is_member: boolean; my_request_status: string | null }>>([]);
  const [groupDirectoryLoading, setGroupDirectoryLoading] = React.useState(false);
  const [groupDirectoryError, setGroupDirectoryError] = React.useState("");
  const [sharedFilesData, setSharedFilesData] = React.useState<SharedFile[]>([]);
  const [sharedFilesLoading, setSharedFilesLoading] = React.useState(false);
  const [sharedFilesError, setSharedFilesError] = React.useState("");
  const addSharedFile = React.useCallback((file: SharedFile) => {
    setSharedFilesData((current) => current.some((item) => item.message_id === file.message_id) ? current : [file, ...current]);
  }, []);
  const [standaloneEvents, setStandaloneEvents] = React.useState<Array<{ id: string; title: string; description: string; starts_at: string; location: string; created_by: string; going_count: number; my_response: "going" | "maybe" | "declined" | null }>>([]);
  const [standaloneEventsLoading, setStandaloneEventsLoading] = React.useState(false);
  const [standaloneEventsError, setStandaloneEventsError] = React.useState("");
  const [standalonePolls, setStandalonePolls] = React.useState<Array<{ poll_id: string; question: string; created_by: string; closes_at?: string | null; is_closed: boolean; anonymous_voters: boolean; options: Array<{ option_id: string; option_label: string; vote_count: number; selected_by_me: boolean }> }>>([]);
  const [standaloneTasks, setStandaloneTasks] = React.useState<Array<{ task_id: string; title: string; due_at?: string | null; completed_at?: string | null; created_by: string; assignee_id?: string | null; assignee_display_name?: string | null }>>([]);
  const [standaloneAnnouncements, setStandaloneAnnouncements] = React.useState<Array<{ id: string; title: string; body: string; created_by: string; publish_at: string; expires_at: string | null }>>([]);
  const [standaloneActivityLoading, setStandaloneActivityLoading] = React.useState(false);
  const [standaloneActivityError, setStandaloneActivityError] = React.useState("");
  const [eventComposer, setEventComposer] = React.useState<"poll" | "task" | "announcement" | null>(null);
  const [pollOptionCount, setPollOptionCount] = React.useState(2);
  const [groupEventsVersion, setGroupEventsVersion] = React.useState(0);
  const draftConversationRef = React.useRef("");
  const [sendingMessage, setSendingMessage] = React.useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
  const [emojiPanelTab, setEmojiPanelTab] = React.useState<"emoji" | "stickers">("emoji");
  const [stickerSearch, setStickerSearch] = React.useState("");
  const [stickerEditorOpen, setStickerEditorOpen] = React.useState(false);
  const [stickerEditorUrl, setStickerEditorUrl] = React.useState("");
  const [stickerEditorName, setStickerEditorName] = React.useState("My sticker");
  const [stickerEditorText, setStickerEditorText] = React.useState("");
  const stickerFileInputRef = React.useRef<HTMLInputElement>(null);
  const [savedStickers, setSavedStickers] = React.useState<Array<{ id: string; name: string; dataUrl: string; favorite: boolean }>>(() => {
    try { return JSON.parse(window.localStorage.getItem("convo-stickers") || "[]") as Array<{ id: string; name: string; dataUrl: string; favorite: boolean }>; } catch { return []; }
  });
  const [showMediaMenu, setShowMediaMenu] = React.useState(false);
  const [emojiFavorites, setEmojiFavorites] = React.useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("convo-emoji-favorites") || "[]") as string[]; } catch { return []; }
  });
  const [lastEmoji, setLastEmoji] = React.useState("");
  const [showCameraCapture, setShowCameraCapture] = React.useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = React.useState(false);
  const [cameraError, setCameraError] = React.useState("");
  const [isVideoRecording, setIsVideoRecording] = React.useState(false);
  const [videoRecordingSeconds, setVideoRecordingSeconds] = React.useState(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = React.useState("");
  const [showVoiceRecorder, setShowVoiceRecorder] = React.useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = React.useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = React.useState(0);
  const [voicePreviewUrl, setVoicePreviewUrl] = React.useState("");
  const [voiceError, setVoiceError] = React.useState("");
  const [groupImageUrls, setGroupImageUrls] = React.useState<Record<string, string>>({});
  const [loadedAvatarImages, setLoadedAvatarImages] = React.useState<Record<string, boolean>>({});
  const [largeHeaderImage, setLargeHeaderImage] = React.useState<{ url: string; name: string; isOwn?: boolean } | null>(null);
  const [onlineUserIds, setOnlineUserIds] = React.useState<string[]>([]);
  const [liveConversations, setLiveConversations] = React.useState<Array<{ id: string; name: string; kind?: "direct" | "group"; meta: string; message: string; tone: string; unread: string; counterpartId?: string | null; groupImageUrl?: string | null; counterpartAvatarUrl?: string | null; groupCategory?: string | null; endedAt?: string | null; counterpartLastSeenAt?: string | null; isPinned?: boolean; isArchived?: boolean; mutedUntil?: string | null; draftBody?: string | null; isMarkedUnread?: boolean }>>([]);
  const [activityNotifications, setActivityNotifications] = React.useState<ActivityNotification[]>([]);
  const [groupMembers, setGroupMembers] = React.useState<Array<{ user_id: string; display_name: string; student_id: string; avatar_url?: string | null; group_role: "owner" | "admin" | "member" }>>([]);
  const onSubscribeToAllMessagesRef = React.useRef(onSubscribeToAllMessages);
  React.useEffect(() => { onSubscribeToAllMessagesRef.current = onSubscribeToAllMessages; }, [onSubscribeToAllMessages]);
  const liveConversationsRef = React.useRef(liveConversations);
  const groupMembersRef = React.useRef(groupMembers);
  const onLoadSharedFilesRef = React.useRef(onLoadSharedFiles);
  const onSubscribeToMessagesRef = React.useRef(onSubscribeToMessages);
  const onLoadGroupMembersRef = React.useRef(onLoadGroupMembers);
  React.useEffect(() => { liveConversationsRef.current = liveConversations; }, [liveConversations]);
  React.useEffect(() => { groupMembersRef.current = groupMembers; }, [groupMembers]);
  React.useEffect(() => { onLoadSharedFilesRef.current = onLoadSharedFiles; }, [onLoadSharedFiles]);
  React.useEffect(() => { onSubscribeToMessagesRef.current = onSubscribeToMessages; }, [onSubscribeToMessages]);
  React.useEffect(() => { onLoadGroupMembersRef.current = onLoadGroupMembers; }, [onLoadGroupMembers]);
  React.useEffect(() => {
    if (!currentUserId || !onLoadNotifications) return;
    let active = true;
    void onLoadNotifications().then((result) => {
      if (!active) return;
      if (result.error) {
        toast.error("Notifications could not be loaded", { description: result.error });
        return;
      }
      setActivityNotifications(result.data.map((item) => ({
        id: item.id,
        kind: item.notification_type === "connection" ? "connection" : item.notification_type === "group" ? "group" : "message",
        title: item.title,
        body: item.body,
        createdAt: item.created_at,
        conversationId: item.conversation_id || undefined,
        unread: !item.read_at,
      })));
    });
    const unsubscribe = onSubscribeToNotifications?.((raw) => {
      const id = typeof raw.id === "string" ? raw.id : "";
      if (!id) return;
      const notificationType = String(raw.notification_type || "message");
      const next: ActivityNotification = {
        id,
        kind: notificationType === "connection" ? "connection" : notificationType === "group" ? "group" : "message",
        title: String(raw.title || "New notification"),
        body: String(raw.body || ""),
        createdAt: String(raw.created_at || new Date().toISOString()),
        conversationId: typeof raw.conversation_id === "string" ? raw.conversation_id : undefined,
        unread: !raw.read_at,
      };
      setActivityNotifications((current) => [next, ...current.filter((item) => item.id !== id)].slice(0, 100));
    });
    return () => { active = false; unsubscribe?.(); };
  }, [currentUserId, onLoadNotifications, onSubscribeToNotifications]);
  const [selectedConversationId, setSelectedConversationId] = React.useState("");
  const [isThreadExpanded, setIsThreadExpanded] = React.useState(false);
  React.useEffect(() => {
    if (!selectedConversationId) setMessageError("");
  }, [selectedConversationId]);
  const [threadMessages, setThreadMessages] = React.useState<Array<{ id: string; conversation_id?: string; sender_id: string; body: string; created_at: string; read_at?: string | null; attachment_url?: string | null; attachment_path?: string | null; attachment_mime?: string | null; edited_at?: string | null; deleted_at?: string | null; reply_to_id?: string | null; reply_body?: string | null; reply_sender_id?: string | null; delivery_state?: "delivered" | "blocked" }>>([]);
  const [messageInteractions, setMessageInteractions] = React.useState<Record<string, { reactions: Array<{ emoji: string; count: number; reacted: boolean }>; saved: boolean; pinned: boolean }>>({});
  const [replyingTo, setReplyingTo] = React.useState<(typeof threadMessages)[number] | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = React.useState("");
  const [showThreadActions, setShowThreadActions] = React.useState(false);
  const [showPrivateLabelEditor, setShowPrivateLabelEditor] = React.useState(false);
  const [privateLabelDraft, setPrivateLabelDraft] = React.useState("");
  const [attachmentFile, setAttachmentFile] = React.useState<File | null>(null);
  const [editingMessageId, setEditingMessageId] = React.useState("");
  const [editingDraft, setEditingDraft] = React.useState("");
  const [isThreadAway, setIsThreadAway] = React.useState(false);
  const [unreadBelow, setUnreadBelow] = React.useState(0);
  const threadViewportRef = React.useRef<HTMLDivElement>(null);
  const threadNearBottomRef = React.useRef(true);
  const initialThreadScrollConversationRef = React.useRef("");
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const profileAvatarInputRef = React.useRef<HTMLInputElement>(null);
  const composerTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const cameraVideoRef = React.useRef<HTMLVideoElement>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const videoRecorderRef = React.useRef<MediaRecorder | null>(null);
  const videoChunksRef = React.useRef<Blob[]>([]);
  const videoRecordingTimerRef = React.useRef<number | undefined>(undefined);
  const voiceStreamRef = React.useRef<MediaStream | null>(null);
  const voiceRecorderRef = React.useRef<MediaRecorder | null>(null);
  const voiceChunksRef = React.useRef<Blob[]>([]);
  const voiceRecordingTimerRef = React.useRef<number | undefined>(undefined);
  const handledGroupInviteRef = React.useRef(false);
  const handledProfileLinkRef = React.useRef(false);
  const handledMessageLinkRef = React.useRef(false);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    threadMessages.forEach((message) => {
      if (message.sender_id !== currentUserId || message.delivery_state !== "blocked") return;
      const metadata = document.querySelector<HTMLElement>(`[data-message-id="${message.id}"] small`);
      if (metadata?.textContent?.includes(" · Sent")) metadata.textContent = metadata.textContent.replace(" · Sent", " · ✓");
    });
  }, [activeView, currentUserId, threadMessages]);
  const [typingUserId, setTypingUserId] = React.useState("");
  const typingTimerRef = React.useRef<number | undefined>(undefined);
  const typingChannelRef = React.useRef<{ sendTyping: (userId: string, isTyping: boolean) => Promise<unknown> } | null>(null);
  React.useEffect(() => { if (joinedGroupIds) setJoinedGroups(joinedGroupIds); }, [joinedGroupIds]);
  React.useEffect(() => { window.localStorage.setItem("convo-theme", isDarkMode ? "dark" : "light"); }, [isDarkMode]);
  React.useEffect(() => {
    if ((activeView !== "settings" && activeView !== "messages") || !onLoadBlockedStudents) return;
    let active = true;
    setBlockedStudentsLoading(true);
    setBlockedStudentsError("");
    void onLoadBlockedStudents().then((result) => {
      if (!active) return;
      if (result.error) setBlockedStudentsError(result.error);
      else setBlockedStudents(result.data);
      setBlockedStudentsLoading(false);
    });
    return () => { active = false; };
  }, [activeView, onLoadBlockedStudents]);
  React.useEffect(() => { window.localStorage.setItem("convo-emoji-favorites", JSON.stringify(emojiFavorites.slice(0, 24))); }, [emojiFavorites]);
  React.useEffect(() => { window.localStorage.setItem("convo-stickers", JSON.stringify(savedStickers.slice(0, 40))); }, [savedStickers]);
  React.useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    const maxHeight = 180;
    textarea.style.setProperty("height", "0px", "important");
    textarea.style.setProperty("height", `${Math.min(textarea.scrollHeight, maxHeight)}px`, "important");
    textarea.style.setProperty("overflow-y", textarea.scrollHeight > maxHeight ? "auto" : "hidden", "important");
  }, [messageDraft]);
  React.useEffect(() => {
    if (!onLoadConnectionRequests) return;
    let active = true;
    const refreshConnectionRequests = async () => {
      const result = await onLoadConnectionRequests();
      if (!active || result.error) return;
      setConnectionRequests(result.data);
      const hydrated = Object.fromEntries(result.data.map((request) => [request.direction === "sent" ? request.recipient_id : request.requester_id, request.status === "accepted" ? "connected" : request.status === "pending" ? "pending" : "idle"]));
      setRequestStates(hydrated as Record<string, "idle" | "pending" | "connected">);
    };
    void refreshConnectionRequests();
    return () => { active = false; };
  }, [activeView, onLoadConnectionRequests]);
  React.useEffect(() => {
    if (!onSubscribeToConnectionRequests || !onLoadConnectionRequests) return;
    const unsubscribe = onSubscribeToConnectionRequests(() => {
      void onLoadConnectionRequests().then((result) => {
        if (result.error) return;
        setConnectionRequests(result.data);
        const hydrated = Object.fromEntries(result.data.map((request) => [request.direction === "sent" ? request.recipient_id : request.requester_id, request.status === "accepted" ? "connected" : request.status === "pending" ? "pending" : "idle"]));
        setRequestStates(hydrated as Record<string, "idle" | "pending" | "connected">);
      });
    });
    return unsubscribe;
  }, [onLoadConnectionRequests, onSubscribeToConnectionRequests]);
  React.useEffect(() => {
    if (!onSearchStudents || (activeView !== "discover" && activeView !== "home")) return;
    const requestedDirectoryQuery = directoryQuery;
    let active = true;
    let settled = false;
    setDirectoryLoading(true); setDirectoryError("");
    const timeout = window.setTimeout(() => {
      if (!active || settled) return;
      settled = true;
      setDirectoryError("The directory is taking too long to respond. Refresh once and try again.");
      setLiveStudents([]);
      setDirectoryLoading(false);
    }, 9000);
    const requestTimer = window.setTimeout(() => { void onSearchStudents(requestedDirectoryQuery).then((result) => {
      if (!active || settled) return;
      settled = true;
      if (result.error) { setDirectoryError(result.error.message); setLiveStudents([]); }
      else setLiveStudents(result.data.map((student, index) => ({ id: student.id, studentId: student.student_id, avatarUrl: student.avatar_url, isSelf: Boolean(student.is_self), name: student.display_name, initials: student.display_name.slice(0, 2).toUpperCase(), programme: student.programme || "", department: student.department || "", level: student.level || "", bio: student.bio || "", tone: ["rose", "sage", "butter", "apricot"][index % 4], status: student.status_text || "", mutual: "" })));
      setDirectoryLoading(false);
    }).catch(() => {
      if (!active || settled) return;
      settled = true;
      setDirectoryError("The directory could not be reached. Refresh once and try again.");
      setLiveStudents([]);
      setDirectoryLoading(false);
    }).finally(() => window.clearTimeout(timeout)); }, 220);
    return () => { active = false; window.clearTimeout(timeout); window.clearTimeout(requestTimer); };
  }, [activeView, directoryQuery, onSearchStudents]);
  React.useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("group-invite");
    if (!token || handledGroupInviteRef.current || !onJoinGroupInvite) return;
    handledGroupInviteRef.current = true;
    void onJoinGroupInvite(token).then((result) => {
      if (result.error || !result.data) { toast.error("This group invitation can’t be opened", { description: result.error || "It may have expired." }); return; }
      window.history.replaceState({}, "", window.location.pathname);
      if (result.data.pending) { toast("Join request sent", { description: `An admin must approve your request to join ${result.data.group_title}.` }); return; }
      setLiveConversations((current) => current.some((conversation) => conversation.id === result.data!.conversation_id) ? current : [{ id: result.data!.conversation_id, name: result.data!.group_title, kind: "group", meta: "MTU group chat", message: "You joined this group.", tone: "sage", unread: "" }, ...current]);
      setSelectedConversationId(result.data.conversation_id); setActiveView("messages"); toast.success(`You joined ${result.data.group_title}`);
    });
  }, [onJoinGroupInvite]);
  React.useEffect(() => {
    const publicId = new URLSearchParams(window.location.search).get("profile");
    if (!publicId || handledProfileLinkRef.current || !onSearchStudents) return;
    handledProfileLinkRef.current = true;
    void onSearchStudents(publicId).then((result) => {
      if (result.error || !result.data.length) { toast.error("This public profile can’t be opened", { description: result.error?.message || "The student may no longer be discoverable." }); return; }
      const students = result.data.map((student, index) => ({ id: student.id, studentId: student.student_id, avatarUrl: student.avatar_url, isSelf: Boolean(student.is_self), name: student.display_name, initials: student.display_name.slice(0, 2).toUpperCase(), programme: student.programme || "", department: student.department || "", level: student.level || "", bio: student.bio || "", tone: ["rose", "sage", "butter", "apricot"][index % 4], status: student.status_text || "", mutual: "" }));
      const sharedStudent = students.find((student) => !student.isSelf) || students[0];
      setLiveStudents(students); setDirectoryQuery(publicId); setActiveView("discover"); setPeekStudent(sharedStudent); window.history.replaceState({}, "", window.location.pathname);
    }).catch(() => toast.error("This public profile can’t be opened", { description: "Please try the link again." }));
  }, [onSearchStudents]);

  React.useEffect(() => {
    if (!["groups", "events"].includes(activeView) || !onSearchGroups) return;
    let cancelled = false;
    setGroupDirectoryLoading(true);
    setGroupDirectoryError("");
    const timer = window.setTimeout(() => { void onSearchGroups(groupSearchQuery, groupCategoryFilter).then((result) => { if (cancelled) return; if (result.error) { setGroupDirectoryError(result.error); setLiveGroupDirectory([]); } else setLiveGroupDirectory(result.data); setGroupDirectoryLoading(false); }).catch(() => { if (!cancelled) { setGroupDirectoryError("Groups could not be loaded right now."); setGroupDirectoryLoading(false); } }); }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeView, groupSearchQuery, groupCategoryFilter]);
  const requestToJoinGroup = async (conversationId: string, groupName: string) => {
    if (!onRequestGroupJoin) { toast("Group requests will activate after the live group schema is applied."); return; }
    const result = await onRequestGroupJoin(conversationId);
    if (result.error || !result.data) { toast.error("We couldn’t send the group request", { description: result.error || "Please try again shortly." }); return; }
    if (result.data.status === "member") { setJoinedGroups((current) => current.includes(conversationId) ? current : [...current, conversationId]); toast.success(`You’re in ${groupName}`); } else toast.success("Request sent", { description: `${groupName} will appear after the leader approves your request.` });
    setLiveGroupDirectory((current) => current.map((group) => group.conversation_id === conversationId ? { ...group, my_request_status: result.data?.status === "pending" ? "pending" : null, is_member: result.data?.status === "member" } : group));
  };
  const joinGroup = (groupId: string, groupName: string) => {
    if (joinedGroups.includes(groupId)) return;
    if (!onJoinGroup) { toast("Your MTU profile needs to be connected before joining circles."); return; }
    void onJoinGroup(groupId).then((result) => {
      if (!result.ok) { toast(result.error || "We couldn’t join that group."); return; }
      setJoinedGroups((current) => current.includes(groupId) ? current : [...current, groupId]);
      const feedback = groupSuccessCopy(groupName, result.alreadyJoined); toast.success(feedback.title, { description: feedback.description });
    });
  };

  const createGroupConversation = async (titleValue = groupTitleDraft, selectedMemberIds?: string[], categoryValue = groupCategoryDraft) => {
    const title = titleValue.trim();
    if (!title) { setShowGroupComposer(true); return; }
    if (!onCreateGroupConversation) { toast("Group chats will activate after the Supabase messaging schema is applied."); return; }
    const memberIds = selectedMemberIds ?? Object.entries(requestStates).filter(([, state]) => state === "connected").map(([id]) => id);
    const result = await onCreateGroupConversation(title, memberIds, categoryValue);
    if (result.error || !result.data) { toast.error("We couldn’t create that group", { description: result.error?.message || "Please try again shortly." }); return; }
    setSelectedConversationId(result.data); setLiveConversations((current) => [{ id: result.data as string, name: title, kind: "group", meta: "MTU group chat", message: "No messages yet.", tone: "sage", unread: "" }, ...current]); setShowGroupComposer(false); setGroupTitleDraft(""); setGroupCategoryDraft("academic"); setActiveView("messages"); toast.success("Group chat created", { description: memberIds.length ? `${memberIds.length} MTU connection${memberIds.length === 1 ? "" : "s"} added.` : "Find and connect with classmates to add them next." });
  };
  React.useEffect(() => {
    if (!showGroupComposer) return;
    const host = document.createElement("div");
    host.className = "convo-group-composer-backdrop";
    const connectedStudents = liveStudents.filter((student) => requestStates[student.id] === "connected");
    const membersMarkup = connectedStudents.length ? `<fieldset class="convo-group-members"><legend>Add people from your contacts</legend><p class="convo-group-member-note">Select the contacts you want to include in this group.</p>${connectedStudents.map((student) => `<label><input type="checkbox" name="convo-group-member" value="${student.id}"><span>${student.name.replace(/</g, "&lt;")}</span><small>${[student.programme, student.level].filter(Boolean).join(" · ")}</small></label>`).join("")}</fieldset>` : '<p class="convo-group-member-note">You have no connected contacts yet. Connect with classmates first, then add them to this group.</p>';
    host.innerHTML = `<form class="convo-group-composer" aria-label="Create MTU group"><button type="button" class="convo-group-close" aria-label="Close group creator">×</button><span class="eyebrow dark">New MTU circle</span><h2>Name your<br><em>group.</em></h2><p>Give your study circle, project team, or club a name. You can change it later.</p><label for="convo-group-title">Group name</label><input id="convo-group-title" maxlength="80" placeholder="e.g. CS 300L project team" autofocus required><label for="convo-group-category">Group category</label><select id="convo-group-category" required><option value="academic">Academic</option><option value="social">Social</option><option value="sports">Sports</option><option value="technology">Technology</option><option value="business">Business</option><option value="arts">Arts</option><option value="club">Club</option><option value="project">Project</option><option value="code_tech">Code &amp; Tech</option><option value="cruise">Cruise</option></select>${membersMarkup}<div><button type="button" class="outline-button">Cancel</button><button type="submit" class="primary-button">Create group</button></div></form>`;
    const close = () => setShowGroupComposer(false);
    const form = host.querySelector("form") as HTMLFormElement;
    const input = host.querySelector("#convo-group-title") as HTMLInputElement;
    const category = host.querySelector("#convo-group-category") as HTMLSelectElement;
    category.value = groupCategoryDraft;
    host.addEventListener("click", (event) => { if (event.target === host) close(); });
    host.querySelectorAll<HTMLButtonElement>('button[type="button"]').forEach((button) => button.addEventListener("click", close));
    form.addEventListener("submit", (event) => { event.preventDefault(); const memberIds = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="convo-group-member"]:checked')).map((member) => member.value); void createGroupConversation(input.value, memberIds, category.value as typeof groupCategoryDraft); });
    document.body.appendChild(host);
    input.focus();
    return () => host.remove();
  }, [showGroupComposer, liveStudents, requestStates]);
  const stopCamera = React.useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  }, []);
  const closeCameraCapture = React.useCallback(() => { stopCamera(); setShowCameraCapture(false); setCameraError(""); }, [stopCamera]);
  const closeVideoRecorder = React.useCallback(() => {
    const recorder = videoRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    videoRecorderRef.current = null;
    if (videoRecordingTimerRef.current) window.clearInterval(videoRecordingTimerRef.current);
    videoRecordingTimerRef.current = undefined;
    setIsVideoRecording(false);
    stopCamera();
    setShowVideoRecorder(false);
    setCameraError("");
    setVideoRecordingSeconds(0);
    setVideoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; });
  }, [stopCamera]);
  const openCameraCapture = React.useCallback(() => {
    setShowMediaMenu(false);
    setCameraError("");
    setShowCameraCapture(true);
  }, []);
  const openVideoRecorder = React.useCallback(() => {
    setShowMediaMenu(false);
    if (imageInputRef.current) imageInputRef.current.accept = "video/mp4,video/webm,video/quicktime";
    setCameraError("");
    setVideoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; });
    setShowVideoRecorder(true);
  }, []);
  const openVoiceRecorder = React.useCallback(() => {
    setShowMediaMenu(false);
    setVoiceError("");
    setVoicePreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; });
    setShowVoiceRecorder(true);
  }, []);
  React.useEffect(() => {
    if (!showCameraCapture && !showVideoRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser. You can choose a saved video instead.");
      return;
    }
    let active = true;
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: showVideoRecorder }).then(async (stream) => {
      if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play().catch(() => undefined);
      }
    }).catch(() => {
      if (active) setCameraError(showVideoRecorder ? "Camera or microphone permission was not granted. You can choose a saved video instead." : "Camera permission was not granted. You can choose an image instead.");
    });
    return () => { active = false; stopCamera(); };
  }, [showCameraCapture, showVideoRecorder, stopCamera]);
  const startVideoRecording = React.useCallback(() => {
    const stream = cameraStreamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") { setCameraError("Video recording is not available in this browser. You can choose a saved video instead."); return; }
    try {
      const supportedType = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
      videoChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) videoChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const mimeType = (recorder.mimeType || "video/webm").split(";")[0] || "video/webm";
        const blob = new Blob(videoChunksRef.current, { type: mimeType });
        if (blob.size > 25 * 1024 * 1024) { setCameraError("That video is larger than 25 MB. Record a shorter clip and try again."); setIsVideoRecording(false); return; }
        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `convo-video-${Date.now()}.${extension}`, { type: mimeType });
        setAttachmentFile(file);
        setVideoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
        setIsVideoRecording(false);
        setVideoRecordingSeconds(0);
      };
      videoRecorderRef.current = recorder;
      recorder.start(250);
      setVideoRecordingSeconds(0);
      setIsVideoRecording(true);
      videoRecordingTimerRef.current = window.setInterval(() => setVideoRecordingSeconds((seconds) => seconds + 1), 1000);
    } catch {
      setCameraError("This browser could not start video recording. You can choose a saved video instead.");
    }
  }, []);
  const stopVideoRecording = React.useCallback(() => {
    const recorder = videoRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (videoRecordingTimerRef.current) window.clearInterval(videoRecordingTimerRef.current);
    videoRecordingTimerRef.current = undefined;
    recorder.stop();
    videoRecorderRef.current = null;
  }, []);
  const stopVoiceStream = React.useCallback(() => {
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    if (voiceRecordingTimerRef.current) window.clearInterval(voiceRecordingTimerRef.current);
    voiceRecordingTimerRef.current = undefined;
  }, []);
  React.useEffect(() => {
    if (!showVoiceRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia) { setVoiceError("Microphone access is not available in this browser."); return; }
    let active = true;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
      voiceStreamRef.current = stream;
    }).catch(() => { if (active) setVoiceError("Microphone permission was not granted. Check the browser permission and try again."); });
    return () => { active = false; stopVoiceStream(); };
  }, [showVoiceRecorder, stopVoiceStream]);
  const startVoiceRecording = React.useCallback(() => {
    const stream = voiceStreamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") { setVoiceError("Voice recording is not available in this browser."); return; }
    try {
      const supportedType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) voiceChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const mimeType = (recorder.mimeType || "audio/webm").split(";")[0] || "audio/webm";
        const blob = new Blob(voiceChunksRef.current, { type: mimeType });
        if (blob.size > 10 * 1024 * 1024) { setVoiceError("That voice message is larger than 10 MB. Record a shorter message and try again."); setIsVoiceRecording(false); return; }
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `convo-voice-${Date.now()}.${extension}`, { type: mimeType });
        setAttachmentFile(file);
        setVoicePreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
        setIsVoiceRecording(false);
        setVoiceRecordingSeconds(0);
      };
      voiceRecorderRef.current = recorder;
      recorder.start(250);
      setVoiceRecordingSeconds(0);
      setIsVoiceRecording(true);
      voiceRecordingTimerRef.current = window.setInterval(() => setVoiceRecordingSeconds((seconds) => { if (seconds >= 179) { window.setTimeout(() => stopVoiceRecording(), 0); return seconds; } return seconds + 1; }), 1000);
    } catch { setVoiceError("This browser could not start voice recording."); }
  }, []);
  const stopVoiceRecording = React.useCallback(() => {
    const recorder = voiceRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (voiceRecordingTimerRef.current) window.clearInterval(voiceRecordingTimerRef.current);
    voiceRecordingTimerRef.current = undefined;
    recorder.stop();
    voiceRecorderRef.current = null;
  }, []);
  const cancelVoiceRecording = React.useCallback(() => {
    stopVoiceRecording();
    stopVoiceStream();
    setIsVoiceRecording(false);
    setShowVoiceRecorder(false);
    setVoiceRecordingSeconds(0);
    setVoicePreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; });
  }, [stopVoiceRecording, stopVoiceStream]);
  const startConversation = async (student: DirectoryStudent) => {
    if (!onStartDirectConversation) { toast("Live student messaging is not connected yet."); return; }
    const result = await onStartDirectConversation(student.id);
    if (result.error || !result.data) { toast.error("We couldn’t open that conversation", { description: result.error?.message || "Please try again shortly." }); return; }
    setSelectedConversationId(result.data);
    setLiveConversations((current) => current.some((conversation) => conversation.id === result.data) ? current : [{ id: result.data as string, name: student.name, meta: `${student.programme} · ${student.level}`, message: "No messages yet.", tone: student.tone, unread: "" }, ...current]);
    setActiveView("messages");
    toast.success(`Conversation with ${student.name} is ready`, { description: "You can message each other now." });
  };
  const cancelRequest = async (student: DirectoryStudent) => {
    if (!onCancelConnectionRequest) { toast("Request cancellation will activate when connection actions are connected."); return; }
    const result = await onCancelConnectionRequest(student.id);
    if (!result.ok) { toast.error("We couldn’t cancel that request", { description: result.error || "Please try again shortly." }); return; }
    setRequestStates((current) => ({ ...current, [student.id]: "idle" }));
    toast.success("Request cancelled", { description: `${student.name} is no longer pending.` });
  };
  const sendRequest = async (student: DirectoryStudent) => {
    const state = requestStates[student.id] || "idle";
    if (state === "pending" || state === "connected") return;
    if (onSendConnectionRequest) {
      void onSendConnectionRequest(student.id).then((result) => {
        if (!result.ok) { setRequestStates((current) => ({ ...current, [student.id]: "idle" })); toast.error(result.error || "We couldn’t send that request."); return; }
        setRequestStates((current) => ({ ...current, [student.id]: "pending" }));
        toast.success("Request sent", { description: `${student.name} will see your connection request.` });
      });
      return;
    }
    toast("Live connection requests are not connected yet.");
  };

  const suggestions = groups.slice(0, 3);
  const academicProgramme = programme || major || "";
  const suggestedConnections = liveStudents.filter((student) => {
    if (student.isSelf || student.id === currentUserId) return false;
    return suggestionFilter === "college" ? Boolean(department && student.department === department) : Boolean(academicProgramme && student.programme === academicProgramme);
  });
  const visibleSuggestedConnections = suggestedConnections.slice(0, suggestionLimit);
  const loadMoreSuggestions = () => { if (loadingMoreSuggestions || suggestionLimit >= suggestedConnections.length) return; setLoadingMoreSuggestions(true); window.setTimeout(() => { setSuggestionLimit((limit) => Math.min(limit + 3, suggestedConnections.length)); setLoadingMoreSuggestions(false); }, 420); };
  const tiltSuggestionCard = (event: React.PointerEvent<HTMLElement>) => { const card = event.currentTarget; const rect = card.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width - 0.5; const y = (event.clientY - rect.top) / rect.height - 0.5; card.style.setProperty("--tilt-x", `${(-y * 4).toFixed(2)}deg`); card.style.setProperty("--tilt-y", `${(x * 5).toFixed(2)}deg`); card.style.setProperty("--lift", "-3px"); };
  const resetSuggestionCard = (event: React.PointerEvent<HTMLElement>) => { const card = event.currentTarget; card.style.setProperty("--tilt-x", "0deg"); card.style.setProperty("--tilt-y", "0deg"); card.style.setProperty("--lift", "0px"); };
  const directorySource = liveStudents;
  const filteredStudents = onSearchStudents ? directorySource.filter((student) => !student.isSelf && student.id !== currentUserId) : [];
  const firstName = displayName.split(" ")[0] || "Your";
  const unreadConversationCount = liveConversations.reduce((total, conversation) => total + (Number(conversation.unread) || 0), 0);
  const pendingRequestCount = connectionRequests.filter((request) => request.direction === "received" && request.status === "pending").length;

  const openView = (view: DashboardView) => { setActiveView(view); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const saveProfileDraft = async (event: React.FormEvent) => { event.preventDefault(); if (!onUpdateProfile || profileSaving) return; setProfileSaving(true); const result = await onUpdateProfile(profileDraft); setProfileSaving(false); if (!result.ok) { toast.error("We couldn’t update your profile", { description: result.error || "Please try again shortly." }); return; } setShowEditProfile(false); toast.success("Profile updated", { description: "Your student identity is current." }); };
  const updatePrivacy = async (field: keyof ProfileVisibility) => { if (!onUpdatePrivacy || privacySaving) return; const next = { ...visibilityDraft, [field]: !visibilityDraft[field] }; setVisibilityDraft(next); setPrivacySaving(true); const result = await onUpdatePrivacy(next); setPrivacySaving(false); if (!result.ok) { setVisibilityDraft(visibilityDraft); toast.error("We couldn’t update privacy", { description: result.error || "Please try again shortly." }); return; } toast.success("Privacy updated", { description: `${field[0].toUpperCase() + field.slice(1)} is now ${next[field] ? "public" : "private"}.` }); };
  React.useEffect(() => {
    if (activeView !== "settings" || messagingPrivacyLoaded || !onLoadPrivacySettings) return;
    void onLoadPrivacySettings().then((result) => {
      if (result.error || !result.data) { toast.error("Couldn’t load messaging privacy", { description: result.error || "Apply the privacy settings SQL first." }); return; }
      setMessagingPrivacy(result.data); setMessagingPrivacyLoaded(true);
    });
  }, [activeView, messagingPrivacyLoaded, onLoadPrivacySettings]);
  const updateMessagingPrivacy = async (patch: Partial<MtuPrivacySettings>) => {
    const next = { ...messagingPrivacy, ...patch } as MtuPrivacySettings;
    setMessagingPrivacy(next);
    if (!onSetPrivacySettings) { toast("This privacy setting will save when the live privacy schema is connected."); return; }
    setMessagingPrivacySaving(true);
    const result = await onSetPrivacySettings(next);
    setMessagingPrivacySaving(false);
    if (result.error || !result.data) { setMessagingPrivacy(messagingPrivacy); toast.error("We couldn’t update messaging privacy", { description: result.error || "Please try again shortly." }); return; }
    setMessagingPrivacy(result.data); toast.success("Messaging privacy updated");
  };
  const dockRef = React.useRef<HTMLElement>(null);
  const [showMoreMenu, setShowMoreMenu] = React.useState(false);
  const [installState, setInstallState] = React.useState<"available" | "instructions" | "installed">("instructions");
  React.useEffect(() => {
    const handleInstallState = (event: Event) => {
      const state = (event as CustomEvent<"available" | "instructions" | "installed">).detail;
      if (state === "available" || state === "instructions" || state === "installed") setInstallState(state);
    };
    window.addEventListener("convo-install-state", handleInstallState);
    window.dispatchEvent(new Event("convo-install-state-request"));
    return () => window.removeEventListener("convo-install-state", handleInstallState);
  }, []);
  const [privateGroupIds, setPrivateGroupIds] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    if (!showMoreMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setShowMoreMenu(false); };
    const closeOnOutside = (event: MouseEvent) => { if (dockRef.current && !dockRef.current.contains(event.target as Node)) setShowMoreMenu(false); };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutside);
    return () => { document.removeEventListener("keydown", closeOnEscape); document.removeEventListener("mousedown", closeOnOutside); };
  }, [showMoreMenu]);
  const moveDock = (event: React.PointerEvent<HTMLElement>) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const dock = dockRef.current;
    if (!dock) return;
    const point = { x: event.clientX, y: event.clientY };
    dock.querySelectorAll<HTMLElement>(".dock-item").forEach((item) => {
      const rect = item.getBoundingClientRect();
      const distance = Math.hypot(point.x - (rect.left + rect.width / 2), point.y - (rect.top + rect.height / 2));
      const proximity = Math.max(0, 1 - distance / 150);
      item.style.setProperty("--dock-proximity", proximity.toFixed(3));
    });
  };
  const resetDock = () => dockRef.current?.querySelectorAll<HTMLElement>(".dock-item").forEach((item) => item.style.setProperty("--dock-proximity", "0"));
  const primaryNavItems: Array<{ view: DashboardView; icon: React.ReactNode; badge?: string }> = [
    { view: "home", icon: <Home size={17} /> },
    { view: "discover", icon: <Search size={17} /> },
    { view: "messages", icon: <MessageCircle size={17} />, badge: unreadConversationCount > 0 ? String(unreadConversationCount) : undefined },
    { view: "groups", icon: <Users size={17} /> },
    { view: "notifications", icon: <Bell size={17} />, badge: pendingRequestCount > 0 ? String(pendingRequestCount) : undefined },
    { view: "profile", icon: <UserRound size={17} /> },
    { view: "assistant", icon: <Bot size={17} /> },
    { view: "vault", icon: <Layers3 size={17} /> },
  ];
  const sidebarNavItems: Array<{ view: DashboardView; icon: React.ReactNode; badge?: string }> = [
    ...primaryNavItems,
    { view: "events", icon: <CalendarDays size={17} /> },
    { view: "files", icon: <FolderOpen size={17} /> },
    { view: "settings", icon: <SunMoon size={17} /> },
    { view: "id", icon: <IdCard size={17} /> },
  ];

  const renderHome = () => <>
    <section className="dashboard-hero welcome-card"><div className="welcome-content"><div className="dashboard-kicker"><Compass size={15} /> YOUR CONVO</div><h1>Welcome back,<br /><em>{displayName || "there"}.</em></h1><p>Your {major || "programme"} circles are ready. Find a conversation, join a group, or share something from your day.</p><div className="dashboard-quick-actions"><button className="primary-button" onClick={() => openView("messages")}><MessageCircle size={16} /> Start a conversation <ArrowRight size={15} /></button></div><div className="dashboard-hero-meta welcome-footer">{level || studentId || department ? <><span><span className="pulse-dot" /> {[level, studentId].filter(Boolean).join(" · ")}</span>{department && <span>{department}</span>}</> : <span className="profile-setup-hint"><span className="pulse-dot" /> Complete your profile to personalize your circles.</span>}</div></div><div className="bubbles-container" aria-hidden="true"><div className="welcome-bubble-art" aria-hidden="true" /></div></section>
    <section className="dashboard-quick-panel"><div><span className="eyebrow dark">Move through Convo</span><strong>Pick up where you left off.</strong></div><div className="quick-panel-actions"><button onClick={() => openView("messages")}><MessageCircle size={15} /><span><b>Messages</b><small>{unreadConversationCount ? `${unreadConversationCount} unread` : "Open your conversations"}</small></span><ArrowRight size={14} /></button><button onClick={() => openView("discover")}><Users size={15} /><span><b>Classmates</b><small>Find your programme circle</small></span><ArrowRight size={14} /></button><button onClick={() => openView("profile")}><UserRound size={15} /><span><b>Your profile</b><small>{studentId ? "Keep your details current" : "Complete your MTU identity"}</small></span><ArrowRight size={14} /></button></div></section>
    <section className="dashboard-story-strip"><div className="story-intro"><span className="eyebrow dark">Campus now</span><b>Your circles will appear here</b><button className="text-link" onClick={() => openView("discover")}>Find classmates <ArrowRight size={14} /></button></div><div className="story-avatars"><span className="story-empty-note">No stories shared yet.</span></div></section>{onSearchStudents && !directoryLoading && <section className="dashboard-panel suggested-connections-panel"><div className="panel-heading"><div><span className="eyebrow dark">Suggested connections</span><h2>People in your orbit</h2></div><div className="suggestion-filter" role="group" aria-label="Filter suggested connections"><button type="button" className={suggestionFilter === "programme" ? "is-active" : ""} onClick={() => setSuggestionFilter("programme")}>Programme</button><button type="button" className={suggestionFilter === "college" ? "is-active" : ""} onClick={() => setSuggestionFilter("college")}>College</button></div><button className="text-link" onClick={() => openView("discover")}>See directory <ArrowRight size={14} /></button></div>{suggestedConnections.length ? <><div className="suggested-connections">{visibleSuggestedConnections.map((student) => { const state = requestStates[student.id] || "idle"; return <article className="suggested-connection" key={student.id} onPointerMove={tiltSuggestionCard} onPointerLeave={resetSuggestionCard}>    <button type="button" className={`student-avatar ${student.tone}`} onClick={() => setPeekStudent(student)} aria-label={`Preview ${student.name}`}>{student.avatarUrl ? <img src={student.avatarUrl} alt="" /> : student.initials}<span className={student.status === "Online now" ? "is-online" : ""} /></button><div><b>{student.name}</b><small>{[student.programme, student.level].filter(Boolean).join(" · ") || "Academic details not shared"}</small></div><div className={`student-request-wrap ${state}`}><button className={`student-request ${state}`} onClick={() => state === "pending" ? void cancelRequest(student) : void sendRequest(student)}>{state === "pending" ? <><Check size={14} /><span className="request-status-label">Pending</span><span className="cancel-request-label">Cancel Request</span></> : state === "connected" ? <><Check size={14} /> Connected</> : "Connect"}</button></div></article>; })}{loadingMoreSuggestions && Array.from({ length: 3 }).map((_, index) => <div className="suggested-connection suggestion-skeleton" key={`skeleton-${index}`} aria-label="Loading student"><span /><span /><i /></div>)}</div>{suggestionLimit < suggestedConnections.length && !loadingMoreSuggestions && <button type="button" className="load-more-suggestions" onClick={loadMoreSuggestions}>Load More <ChevronRight size={14} /></button>}</> : <div className="dashboard-empty">No classmates match your programme yet. Your suggestions will appear as verified profiles join Convo.</div>}{peekStudent && <div className="quick-peek-backdrop" role="presentation" onClick={() => setPeekStudent(null)}><section className="quick-peek-modal" role="dialog" aria-modal="true" aria-label={`Public profile preview for ${peekStudent.name}`} onClick={(event) => event.stopPropagation()}><button type="button" className="quick-peek-close" onClick={() => setPeekStudent(null)} aria-label="Close profile preview"><X size={16} /></button><span className="eyebrow dark">Quick peek</span><h3>{peekStudent.name}</h3>    <StudentIdCard nickname={peekStudent.name} displayName={peekStudent.name} studentId={peekStudent.studentId} avatarUrl={peekStudent.avatarUrl || undefined} programme={peekStudent.programme} college={peekStudent.department} level={peekStudent.level} bio={peekStudent.bio} /></section></div>}</section>}
    <section className="dashboard-grid"><div className="dashboard-panel feed-panel"><div className="panel-heading"><div><span className="eyebrow dark">Campus pulse</span><h2>For your circles</h2></div><button className="text-link" onClick={() => openView("messages")}>View all <ArrowRight size={14} /></button></div>{posts.length ? posts.slice(0, 3).map((post, index) => <article className="dashboard-post" style={{ "--delay": `${index * 80}ms` } as React.CSSProperties} key={post.id}><span className={`feed-avatar ${post.tone}`}>{post.author_name.slice(0, 2).toUpperCase()}</span><div><b>{post.author_name}</b><small>{post.author_meta}</small><p>{post.body}</p><div className="post-actions"><button aria-label="React to post">♡ {post.likes}</button><button onClick={() => openView("messages")}><MessageCircle size={13} /> Reply</button></div></div><button className="reaction-button" aria-label="React to post">♡</button></article>) : <div className="dashboard-empty">Your feed will come alive as your circles start sharing.</div>}</div><div className="dashboard-panel group-panel"><div className="panel-heading"><div><span className="eyebrow dark">Suggested for you</span><h2>Find your people</h2></div><button className="icon-button subtle" aria-label="More group options" onClick={() => openView("discover")}><MoreHorizontal size={17} /></button></div><div className="suggested-groups">{suggestions.map((group, index) => { const joined = joinedGroups.includes(String(group.id)); return <button className={`suggested-group ${group.tone} ${joined ? "is-joined" : ""}`} key={group.id} style={{ "--delay": `${index * 90}ms` } as React.CSSProperties} onClick={() => joinGroup(String(group.id), group.name)} aria-pressed={joined}><span className="group-icon">{joined ? <Check size={17} /> : <Users size={17} />}</span><span><b>{group.name}</b><small>{joined ? "You’re in · Welcome to the circle" : `${group.meta}${group.members ? ` · ${group.members} members` : ""}`}</small></span>{joined ? <span className="joined-badge">Joined</span> : <ArrowRight size={15} />}</button>; })}</div></div></section>
    <section className="dashboard-lower-grid"><button className="dashboard-feature-card feature-library" onClick={() => openView("discover")}><span className="feature-icon"><Sparkles size={18} /></span><span className="eyebrow dark">Campus directory</span><strong>Find your<br /><em>next conversation.</em></strong><small>Discover verified classmates in your programme and college.</small><ArrowRight size={16} /></button><button className="dashboard-feature-card feature-mtu" onClick={() => openView("discover")}><span className="feature-icon"><ShieldCheck size={18} /></span><span className="eyebrow dark">MTU guide</span><strong>Made for the<br /><em>way campus moves.</em></strong><small>Explore programmes, colleges, circles, and the people making MTU feel connected.</small><ArrowRight size={16} /></button></section>
  </>;

  const renderDiscover = () => <section className="workspace-view discover-view"><div className="workspace-heading"><div><span className="eyebrow dark">The directory</span><h1>Find your<br /><em>people.</em></h1><p>Search by a public student ID, name, programme, department, or level. MTU email addresses stay private.</p></div><div className="workspace-stat"><strong>{filteredStudents.length}</strong><span>matching profiles</span></div></div><div className="directory-search"><Search size={19} /><input value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="Try MTU-26-7K4Q2 or Computer Science" aria-label="Global search" /><kbd>⌘ K</kbd></div><div className="directory-filters"><button className="filter-chip is-active" onClick={() => setDirectoryQuery("")}>All students</button>{major && <button className="filter-chip" onClick={() => setDirectoryQuery(major)}>{major}</button>}{level && <button className="filter-chip" onClick={() => setDirectoryQuery(level)}>{level}</button>}{department && <button className="filter-chip" onClick={() => setDirectoryQuery(department)}>{department}</button>}</div>{directoryLoading && <div className="directory-empty"><span className="pulse-dot" /><span>Searching MTU profiles…</span></div>}{directoryError && <div className="directory-empty"><strong>Directory needs one more setup step.</strong><span>Apply the live student-directory SQL in your Supabase project, then try again.</span></div>}<div className="directory-grid">{filteredStudents.map((student) => { const state = requestStates[student.id] || "idle"; const menuOpen = openStudentMenuId === student.id; return   <article className="student-card" key={student.id}><div className={`student-avatar ${student.tone}`}>{student.avatarUrl ? <img src={student.avatarUrl} alt="" /> : student.initials}<span className={student.status === "Online now" ? "is-online" : ""} /></div><div className="student-card-main"><div className="student-card-name"><div><h3>{student.name}</h3>{student.status && <span>{student.status}</span>}</div><div className="student-card-menu"><button className="icon-button subtle" aria-label={`More options for ${student.name}`} aria-expanded={menuOpen} onClick={() => setOpenStudentMenuId(menuOpen ? "" : student.id)}><MoreHorizontal size={17} /></button>{menuOpen && <div className="student-card-popover" role="menu"><button role="menuitem" onClick={() => { setPeekStudent(student); setOpenStudentMenuId(""); }}><UserRound size={14} /> View profile</button><button role="menuitem" onClick={() => { void navigator.clipboard?.writeText(student.studentId); setOpenStudentMenuId(""); }}><IdCard size={14} /> Copy student ID</button>{state === "connected" ? <button role="menuitem" onClick={() => { setOpenStudentMenuId(""); void startConversation(student); }}><MessageCircle size={14} /> Message</button> : <button role="menuitem" onClick={() => { setOpenStudentMenuId(""); void sendRequest(student); }}><Users size={14} /> {state === "pending" ? "Request pending" : "Connect"}</button>}</div>}</div></div>{(student.programme || student.level) && <p>{[student.programme, student.level].filter(Boolean).join(" · ")}</p>}{state === "connected" ? <button className="student-request connected" onClick={() => void startConversation(student)}><MessageCircle size={15} /> Message</button> : <button className={`student-request ${state}`} onClick={() => void sendRequest(student)}>{state === "pending" ? <><Check size={15} /> Request sent</> : <><Send size={15} /> Connect</>}</button>}</div></article>; })}</div>{!filteredStudents.length && <div className="directory-empty"><Search size={22} /><strong>No student found yet.</strong><span>Try the public ID, programme, or level.</span></div>}{peekStudent && <div className="student-profile-backdrop" role="presentation" onClick={() => setPeekStudent(null)}><section className="student-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="student-profile-title" onClick={(event) => event.stopPropagation()}><button className="student-profile-close" aria-label="Close profile" onClick={() => setPeekStudent(null)}>×</button>  <div className={`student-profile-avatar ${peekStudent.tone}`}>{peekStudent.avatarUrl ? <img src={peekStudent.avatarUrl} alt="" /> : peekStudent.initials}</div><span className="eyebrow dark">MTU student profile</span><h2 id="student-profile-title">{peekStudent.name}</h2>{peekStudent.status && <p className="student-profile-status">{peekStudent.status}</p>}<div className="student-profile-facts">{peekStudent.programme && <div><span>Programme</span><b>{peekStudent.programme}</b></div>}{peekStudent.department && <div><span>College / department</span><b>{peekStudent.department}</b></div>}{peekStudent.level && <div><span>Level</span><b>{peekStudent.level}</b></div>}</div><div className="student-profile-actions">{(requestStates[peekStudent.id] || "idle") === "connected" ? <button className="primary-button" onClick={() => void startConversation(peekStudent)}><MessageCircle size={15} /> Message</button> : <button className="primary-button" onClick={() => void sendRequest(peekStudent)}><Users size={15} /> Connect</button>}<button className="outline-button" onClick={() => setPeekStudent(null)}>Close</button></div></section></div>}</section>;

  React.useEffect(() => {
    if (!onLoadConversations) return;
    let active = true;
    void onLoadConversations().then((result) => {
      if (!active || result.error) return;
      setGroupImageUrls((current) => ({ ...current, ...Object.fromEntries(result.data.filter((conversation) => Boolean(conversation.group_image_url)).map((conversation) => [conversation.id, conversation.group_image_url as string])) }));
      setLiveConversations(result.data.map((conversation, index) => {
        const connectedRequest = connectionRequests.find((request) => request.status === "accepted" && request.direction === "received");
        const fallbackName = connectedRequest?.requester_display_name || "MTU connection";
        return { id: conversation.id, name: conversation.title || (conversation.kind === "group" ? "MTU circle" : fallbackName), kind: conversation.kind === "group" ? "group" : "direct", counterpartId: conversation.counterpart_id || null, groupImageUrl: conversation.group_image_url || null, counterpartAvatarUrl: conversation.counterpart_avatar_url || null, groupCategory: conversation.group_category || null, endedAt: conversation.ended_at || null, counterpartLastSeenAt: conversation.counterpart_last_seen_at || null, meta: conversation.kind === "group" ? "MTU group chat" : conversation.counterpart_last_seen_at ? "Last seen " + new Date(conversation.counterpart_last_seen_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Offline or inactive", message: conversation.last_message || "No messages yet.", tone: ["rose", "sage", "butter"][index % 3], unread: conversation.unread_count ? String(conversation.unread_count) : "", isPinned: Boolean(conversation.is_pinned), isArchived: Boolean(conversation.is_archived), mutedUntil: conversation.muted_until || null, draftBody: conversation.draft_body || null, isMarkedUnread: Boolean(conversation.is_marked_unread) };
      }));
    });
    return () => { active = false; };
  }, [activeView, connectionRequests, onLoadConversations]);
  React.useEffect(() => {
    if (activeView !== "messages" || !selectedConversationId) return;
    draftConversationRef.current = selectedConversationId;
    const savedDraft = liveConversations.find((conversation) => conversation.id === selectedConversationId)?.draftBody || "";
    setMessageDraft(savedDraft);
  }, [activeView, selectedConversationId]);
  React.useEffect(() => {
    if (activeView !== "messages" || !selectedConversationId || draftConversationRef.current !== selectedConversationId || !onSetConversationRailState) return;
    const draft = messageDraft.slice(0, 4000);
    const timeout = window.setTimeout(() => {
      setLiveConversations((current) => current.map((conversation) => conversation.id === selectedConversationId ? { ...conversation, draftBody: draft || null } : conversation));
      void onSetConversationRailState(selectedConversationId, null, null, draft || null);
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [activeView, messageDraft, onSetConversationRailState, selectedConversationId]);
  React.useEffect(() => {
    if (!onTouchLastSeen || !currentUserId) return;
    void onTouchLastSeen();
    const interval = window.setInterval(() => { void onTouchLastSeen(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [currentUserId, onTouchLastSeen]);
  React.useEffect(() => {
    if (!onSubscribeToPublicProfiles || !currentUserId) return;
    const unsubscribe = onSubscribeToPublicProfiles((profile) => {
      const profileId = typeof profile.id === "string" ? profile.id : "";
      if (!profileId || profileId === currentUserId) return;
      setLiveConversations((current) => current.map((conversation) => {
        if (conversation.counterpartId !== profileId) return conversation;
        const publicName = typeof profile.display_name === "string" && profile.display_name.trim() ? profile.display_name : conversation.name;
        const hasAvatarField = Object.prototype.hasOwnProperty.call(profile, "avatar_url");
        const publicAvatar = typeof profile.avatar_url === "string" && profile.avatar_url.trim() ? profile.avatar_url : null;
        return { ...conversation, name: publicName, counterpartAvatarUrl: hasAvatarField ? publicAvatar : conversation.counterpartAvatarUrl || null };
      }));
    });
    return unsubscribe;
  }, [currentUserId, onSubscribeToPublicProfiles]);
  React.useEffect(() => {
    if (!notificationsEnabled || !onSubscribeToAllMessagesRef.current) return;
    const unsubscribe = onSubscribeToAllMessagesRef.current((message) => {
      if (String(message.sender_id || "") === currentUserId) return;
      const conversation = liveConversationsRef.current.find((item) => item.id === String(message.conversation_id || ""));
      const conversationId = String(message.conversation_id || "");
      const notification = { id: `message:${String(message.id || crypto.randomUUID())}`, kind: "message" as const, title: conversation?.name || "New message", body: String(message.body || "Sent an attachment"), createdAt: String(message.created_at || new Date().toISOString()), conversationId, unread: true };
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(notification.title, { body: notification.body });
    });
    const onCall = (event: Event) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const detail = (event as CustomEvent<{ calleeName?: string }>).detail;
      new Notification("Incoming Convo call", { body: `${detail?.calleeName || "Someone"} is calling you.` });
    };
    window.addEventListener("convo:incoming-call", onCall);
    return () => { unsubscribe(); window.removeEventListener("convo:incoming-call", onCall); };
  }, [currentUserId, notificationsEnabled]);
  React.useEffect(() => {
    if (!largeHeaderImage) return;
    const backdrop = document.createElement("div");
    backdrop.className = "convo-large-image-backdrop";
    backdrop.setAttribute("role", "presentation");
    backdrop.innerHTML = `<figure class="convo-large-image-dialog" role="dialog" aria-modal="true" aria-label="Larger profile image"><button type="button" class="convo-large-image-close" aria-label="Close larger image">×</button><img class="convo-large-image" src="${largeHeaderImage.url.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}" alt="${largeHeaderImage.name.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")} profile image"><figcaption>${largeHeaderImage.name}</figcaption>${largeHeaderImage.isOwn && onUpdateAvatar ? '<input class="convo-large-image-upload-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a new profile photo"><button type="button" class="convo-large-image-upload">Upload new profile photo</button>' : ''}</figure>`;
    const close = () => setLargeHeaderImage(null);
    const largeImage = backdrop.querySelector<HTMLImageElement>(".convo-large-image");
    largeImage?.addEventListener("load", () => largeImage.classList.add("is-loaded"));
    if (largeImage?.complete) largeImage.classList.add("is-loaded");
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector(".convo-large-image-close")?.addEventListener("click", close);
    const uploadInput = backdrop.querySelector<HTMLInputElement>(".convo-large-image-upload-input");
    const uploadButton = backdrop.querySelector<HTMLButtonElement>(".convo-large-image-upload");
    uploadButton?.addEventListener("click", () => uploadInput?.click());
    uploadInput?.addEventListener("change", () => { const file = uploadInput.files?.[0]; if (!file || !onUpdateAvatar) return; if (file.size > 5 * 1024 * 1024) { toast.error("Choose an image below 5 MB"); return; } const previousUrl = largeHeaderImage.url; const previewUrl = URL.createObjectURL(file); setLargeHeaderImage((current) => current ? { ...current, url: previewUrl } : current); void onUpdateAvatar(file).then((result) => { if (!result.ok) { URL.revokeObjectURL(previewUrl); setLargeHeaderImage((current) => current ? { ...current, url: previousUrl } : current); toast.error("Couldn’t update profile photo", { description: result.error || "Please try another image." }); return; } URL.revokeObjectURL(previewUrl); if (result.url) setLargeHeaderImage((current) => current ? { ...current, url: result.url as string } : current); toast.success("Profile photo updated"); }); });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    document.body.appendChild(backdrop);
    return () => { window.removeEventListener("keydown", onKeyDown); backdrop.remove(); };
  }, [largeHeaderImage, onUpdateAvatar]);
  React.useEffect(() => {
    if (!onSubscribeToAllMessages || !currentUserId) return;
    const unsubscribe = onSubscribeToAllMessages((raw) => {
      const conversationId = typeof raw.conversation_id === "string" ? raw.conversation_id : "";
      const senderId = typeof raw.sender_id === "string" ? raw.sender_id : "";
      if (!conversationId || !senderId || senderId === currentUserId) return;
      const body = typeof raw.body === "string" && raw.body ? raw.body : "New message";
      const isActive = activeView === "messages" && conversationId === selectedConversationId;
      setLiveConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, message: body, unread: isActive ? "" : String((Number(conversation.unread) || 0) + 1) } : conversation));
      if (isActive && onMarkConversationRead) void onMarkConversationRead(conversationId);
    });
    return unsubscribe;
  }, [activeView, currentUserId, onMarkConversationRead, onSubscribeToAllMessages, selectedConversationId]);
  const allConversationRows = liveConversations;
  const normalizedConversationSearch = conversationSearch.trim().toLowerCase();
  const conversationRows = allConversationRows.filter((conversation) => {
    const matchesSearch = !normalizedConversationSearch || [conversation.name, conversation.meta, conversation.message].some((value) => value.toLowerCase().includes(normalizedConversationSearch));
    if (!matchesSearch) return false;
    if (conversationFilter === "unread") return Boolean(conversation.unread);
    if (conversationFilter === "people") return conversation.kind !== "group" && !conversation.isArchived;
    if (conversationFilter === "groups") return conversation.kind === "group" && !conversation.isArchived;
    if (conversationFilter === "archived") return Boolean(conversation.isArchived);
    if (conversationFilter === "pinned") return Boolean(conversation.isPinned) && !conversation.isArchived;
    return !conversation.isArchived;
  });
  const activeConversation = allConversationRows.find((conversation) => conversation.id === selectedConversationId) || null;
  const messageError = activeConversation && threadMessageError.conversationId === activeConversation.id ? threadMessageError.message : "";
  const currentDirectIsBlocked = Boolean(activeConversation?.kind !== "group" && activeConversation?.counterpartId && blockedStudents.some((student) => student.blocked_id === activeConversation.counterpartId));
  const messagesWorkspaceMode: "idle" | "direct" | "blocked-direct" | "group" = activeView !== "messages" || !activeConversation ? "idle" : activeConversation.kind === "group" ? "group" : currentDirectIsBlocked ? "blocked-direct" : "direct";
  React.useEffect(() => {
    initialThreadScrollConversationRef.current = "";
    setMessageError("");
    setThreadMessages([]);
    setMessageInteractions({});
    setReplyingTo(null);
    setEditingMessageId("");
    setEditingDraft("");
    setAttachmentFile(null);
    setShowEmojiPicker(false);
    setShowMediaMenu(false);
    setOpenMessageMenuId("");
    setTypingUserId("");
    setUnreadBelow(0);
    setIsThreadAway(false);
  }, [selectedConversationId]);
  React.useEffect(() => {
    if (activeConversation?.kind !== "group" || !onLoadGroupMembers) { setGroupMembers([]); return; }
    let active = true;
    void onLoadGroupMembers(activeConversation.id).then((result) => { if (active && !result.error) setGroupMembers(result.data); });
    return () => { active = false; };
  }, [activeConversation?.id, activeConversation?.kind, onLoadGroupMembers]);
  React.useEffect(() => {
    if (!onLoadMessages || activeView !== "messages" || !selectedConversationId) return;
    let active = true;
    setThreadMessages([]);
    setMessageInteractions({});
    setReplyingTo(null);
    typingChannelRef.current = null;
    void onLoadMessages(selectedConversationId).then((result) => {
      if (!active || result.error) return;
      setThreadMessages((current) => {
        const merged = new Map(current.map((message) => [message.id, message]));
        result.data.forEach((message) => merged.set(message.id, { ...message, conversation_id: selectedConversationId }));
        return Array.from(merged.values()).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      });
    });
    if (onMarkConversationRead) void onMarkConversationRead(selectedConversationId);
    const onMessage = (message: Record<string, unknown>) => {
      const next = { id: String(message.id || crypto.randomUUID()), conversation_id: selectedConversationId, sender_id: String(message.sender_id || ""), body: String(message.body || ""), created_at: String(message.created_at || new Date().toISOString()), read_at: typeof message.read_at === "string" ? message.read_at : null, attachment_url: typeof message.attachment_url === "string" ? message.attachment_url : null, attachment_path: typeof message.attachment_path === "string" ? message.attachment_path : null, edited_at: typeof message.edited_at === "string" ? message.edited_at : null, deleted_at: typeof message.deleted_at === "string" ? message.deleted_at : null };
      if (next.attachment_url && !next.deleted_at) addSharedFile({ message_id: next.id, sender_id: next.sender_id, attachment_url: next.attachment_url, attachment_path: next.attachment_path, attachment_mime: typeof message.attachment_mime === "string" ? message.attachment_mime : null, body: next.body, created_at: next.created_at, conversation_id: selectedConversationId, conversation_name: activeConversation?.name, sender_name: activeConversation?.kind === "group" ? groupMembers.find((member) => member.user_id === next.sender_id)?.display_name : activeConversation?.name });
      setThreadMessages((current) => {
        const existing = current.some((item) => item.id === next.id);
        const merged = existing ? current.map((item) => item.id === next.id ? { ...item, ...next } : item) : [...current, next];
        return merged.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      });
      setLiveConversations((current) => current.map((conversation) => conversation.id === selectedConversationId ? { ...conversation, message: next.body, unread: "" } : conversation));
      if (onMarkConversationRead && next.sender_id) void onMarkConversationRead(selectedConversationId);
    };
    const conversationChannel = onSubscribeToConversation?.(selectedConversationId, {
      onMessage,
      onTyping: (userId, isTyping) => { setTypingUserId(isTyping && userId !== currentUserId ? userId : ""); },
      onReadReceipt: (messageId, readAt) => {
        setThreadMessages((current) => current.map((message) => message.id === messageId ? { ...message, read_at: readAt } : message));
      },
      onPresence: (userIds) => setOnlineUserIds(userIds.filter((userId) => userId !== currentUserId)),
    }, currentUserId);
    typingChannelRef.current = conversationChannel || null;
    const unsubscribe = !conversationChannel && onSubscribeToMessages ? onSubscribeToMessages(selectedConversationId, onMessage) : undefined;
    return () => { active = false; conversationChannel?.cleanup(); unsubscribe?.(); typingChannelRef.current = null; setTypingUserId(""); if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); };
  }, [activeView, addSharedFile, onLoadMessages, onMarkConversationRead, onSubscribeToMessages, onSubscribeToConversation, selectedConversationId]);
  React.useEffect(() => {
    if (!selectedConversationId || !threadMessages.some((message) => message.conversation_id === selectedConversationId)) return;
    if (initialThreadScrollConversationRef.current === selectedConversationId) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = threadViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      initialThreadScrollConversationRef.current = selectedConversationId;
      threadNearBottomRef.current = true;
      setIsThreadAway(false);
      setUnreadBelow(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedConversationId, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages" || !selectedConversationId || initialThreadScrollConversationRef.current !== selectedConversationId) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = threadViewportRef.current;
      if (!viewport) return;
      if (threadNearBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
        setIsThreadAway(false);
        setUnreadBelow(0);
      } else {
        refreshUnreadBelow();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, selectedConversationId, threadMessages]);
  React.useEffect(() => {
    if (!onLoadConversationAppearance || activeView !== "messages" || !selectedConversationId) return;
    let active = true;
    void onLoadConversationAppearance(selectedConversationId).then((result) => {
      if (active && !result.error && result.data) setConversationAppearance(result.data);
    });
    return () => { active = false; };
  }, [activeView, onLoadConversationAppearance, selectedConversationId]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const panel = document.querySelector<HTMLElement>(".thread-panel");
    if (!panel) return;
    panel.dataset.chatTheme = conversationAppearance.chat_theme;
    panel.dataset.wallpaper = conversationAppearance.wallpaper_variant;
  }, [activeView, conversationAppearance]);
  React.useEffect(() => {
    if (!onLoadMessageInteractions || activeView !== "messages" || !selectedConversationId) return;
    let active = true;
    void onLoadMessageInteractions(selectedConversationId).then((result) => {
      if (!active || result.error) return;
      const next: Record<string, { reactions: Array<{ emoji: string; count: number; reacted: boolean }>; saved: boolean; pinned: boolean }> = {};
      result.data.forEach((interaction) => {
        const entry = next[interaction.message_id] || { reactions: [], saved: interaction.saved_by_me, pinned: interaction.pinned_by_me };
        entry.saved = interaction.saved_by_me;
        entry.pinned = interaction.pinned_by_me;
        if (interaction.emoji) entry.reactions.push({ emoji: interaction.emoji, count: Number(interaction.reaction_count) || 0, reacted: interaction.reacted_by_me });
        next[interaction.message_id] = entry;
      });
      setMessageInteractions(next);
    });
    return () => { active = false; };
  }, [activeView, onLoadMessageInteractions, selectedConversationId]);
  const sendMessage = async (event: React.FormEvent) => { event.preventDefault(); const body = replaceEmojiAlias(messageDraft).trim(); if ((!body && !attachmentFile) || sendingMessage) return; if (messagesWorkspaceMode === "blocked-direct") { setMessageError("Unblock this student in Safety & privacy before sending a new message."); return; } if (body.length > 4000) { setMessageError("Messages must be 4,000 characters or fewer."); return; } if (!selectedConversationId || !onSendMessage) { setMessageError("Choose a live conversation before sending a message."); return; } setMessageError(""); setSendingMessage(true); try { const result = replyingTo ? await onSendMessage(selectedConversationId, body, attachmentFile, replyingTo.id) : attachmentFile ? await onSendMessage(selectedConversationId, body, attachmentFile) : await onSendMessage(selectedConversationId, body); if (!result.ok) { setMessageError(result.error || "We couldn’t send that message."); return; } if (result.data) { setThreadMessages((current) => current.some((item) => item.id === result.data?.id) ? current : [...current, { ...result.data, conversation_id: selectedConversationId } as { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; reply_to_id?: string | null }]); if (result.data.attachment_url) addSharedFile({ message_id: result.data.id, sender_id: result.data.sender_id, attachment_url: result.data.attachment_url, attachment_path: result.data.attachment_path || null, attachment_mime: result.data.attachment_mime || null, body: result.data.body, created_at: result.data.created_at }); } await typingChannelRef.current?.sendTyping(currentUserId, false); setMessageDraft(""); setAttachmentFile(null); setReplyingTo(null); if (onSetConversationRailState) await onSetConversationRailState(selectedConversationId, null, null, ""); } finally { setSendingMessage(false); } };
  const emojiAliases: Record<string, string> = { ":smile:": "😊", ":happy:": "😊", ":fire:": "🔥", ":heart:": "❤️", ":laugh:": "😂", ":thumbsup:": "👍", ":sad:": "😢", ":party:": "🎉", ":eyes:": "👀" };
  const replaceEmojiAlias = (value: string) => value.replace(/:[a-z_]+:/gi, (alias) => emojiAliases[alias.toLowerCase()] || alias);
  const insertEmoji = (emoji: string) => {
    const textarea = composerTextareaRef.current;
    const start = textarea?.selectionStart ?? messageDraft.length;
    const end = textarea?.selectionEnd ?? messageDraft.length;
    setMessageDraft((draft) => `${draft.slice(0, start)}${emoji}${draft.slice(end)}`);
    setLastEmoji(emoji);
    setEmojiFavorites((current) => current.includes(emoji) ? current : [emoji, ...current].slice(0, 24));
    window.requestAnimationFrame(() => { textarea?.focus(); const nextPosition = start + emoji.length; textarea?.setSelectionRange(nextPosition, nextPosition); });
  };
  const chooseStickerImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) { toast.error("Choose an image for your sticker."); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Sticker images must be 8 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => setStickerEditorUrl(String(reader.result || ""));
    reader.onerror = () => toast.error("Could not read that image.");
    reader.readAsDataURL(file);
  };
  const saveSticker = () => {
    if (!stickerEditorUrl) { toast.error("Choose an image before saving."); return; }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 360;
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) { toast.error("This device cannot create stickers."); return; }
      context.clearRect(0, 0, size, size);
      const scale = Math.min(size / image.width, size / image.height);
      const width = image.width * scale; const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      if (stickerEditorText.trim()) {
        context.font = "700 28px sans-serif"; context.textAlign = "center"; context.textBaseline = "bottom";
        context.lineWidth = 6; context.strokeStyle = "white"; context.strokeText(stickerEditorText.trim(), size / 2, size - 12);
        context.fillStyle = "#2f2830"; context.fillText(stickerEditorText.trim(), size / 2, size - 12);
      }
      const saved = { id: crypto.randomUUID(), name: stickerEditorName.trim() || "My sticker", dataUrl: canvas.toDataURL("image/png"), favorite: false };
      setSavedStickers((current) => [saved, ...current.filter((item) => item.name !== saved.name)].slice(0, 40));
      setStickerEditorOpen(false); setStickerEditorUrl(""); setStickerEditorText(""); setStickerEditorName("My sticker");
      toast.success("Sticker saved");
    };
    image.onerror = () => toast.error("Could not prepare that image.");
    image.src = stickerEditorUrl;
  };
  const sendSticker = async (sticker: { id: string; name: string; dataUrl: string; favorite: boolean }) => {
    if (!selectedConversationId || !onSendMessage) { toast.error("Choose a conversation before sending a sticker."); return; }
    try {
      const response = await fetch(sticker.dataUrl); const blob = await response.blob();
      const result = await onSendMessage(selectedConversationId, "", new File([blob], `${sticker.name}.png`, { type: "image/png" }));
      if (!result.ok) toast.error("Couldn’t send sticker", { description: result.error || "Please try again." });
      else setShowEmojiPicker(false);
    } catch { toast.error("Couldn’t send sticker", { description: "Please try again." }); }
  };
  const composerSuggestions = React.useMemo(() => {
    const match = messageDraft.match(/:([a-z_]{2,})$/i);
    if (!match) return [];
    const query = match[1].toLowerCase();
    return Object.entries(emojiAliases).filter(([alias]) => alias.includes(query)).slice(0, 5);
  }, [messageDraft]);
  const textCommands: Record<string, { label: string; value: string }> = { "/shrug": { label: "Add a shrug", value: "¯\\_(ツ)_/¯" }, "/tableflip": { label: "Add a table flip", value: "(╯°□°)╯︵ ┻━┻" }, "/me": { label: "Describe an action", value: "* " } };
  const commandSuggestions = React.useMemo(() => {
    const match = messageDraft.match(/^\/(\w*)$/);
    if (!match) return [];
    return Object.entries(textCommands).filter(([command]) => command.includes(`/${match[1].toLowerCase()}`));
  }, [messageDraft]);
  const applyComposerWrapper = (prefix: string, suffix = prefix) => {
    const textarea = composerTextareaRef.current; const start = textarea?.selectionStart ?? messageDraft.length; const end = textarea?.selectionEnd ?? messageDraft.length; const selected = messageDraft.slice(start, end) || "text";
    setMessageDraft(`${messageDraft.slice(0, start)}${prefix}${selected}${suffix}${messageDraft.slice(end)}`);
    window.requestAnimationFrame(() => { textarea?.focus(); const cursor = start + prefix.length + selected.length + suffix.length; textarea?.setSelectionRange(cursor, cursor); });
  };
  const applyTextCommand = (value: string) => { setMessageDraft(value); composerTextareaRef.current?.focus(); };
  const mentionSuggestions = React.useMemo(() => {
    if (activeConversation?.kind !== "group") return [];
    const match = messageDraft.match(/@([A-Za-z0-9_-]{1,40})$/);
    if (!match) return [];
    const query = match[1].toLocaleLowerCase();
    return groupMembers.filter((member) => member.user_id !== currentUserId && member.display_name.toLocaleLowerCase().replace(/\s+/g, "").includes(query.replace(/\s+/g, ""))).slice(0, 5);
  }, [activeConversation?.kind, currentUserId, groupMembers, messageDraft]);
  const insertMention = (name: string) => { setMessageDraft((draft) => draft.replace(/@[A-Za-z0-9_-]{1,40}$/, `@${name} `)); composerTextareaRef.current?.focus(); };
  const captureCameraPhoto = () => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) { setCameraError("The camera is still preparing. Please wait a moment and try again."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setCameraError("This browser could not capture the camera image. Choose an image instead."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { setCameraError("The photo could not be captured. Please try again or choose an image."); return; }
      setAttachmentFile(new File([blob], `convo-camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      closeCameraCapture();
    }, "image/jpeg", 0.9);
  };
  const handleMessageDraftChange = (value: string) => { setMessageDraft(value); if (!currentUserId || !typingChannelRef.current) return; void typingChannelRef.current.sendTyping(currentUserId, value.trim().length > 0); if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); if (value.trim()) typingTimerRef.current = window.setTimeout(() => { void typingChannelRef.current?.sendTyping(currentUserId, false); }, 1200); };
  const groupedThreadMessages = React.useMemo(() => { const groups = new Map<string, typeof threadMessages>(); threadMessages.filter((message) => Boolean(activeConversation) && message.conversation_id === activeConversation?.id).forEach((message) => { const key = messageDateKey(message.created_at); const group = groups.get(key) || []; group.push(message); groups.set(key, group); }); return Array.from(groups.entries()); }, [activeConversation?.id, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".thread-message.is-own > small").forEach((meta) => {
        meta.classList.toggle("is-delivered", meta.textContent?.includes("Seen") || false);
        meta.classList.toggle("is-pending", meta.textContent?.includes("Sent") || false);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, threadMessages]);
  const startEditingMessage = (message: (typeof threadMessages)[number]) => { setEditingMessageId(message.id); setEditingDraft(message.body); };
  const saveEditedMessage = async (event: React.FormEvent) => { event.preventDefault(); if (!editingMessageId || !onEditMessage || !editingDraft.trim()) return; const result = await onEditMessage(editingMessageId, editingDraft.trim()); if (!result.ok) { toast.error("Couldn’t edit message", { description: result.error || "That message is no longer editable." }); return; } setThreadMessages((current) => current.map((message) => message.id === editingMessageId ? { ...message, body: editingDraft.trim(), edited_at: new Date().toISOString() } : message)); setEditingMessageId(""); setEditingDraft(""); toast.success("Message updated"); };
  const removeMessage = async (messageId: string) => { if (!onDeleteMessage) return; const result = await onDeleteMessage(messageId); if (!result.ok) { toast.error("Couldn’t delete message", { description: result.error || "That message is no longer removable." }); return; } setThreadMessages((current) => current.map((message) => message.id === messageId ? { ...message, body: "Message deleted", attachment_url: null, deleted_at: new Date().toISOString() } : message)); toast.success("Message deleted"); };
  const openAppConfirmation = (title: string, description: string, confirmLabel: string) => new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    host.className = "convo-private-label-backdrop";
    host.innerHTML = `<section class="convo-private-label-dialog convo-confirm-dialog" role="dialog" aria-modal="true" aria-label="${title}"><button type="button" aria-label="Close confirmation" class="convo-private-label-close">×</button><span class="eyebrow dark">Please confirm</span><h2>${title}</h2><p>${description}</p><div class="profile-sheet-actions"><button type="button" class="outline-button" data-cancel-confirm>Cancel</button><button type="button" class="primary-button danger-button" data-confirm-action>${confirmLabel}</button></div></section>`;
    const close = (confirmed: boolean) => { host.remove(); resolve(confirmed); };
    host.addEventListener("click", (event) => { if (event.target === host) close(false); });
    host.querySelector(".convo-private-label-close")?.addEventListener("click", () => close(false));
    host.querySelector("[data-cancel-confirm]")?.addEventListener("click", () => close(false));
    host.querySelector("[data-confirm-action]")?.addEventListener("click", () => close(true));
    document.body.appendChild(host);
  });
  const confirmItemDeletion = async (itemType: string, deleteItem: () => Promise<{ ok: boolean; error?: string }>) => {
    if (!await openAppConfirmation(`Delete this ${itemType}?`, "This cannot be undone for the group.", "Delete")) return null;
    return deleteItem();
  };
  const openAppPrompt = (title: string, value: string) => new Promise<string | null>((resolve) => {
    const host = document.createElement("div");
    host.className = "convo-private-label-backdrop";
    host.innerHTML = `<section class="convo-private-label-dialog convo-confirm-dialog" role="dialog" aria-modal="true" aria-label="${title}"><button type="button" aria-label="Close input dialog" class="convo-private-label-close">×</button><span class="eyebrow dark">Edit activity</span><h2>${title}</h2><input class="convo-app-prompt-input" value="${value.replace(/"/g, "&quot;")}" aria-label="${title}"><div class="profile-sheet-actions"><button type="button" class="outline-button" data-cancel-prompt>Cancel</button><button type="button" class="primary-button" data-submit-prompt>Save</button></div></section>`;
    const input = host.querySelector<HTMLInputElement>(".convo-app-prompt-input");
    const close = (result: string | null) => { host.remove(); resolve(result); };
    host.addEventListener("click", (event) => { if (event.target === host) close(null); });
    host.querySelector(".convo-private-label-close")?.addEventListener("click", () => close(null));
    host.querySelector("[data-cancel-prompt]")?.addEventListener("click", () => close(null));
    host.querySelector("[data-submit-prompt]")?.addEventListener("click", () => close(input?.value || ""));
    document.body.appendChild(host);
    input?.focus();
    input?.select();
  });
  const moderateGroupMessage = async (messageId: string) => { if (!onDeleteGroupMessage) { toast("Group moderation needs the latest group SQL migration."); return; } if (!await openAppConfirmation("Remove this message?", "This removes the member message for everyone in the group.", "Remove message")) return; const result = await onDeleteGroupMessage(messageId); if (!result.ok) { toast.error("Couldn’t remove member message", { description: result.error || "You may not have permission to moderate this message." }); return; } setThreadMessages((current) => current.map((message) => message.id === messageId ? { ...message, body: "Message removed by a group manager", attachment_url: null, deleted_at: new Date().toISOString() } : message)); };

  const toggleReaction = async (messageId: string, emoji: string) => { if (!onToggleMessageReaction) { toast("Apply the message interaction SQL before using reactions."); return; } const result = await onToggleMessageReaction(messageId, emoji); if (!result.ok) { toast.error("Couldn’t update reaction", { description: result.error || "Please try again." }); return; } setMessageInteractions((current) => { const entry = current[messageId] || { reactions: [], saved: false, pinned: false }; const present = entry.reactions.find((reaction) => reaction.emoji === emoji); const reactions = present ? entry.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: Math.max(0, reaction.count + (result.active ? 1 : -1)), reacted: result.active } : reaction).filter((reaction) => reaction.count > 0) : [...entry.reactions, { emoji, count: 1, reacted: true }]; return { ...current, [messageId]: { ...entry, reactions } }; }); };
  const toggleSaved = async (messageId: string) => { if (!onToggleSavedMessage) { toast("Apply the message interaction SQL before saving messages."); return; } const result = await onToggleSavedMessage(messageId); if (!result.ok) { toast.error("Couldn’t update saved messages", { description: result.error || "Please try again." }); return; } setMessageInteractions((current) => ({ ...current, [messageId]: { ...(current[messageId] || { reactions: [], saved: false, pinned: false }), saved: result.active } })); };
  const togglePinned = async (messageId: string) => { if (!selectedConversationId || !onTogglePinnedMessage) { toast("Apply the message interaction SQL before pinning messages."); return; } const result = await onTogglePinnedMessage(selectedConversationId, messageId); if (!result.ok) { toast.error("Couldn’t update pinned messages", { description: result.error || "Please try again." }); return; } setMessageInteractions((current) => ({ ...current, [messageId]: { ...(current[messageId] || { reactions: [], saved: false, pinned: false }), pinned: result.active } })); };
  const saveAttachmentToDevice = async (url: string, suggestedName: string) => {
    const safeName = suggestedName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "convo-attachment";
    try { const response = await fetch(url); if (!response.ok) throw new Error("download failed"); const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = objectUrl; link.download = safeName; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
    catch { const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noreferrer"; link.download = safeName; link.click(); }
  };
  const copyMessageText = async (message: (typeof threadMessages)[number]) => {
    if (!message.body || message.deleted_at) { toast("There is no message text to copy."); return; }
    try { await navigator.clipboard?.writeText(message.body); toast.success("Message copied"); }
    catch { toast.error("Couldn’t copy this message", { description: "Select and copy the text manually." }); }
  };
  const openForwardMessage = (message: (typeof threadMessages)[number]) => {
    if (!onSendMessage || !message.body || message.deleted_at) { toast("Only text messages can be forwarded right now.", { description: "Media forwarding needs a separate secure storage rule." }); return; }
    const choices = liveConversations.filter((conversation) => conversation.id !== selectedConversationId);
    if (!choices.length) { toast("Create another conversation before forwarding a message."); return; }
    const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
    host.innerHTML = `<section class="convo-private-label-dialog convo-forward-dialog" role="dialog" aria-modal="true" aria-label="Forward message"><button type="button" aria-label="Close forward message" class="convo-private-label-close">×</button><span class="eyebrow dark">Forward message</span><h2>Choose a<br><em>conversation.</em></h2><p>${message.body.slice(0, 160).replace(/</g, "&lt;")}</p><div class="convo-forward-list">${choices.map((conversation) => `<button type="button" data-forward-to="${conversation.id}"><strong>${conversation.name.replace(/</g, "&lt;")}</strong><small>${conversation.kind === "group" ? "Group chat" : "Direct conversation"}</small></button>`).join("")}</div></section>`;
    const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
    host.querySelectorAll<HTMLButtonElement>("[data-forward-to]").forEach((button) => button.addEventListener("click", () => { const targetId = button.dataset.forwardTo; if (!targetId) return; void onSendMessage(targetId, message.body).then((result) => { if (!result.ok) toast.error("Couldn’t forward message", { description: result.error || "Please try again." }); else { toast.success("Message forwarded"); close(); } }); }));
    document.body.appendChild(host);
  };
  const showMessageInfo = (message: (typeof threadMessages)[number]) => {
    const status = message.sender_id === currentUserId ? (message.delivery_state === "blocked" ? "Held in your chat only" : message.read_at ? `Read at ${messageTime(message.read_at)}` : "Delivered to Convo") : "Received in this chat";
    const attachment = message.attachment_mime ? message.attachment_mime.replace(/^.*\//, "").toUpperCase() : "No attachment";
    const host = document.createElement("div");
    host.className = "convo-private-label-backdrop";
    host.innerHTML = `<section class="convo-private-label-dialog convo-message-info-dialog" role="dialog" aria-modal="true" aria-label="Message information"><button type="button" aria-label="Close message information" class="convo-private-label-close">×</button><span class="eyebrow dark">Message info</span><h2>Message<br><em>details.</em></h2><dl><div><dt>Sent</dt><dd>${new Date(message.created_at).toLocaleString()}</dd></div><div><dt>Status</dt><dd>${status}</dd></div><div><dt>Attachment</dt><dd>${attachment}</dd></div>${message.edited_at ? `<div><dt>Edited</dt><dd>${new Date(message.edited_at).toLocaleString()}</dd></div>` : ""}</dl></section>`;
    const close = () => host.remove();
    host.addEventListener("click", (event) => { if (event.target === host) close(); });
    host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
    document.body.appendChild(host);
  };
  const selectGroupImage = () => {
    const role = groupMembers.find((member) => member.user_id === currentUserId)?.group_role;
    if (!activeConversation?.id || !onUpdateGroupImage || (role !== "owner" && role !== "admin")) { toast("Only a loaded group owner or admin can change this group photo."); return; }
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/png,image/jpeg,image/webp";
    input.addEventListener("change", () => {
      const image = input.files?.[0];
      if (!image) return;
      if (image.size > 5 * 1024 * 1024) { toast.error("Choose an image below 5 MB"); return; }
      void onUpdateGroupImage(activeConversation.id, image).then((result) => {
        if (!result.ok || !result.url) { toast.error("Couldn’t update group image", { description: result.error || "Please try again." }); return; }
        setGroupImageUrls((current) => ({ ...current, [activeConversation.id]: result.url as string }));
        toast.success("Group image updated");
      });
    });
    input.click();
  };
  const changeProfileAvatar = async (file: File | null) => {
    if (!file || !onUpdateAvatar) return;
    const result = await onUpdateAvatar(file);
    if (!result.ok) { toast.error("Couldn’t update profile photo", { description: result.error || "Please try another image." }); return; }
    toast.success("Profile photo updated");
  };
  const shareMyProfile = async () => { if (!studentId) { toast("Complete your profile before sharing your public student card."); return; } const profileId = studentId.trim(); try { await navigator.clipboard?.writeText(profileId); } catch { /* The message draft remains a usable fallback. */ } if (activeConversation) { setMessageDraft(`My Convo profile: ${profileId}`); composerTextareaRef.current?.focus(); toast.success("Student ID ready to send"); } else toast.success("Student ID copied", { description: "Share it with an MTU student using Convo." }); setShowThreadActions(false); };
  const archiveCurrentConversation = async () => { if (!activeConversation || !onSetConversationPreference) { toast("Conversation hiding will activate after the messaging update is applied."); return; } const result = await onSetConversationPreference(activeConversation.id, null, true); if (!result.ok) { toast.error("Couldn’t hide conversation", { description: result.error || "Please try again." }); return; } setLiveConversations((current) => current.map((conversation) => conversation.id === activeConversation.id ? { ...conversation, isArchived: true } : conversation)); setSelectedConversationId(""); setShowThreadActions(false); toast.success("Conversation hidden", { description: "Open Archived in the inbox to restore it." }); };
  const unarchiveCurrentConversation = async () => { if (!activeConversation || !onSetConversationPreference) { toast("Conversation restoring will activate after the messaging update is applied."); return; } const result = await onSetConversationPreference(activeConversation.id, null, false); if (!result.ok) { toast.error("Couldn’t restore conversation", { description: result.error || "Please try again." }); return; } setLiveConversations((current) => current.map((conversation) => conversation.id === activeConversation.id ? { ...conversation, isArchived: false } : conversation)); setShowThreadActions(false); toast.success("Conversation restored"); };
  const savePrivateLabel = async (event: React.FormEvent) => { event.preventDefault(); if (!activeConversation || !onSetConversationPreference) return; const label = privateLabelDraft.trim(); const result = await onSetConversationPreference(activeConversation.id, label || null, false); if (!result.ok) { toast.error("Couldn’t save your label", { description: result.error || "Please try again." }); return; } setLiveConversations((current) => current.map((conversation) => conversation.id === activeConversation.id ? { ...conversation, name: label || conversation.name } : conversation)); setShowPrivateLabelEditor(false); setShowThreadActions(false); toast.success("Your private label was saved"); };
  const blockCurrentStudent = async () => { if (!activeConversation?.counterpartId || !onBlockStudent) { toast("The safety update needs the latest messaging SQL before this student can be blocked from here."); return; } const result = await onBlockStudent(activeConversation.counterpartId); if (!result.ok) { toast.error("Couldn’t block student", { description: result.error || "Please try again." }); return; } setBlockedStudents((current) => current.some((student) => student.blocked_id === activeConversation.counterpartId) ? current : [...current, { blocked_id: activeConversation.counterpartId!, display_name: activeConversation.name, nickname: activeConversation.name, student_id: null, avatar_url: null, blocked_at: new Date().toISOString() }]); setMessageError(""); setShowThreadActions(false); toast.success("Student blocked", { description: "This chat and its history remain in your inbox. New messages are disabled until you unblock them." }); };
  const applyPrivateLabel = async (label: string) => { if (!activeConversation || !onSetConversationPreference) return; const normalized = label.trim(); const result = await onSetConversationPreference(activeConversation.id, normalized || null, false); if (!result.ok) { toast.error("Couldn’t save your label", { description: result.error || "Please try again." }); return; } setLiveConversations((current) => current.map((conversation) => conversation.id === activeConversation.id ? { ...conversation, name: normalized || conversation.name } : conversation)); toast.success("Your private label was saved"); };
  const openPrivateLabelDialog = () => {
    if (!activeConversation) return;
    const host = document.createElement("div");
    host.className = "convo-private-label-backdrop";
    host.innerHTML = `<form class="convo-private-label-dialog" aria-label="Rename conversation for yourself"><button type="button" aria-label="Close rename conversation" class="convo-private-label-close">×</button><span class="eyebrow dark">Private label</span><h2>Name this chat<br><em>for yourself.</em></h2><p>This does not change the other student’s public nickname.</p><label for="convo-private-label-input">Your label</label><input id="convo-private-label-input" maxlength="80" value="${activeConversation.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"><div><button type="button" class="outline-button">Cancel</button><button type="submit" class="primary-button">Save label</button></div></form>`;
    const close = () => host.remove();
    const form = host.querySelector("form") as HTMLFormElement;
    const input = host.querySelector("input") as HTMLInputElement;
    host.addEventListener("click", (event) => { if (event.target === host) close(); });
    host.querySelectorAll<HTMLButtonElement>('button[type="button"]').forEach((button) => button.addEventListener("click", close));
    form.addEventListener("submit", (event) => { event.preventDefault(); void applyPrivateLabel(input.value).finally(close); });
    document.body.appendChild(host); input.focus(); input.select();
  };
  const openReportDialog = () => {
    if (!activeConversation?.counterpartId || !onReportStudent) { toast("The safety update needs the latest messaging SQL before a report can be sent from here."); return; }
    const host = document.createElement("div");
    host.className = "convo-private-label-backdrop";
    host.innerHTML = '<form class="convo-private-label-dialog" aria-label="Report student"><button type="button" aria-label="Close report student" class="convo-private-label-close">×</button><span class="eyebrow dark">Safety report</span><h2>Tell us what<br><em>happened.</em></h2><p>Your report is private. Choose a reason so it can be reviewed appropriately.</p><label for="convo-report-reason">Reason</label><select id="convo-report-reason"><option value="Harassment or bullying">Harassment or bullying</option><option value="Spam or scam">Spam or scam</option><option value="Inappropriate content">Inappropriate content</option><option value="Impersonation">Impersonation</option><option value="Other safety concern">Other safety concern</option></select><div><button type="button" class="outline-button">Cancel</button><button type="submit" class="primary-button">Send report</button></div></form>';
    const close = () => host.remove(); const form = host.querySelector("form") as HTMLFormElement; const select = host.querySelector("select") as HTMLSelectElement;
    host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelectorAll<HTMLButtonElement>('button[type="button"]').forEach((button) => button.addEventListener("click", close));
    form.addEventListener("submit", (event) => { event.preventDefault(); void onReportStudent(activeConversation.counterpartId!, select.value).then((result) => { if (!result.ok) toast.error("Couldn’t send report", { description: result.error || "Please try again." }); else toast.success("Report received", { description: "Thank you for helping keep Convo safe." }); }).finally(close); });
    document.body.appendChild(host); select.focus();
  };
  const openGroupMembersDialog = () => {
    if (activeConversation?.kind !== "group") return;
    const selfRole = groupMembers.find((member) => member.user_id === currentUserId)?.group_role;
    const canManage = selfRole === "owner" || selfRole === "admin";
    const available = liveStudents.filter((student) => requestStates[student.id] === "connected" && !groupMembers.some((member) => member.user_id === student.id));
    const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
    const membersMarkup = groupMembers.map((member) => { const roleAction = selfRole === "owner" && member.group_role !== "owner" ? `<button type="button" data-role-member="${member.user_id}" data-next-role="${member.group_role === "admin" ? "member" : "admin"}">${member.group_role === "admin" ? "Remove admin" : "Make admin"}</button>` : ""; const removeAction = canManage && member.user_id !== currentUserId && member.group_role !== "owner" ? `<button type="button" data-remove-member="${member.user_id}" class="is-danger">Remove</button>` : ""; return `<li><span><strong>${member.display_name.replace(/</g, "&lt;")}</strong><small>${member.group_role}</small></span><div>${roleAction}${removeAction}</div></li>`; }).join("") || "<li><span><strong>Loading members…</strong></span></li>";
    const addMarkup = canManage && available.length ? `<fieldset class="convo-group-members"><legend>Add connected students</legend>${available.map((student) => `<label><input type="checkbox" name="convo-add-member" value="${student.id}"><span>${student.name.replace(/</g, "&lt;")}</span><small>${[student.programme, student.level].filter(Boolean).join(" · ")}</small></label>`).join("")}</fieldset><button type="button" class="primary-button convo-add-group-members">Add selected</button>` : "";
    host.innerHTML = `<section class="convo-private-label-dialog convo-group-members-dialog" role="dialog" aria-modal="true" aria-label="Manage group members"><button type="button" aria-label="Close group members" class="convo-private-label-close">×</button><span class="eyebrow dark">${selfRole === "owner" ? "Group owner" : selfRole === "admin" ? "Group admin" : "Members"}</span><h2>${activeConversation.name.replace(/</g, "&lt;")}</h2><p>${groupMembers.length} member${groupMembers.length === 1 ? "" : "s"} · only public nicknames are shown.</p><ul class="convo-group-member-list">${membersMarkup}</ul>${addMarkup}</section>`;
    const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
    host.querySelectorAll<HTMLButtonElement>("[data-role-member]").forEach((button) => button.addEventListener("click", () => { if (!onSetGroupMemberRole) return; const memberId = button.dataset.roleMember!; const role = button.dataset.nextRole as "admin" | "member"; void onSetGroupMemberRole(activeConversation.id, memberId, role).then((result) => { if (!result.ok) toast.error("Couldn’t update role", { description: result.error || "Please try again." }); else { setGroupMembers((current) => current.map((member) => member.user_id === memberId ? { ...member, group_role: role } : member)); close(); toast.success("Member role updated"); } }); }));
    host.querySelectorAll<HTMLButtonElement>("[data-remove-member]").forEach((button) => button.addEventListener("click", () => { if (!onRemoveGroupMember) return; const memberId = button.dataset.removeMember!; void onRemoveGroupMember(activeConversation.id, memberId).then((result) => { if (!result.ok) toast.error("Couldn’t remove member", { description: result.error || "Please try again." }); else { setGroupMembers((current) => current.filter((member) => member.user_id !== memberId)); close(); toast.success("Member removed"); } }); }));
    host.querySelector<HTMLButtonElement>(".convo-add-group-members")?.addEventListener("click", () => { if (!onAddGroupMembers) return; const ids = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="convo-add-member"]:checked')).map((input) => input.value); if (!ids.length) return; void onAddGroupMembers(activeConversation.id, ids).then((result) => { if (!result.ok) toast.error("Couldn’t add members", { description: result.error || "Please try again." }); else { toast.success(`${result.added} member${result.added === 1 ? "" : "s"} added`); close(); } }); });
    document.body.appendChild(host);
  };
  const openGroupPermissionsDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupPermissions || !onSetGroupPermissions) return;
    void onLoadGroupPermissions(activeConversation.id).then((result) => {
      if (result.error || !result.data) { toast.error("Couldn’t load group permissions", { description: result.error || "Apply the group-permissions SQL update first." }); return; }
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<form class="convo-private-label-dialog convo-group-permissions-dialog" aria-label="Group permissions"><button type="button" aria-label="Close group permissions" class="convo-private-label-close">×</button><div class="group-permissions-intro"><span class="eyebrow dark">Owner controls</span><h2>Group<br><em>permissions.</em></h2><p>Decide how this private MTU group works. Admins always retain moderation access.</p></div><div class="group-permissions-columns"><section><span class="profile-sheet-section-label">Member access</span><label class="permission-toggle"><input name="allow_messages" type="checkbox" ${result.data.allow_member_messages ? "checked" : ""}><span><strong>Members can send messages</strong><small>Turn this off for an admins-only announcement group.</small></span></label><label class="permission-toggle"><input name="allow_invites" type="checkbox" ${result.data.allow_member_invites ? "checked" : ""}><span><strong>Members can share invite links</strong><small>When off, only admins can create invitations.</small></span></label></section><section><span class="profile-sheet-section-label">Administration</span><label class="permission-toggle"><input name="require_approval" type="checkbox" ${result.data.require_join_approval ? "checked" : ""}><span><strong>Approve new members</strong><small>New links require an admin review before entry.</small></span></label><p class="group-permissions-note">Owners and admins retain moderation access through the secured group RPCs.</p></section></div><div class="group-permissions-actions"><button type="button" class="outline-button">Cancel</button><button type="submit" class="primary-button">Save permissions</button></div></form>`;
      const close = () => host.remove(); const form = host.querySelector("form") as HTMLFormElement;
      host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelectorAll<HTMLButtonElement>('button[type="button"]').forEach((button) => button.addEventListener("click", close));
      form.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(form); const permissions = { allow_member_messages: values.has("allow_messages"), allow_member_invites: values.has("allow_invites"), require_join_approval: values.has("require_approval") }; void onSetGroupPermissions(activeConversation.id, permissions).then((saved) => { if (saved.error) toast.error("Couldn’t save permissions", { description: saved.error }); else toast.success("Group permissions updated"); }).finally(close); });
      document.body.appendChild(host);
    });
  };
  const openGroupJoinRequestsDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupJoinRequests || !onReviewGroupJoinRequest) return;
    void onLoadGroupJoinRequests(activeConversation.id).then((result) => {
      if (result.error) { toast.error("Couldn’t load join requests", { description: result.error }); return; }
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      const requests = result.data;
      const rows = requests.length ? requests.map((request) => `<li data-request-id="${request.user_id}"><span><strong>${request.display_name.replace(/</g, "&lt;")}</strong><small>${request.student_id}</small></span><div><button type="button" data-decline-request="${request.user_id}" class="outline-button">Decline</button><button type="button" data-approve-request="${request.user_id}" class="primary-button">Approve</button></div></li>`).join("") : "<li><span><strong>No pending requests</strong><small>New requests will appear here.</small></span></li>";
      host.innerHTML = `<section class="convo-private-label-dialog convo-group-members-dialog" role="dialog" aria-modal="true" aria-label="Review group join requests"><button type="button" aria-label="Close group join requests" class="convo-private-label-close">×</button><span class="eyebrow dark">Private group</span><h2>Join<br><em>requests.</em></h2><p>Only public nicknames and student IDs are shown for review.</p><ul class="convo-group-member-list">${rows}</ul></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelectorAll<HTMLButtonElement>("[data-approve-request],[data-decline-request]").forEach((button) => button.addEventListener("click", () => { const userId = button.dataset.approveRequest || button.dataset.declineRequest; if (!userId) return; const approve = Boolean(button.dataset.approveRequest); void onReviewGroupJoinRequest(activeConversation.id, userId, approve).then((response) => { if (!response.ok) toast.error("Couldn’t review request", { description: response.error || "Please try again." }); else { host.querySelector(`[data-request-id="${userId}"]`)?.remove(); toast.success(approve ? "Student added to group" : "Join request declined"); } }); }));
      document.body.appendChild(host);
    });
  };
  const openConversationNotificationDialog = () => {
    if (!activeConversation || !onLoadConversationNotificationPreference || !onSetConversationNotificationPreference) return;
    void onLoadConversationNotificationPreference(activeConversation.id).then((loaded) => {
      if (loaded.error || !loaded.data) { toast.error("Couldn’t load notification settings", { description: loaded.error || "Apply the community utilities SQL first." }); return; }
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      const mutedLabel = loaded.data.is_muted ? loaded.data.muted_until ? `Muted until ${new Date(loaded.data.muted_until).toLocaleString()}` : "Muted" : "Notifications are on";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog" role="dialog" aria-modal="true" aria-label="Conversation notifications"><button type="button" aria-label="Close conversation notifications" class="convo-private-label-close">×</button><span class="eyebrow dark">Notifications</span><h2>Keep this chat<br><em>at your pace.</em></h2><p>${mutedLabel}. Muting changes only your alerts, never what you can read.</p><div class="convo-utility-actions"><button type="button" data-mute-hours="8">Mute for 8 hours</button><button type="button" data-mute-hours="168">Mute for 1 week</button><button type="button" data-mute-hours="0">Mute until I turn it on</button>${loaded.data.is_muted ? '<button type="button" data-unmute class="is-accent">Turn notifications on</button>' : ""}</div></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelectorAll<HTMLButtonElement>("[data-mute-hours]").forEach((button) => button.addEventListener("click", () => { const hours = Number(button.dataset.muteHours || 0); const until = hours ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null; void onSetConversationNotificationPreference(activeConversation.id, true, until).then((result) => { if (result.error) toast.error("Couldn’t mute conversation", { description: result.error }); else { toast.success("Conversation muted"); close(); } }); }));
      host.querySelector<HTMLButtonElement>("[data-unmute]")?.addEventListener("click", () => { void onSetConversationNotificationPreference(activeConversation.id, false, null).then((result) => { if (result.error) toast.error("Couldn’t update notifications", { description: result.error }); else { toast.success("Notifications turned on"); close(); } }); });
      document.body.appendChild(host);
    });
  };
  const openConversationAppearanceDialog = () => {
    if (!activeConversation || !onLoadConversationAppearance || !onSetConversationAppearance) return;
    void onLoadConversationAppearance(activeConversation.id).then((loaded) => {
      if (loaded.error || !loaded.data) { toast.error("Couldn’t load chat appearance", { description: loaded.error || "Apply the appearance SQL update first." }); return; }
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      const themeOptions = [["convo", "Convo Burgundy"], ["cream", "Cream"], ["peach", "Peach"], ["sage", "Sage"], ["lavender", "Lavender"], ["midnight", "Midnight"]] as const;
      const wallpaperOptions = [["plain", "Plain"], ["organic", "Organic lines"], ["campus", "Campus pattern"], ["gradient", "Soft gradient"]] as const;
      host.innerHTML = `<form class="convo-private-label-dialog convo-utility-dialog convo-appearance-dialog" aria-label="Conversation appearance"><button type="button" aria-label="Close conversation appearance" class="convo-private-label-close">×</button><span class="eyebrow dark">Chat appearance</span><h2>Make it<br><em>yours.</em></h2><p>Only you see these choices. They change the mood of this conversation without changing its privacy.</p><label>Theme<select name="chat_theme">${themeOptions.map(([value, label]) => `<option value="${value}" ${loaded.data?.chat_theme === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Wallpaper<select name="wallpaper_variant">${wallpaperOptions.map(([value, label]) => `<option value="${value}" ${loaded.data?.wallpaper_variant === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><div><button type="button" class="outline-button">Cancel</button><button type="submit" class="primary-button">Save appearance</button></div></form>`;
      const close = () => host.remove(); const form = host.querySelector("form") as HTMLFormElement;
      host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelectorAll<HTMLButtonElement>('button[type="button"]').forEach((button) => button.addEventListener("click", close));
      form.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(form); const appearance: MtuConversationAppearance = { chat_theme: String(values.get("chat_theme") || "convo") as MtuConversationAppearance["chat_theme"], wallpaper_variant: String(values.get("wallpaper_variant") || "plain") as MtuConversationAppearance["wallpaper_variant"] }; void onSetConversationAppearance(activeConversation.id, appearance).then((saved) => { if (saved.error || !saved.data) toast.error("Couldn’t save chat appearance", { description: saved.error || "Please try again." }); else { setConversationAppearance(saved.data); toast.success("Chat appearance saved"); close(); } }); });
      document.body.appendChild(host);
    });
  };
  const openSavedMessagesDialog = () => {
    if (!onLoadSavedMessages) return;
    void onLoadSavedMessages().then((loaded) => {
      if (loaded.error) { toast.error("Couldn’t load saved messages", { description: loaded.error }); return; }
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      const rows = loaded.data.length ? loaded.data.map((message) => `<button type="button" data-saved-conversation="${message.conversation_id}" data-saved-message="${message.message_id}"><strong>${message.conversation_title.replace(/</g, "&lt;")}</strong><span>${message.sender_display_name.replace(/</g, "&lt;")} · ${message.body.replace(/</g, "&lt;").slice(0, 120) || "Media attachment"}</span></button>`).join("") : "<p class=\"convo-utility-empty\">No saved messages yet. Use the bookmark action on a message to keep it here.</p>";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog" role="dialog" aria-modal="true" aria-label="Saved messages"><button type="button" aria-label="Close saved messages" class="convo-private-label-close">×</button><span class="eyebrow dark">Personal collection</span><h2>Saved<br><em>messages.</em></h2><div class="convo-utility-list">${rows}</div></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelectorAll<HTMLButtonElement>("[data-saved-conversation]").forEach((button) => button.addEventListener("click", () => { const conversationId = button.dataset.savedConversation; const messageId = button.dataset.savedMessage; if (!conversationId || !messageId) return; setSelectedConversationId(conversationId); window.setTimeout(() => document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 180); close(); }));
      document.body.appendChild(host);
    });
  };
  const openConversationSearchDialog = () => {
    if (!activeConversation || !onSearchConversationMessages) return;
    const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
    host.innerHTML = `<form class="convo-private-label-dialog convo-utility-dialog" aria-label="Search this conversation"><button type="button" aria-label="Close conversation search" class="convo-private-label-close">×</button><span class="eyebrow dark">Conversation search</span><h2>Find a message<br><em>in this chat.</em></h2><label for="convo-thread-search">Search phrase</label><input id="convo-thread-search" minlength="2" maxlength="120" placeholder="Try assignment, meeting, deadline…"><div class="convo-search-results" aria-live="polite"></div><div><button type="button" class="outline-button">Cancel</button><button type="submit" class="primary-button">Search</button></div></form>`;
    const close = () => host.remove(); const form = host.querySelector("form") as HTMLFormElement; const input = host.querySelector("input") as HTMLInputElement; const results = host.querySelector(".convo-search-results") as HTMLDivElement;
    host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelectorAll<HTMLButtonElement>('button[type="button"]').forEach((button) => button.addEventListener("click", close));
    form.addEventListener("submit", (event) => { event.preventDefault(); const query = input.value.trim(); if (query.length < 2) { results.textContent = "Use at least two characters."; return; } results.textContent = "Searching…"; void onSearchConversationMessages(activeConversation.id, query).then((loaded) => { if (loaded.error) { results.textContent = loaded.error; return; } results.innerHTML = loaded.data.length ? loaded.data.map((message) => `<button type="button" data-search-message="${message.id}"><strong>${message.sender_display_name.replace(/</g, "&lt;")}</strong><span>${message.body.replace(/</g, "&lt;")}</span><small>${messageTime(message.created_at)}</small></button>`).join("") : "No messages matched that phrase."; results.querySelectorAll<HTMLButtonElement>("[data-search-message]").forEach((button) => button.addEventListener("click", () => { const messageId = button.dataset.searchMessage; if (!messageId) return; close(); document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); })); }); });
    document.body.appendChild(host); input.focus();
  };
  const openGroupPollsDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupPolls || !onCreateGroupPoll || !onVoteOnGroupPoll) return;
    void onLoadGroupPolls(activeConversation.id).then((loaded) => {
      if (loaded.error) { toast.error("Couldn’t load group polls", { description: loaded.error }); return; }
      const grouped = Array.from(loaded.data.reduce((collection, row) => { const existing = collection.get(row.poll_id) || { ...row, options: [] as Array<typeof row> }; existing.options.push(row); collection.set(row.poll_id, existing); return collection; }, new Map<string, { poll_id: string; question: string; closes_at?: string | null; is_closed: boolean; anonymous_voters: boolean; created_by: string; options: Array<(typeof loaded.data)[number]> }>()).values());
      const pollMarkup = grouped.length ? grouped.map((poll) => { const canDelete = Boolean(onDeleteGroupPoll && (poll.created_by === currentUserId || groupMembers.some((member) => member.user_id === currentUserId && (member.group_role === "owner" || member.group_role === "admin")))); return `<article class="convo-poll-card">${canDelete ? `<button type="button" class="convo-item-delete" data-poll-delete="${poll.poll_id}" aria-label="Delete poll">×</button>` : ""}<strong>${poll.question.replace(/</g, "&lt;")}</strong><small>${poll.is_closed ? "Voting closed" : poll.closes_at ? `Closes ${new Date(poll.closes_at).toLocaleString()}` : "No deadline"}${poll.anonymous_voters ? " · private voters" : ""}</small><div>${poll.options.map((option) => `<button type="button" ${poll.is_closed ? "disabled" : ""} data-poll-id="${poll.poll_id}" data-option-id="${option.option_id}" class="${option.selected_by_me ? "is-selected" : ""}"><span>${option.option_label.replace(/</g, "&lt;")}</span><b>${option.vote_count}</b></button>`).join("")}</div></article>`; }).join("") : "<p class=\"convo-utility-empty\">No group polls yet. Create one below.</p>";
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog convo-polls-dialog" role="dialog" aria-modal="true" aria-label="Group polls"><button type="button" aria-label="Close group polls" class="convo-private-label-close">×</button><span class="eyebrow dark">Group decisions</span><h2>Polls.</h2><div class="convo-poll-list">${pollMarkup}</div><form class="convo-utility-form"><label>Question<input name="question" maxlength="240" required></label><div class="poll-option-fields" data-poll-options><label>Option 1<input name="poll_option_1" maxlength="100" required></label><label>Option 2<input name="poll_option_2" maxlength="100" required></label></div><button type="button" class="outline-button poll-add-option" data-poll-add-option>+ Add option</button><label>Closes at <input name="closes_at" type="datetime-local"></label><label class="convo-checkbox-row"><input name="anonymous" type="checkbox"> Hide voter identities</label><button type="submit" class="primary-button">Create poll</button></form></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelector("[data-poll-add-option]")?.addEventListener("click", () => { const options = host.querySelector("[data-poll-options]"); if (!options || options.querySelectorAll("input").length >= 10) return; const index = options.querySelectorAll("input").length + 1; const label = document.createElement("label"); label.innerHTML = `Option ${index}<input name="poll_option_${index}" maxlength="100" required>`; options.appendChild(label); });
      host.querySelectorAll<HTMLButtonElement>("[data-poll-id]").forEach((button) => button.addEventListener("click", () => { const pollId = button.dataset.pollId; const optionId = button.dataset.optionId; if (!pollId || !optionId) return; void onVoteOnGroupPoll(pollId, optionId).then((result) => { if (!result.ok) toast.error("Couldn’t cast vote", { description: result.error || "Please try again." }); else { close(); openGroupPollsDialog(); } }); }));
      host.querySelectorAll<HTMLButtonElement>("[data-poll-delete]").forEach((button) => button.addEventListener("click", () => { const pollId = button.dataset.pollDelete; if (!pollId || !onDeleteGroupPoll) return; void confirmItemDeletion("poll", () => onDeleteGroupPoll(pollId)).then((result) => { if (!result) return; if (!result.ok) toast.error("Couldn’t delete poll", { description: result.error || "Only the creator or a group admin can delete it." }); else { close(); openGroupPollsDialog(); } }); }));
      (host.querySelector("form") as HTMLFormElement).addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const options = Array.from(values.entries()).filter(([name, value]) => name.startsWith("poll_option_") && typeof value === "string").map(([, value]) => String(value).trim()).filter(Boolean); const deadline = String(values.get("closes_at") || ""); const closesAt = deadline ? new Date(deadline).toISOString() : null; if (options.length < 2) { toast.error("Polls need at least two options."); return; } void onCreateGroupPoll(activeConversation.id, String(values.get("question") || ""), options, closesAt, values.has("anonymous")).then((result) => { if (result.error) toast.error("Couldn’t create poll", { description: result.error }); else { toast.success("Poll created"); close(); } }); });
      document.body.appendChild(host);
    });
  };
  const openGroupTasksDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupTasks || !onCreateGroupTask || !onSetGroupTaskCompleted) return;
    void onLoadGroupTasks(activeConversation.id).then((loaded) => {
      if (loaded.error) { toast.error("Couldn’t load group tasks", { description: loaded.error }); return; }
      const tasksMarkup = loaded.data.length ? loaded.data.map((task) => { const canDelete = Boolean(onDeleteGroupTask && (task.created_by === currentUserId || groupMembers.some((member) => member.user_id === currentUserId && (member.group_role === "owner" || member.group_role === "admin")))); return `<li>${canDelete ? `<button type="button" class="convo-item-delete" data-task-delete="${task.task_id}" aria-label="Delete task">×</button>` : ""}<button type="button" data-task-id="${task.task_id}" data-task-complete="${task.completed_at ? "false" : "true"}" class="${task.completed_at ? "is-complete" : ""}" aria-label="${task.completed_at ? "Mark task incomplete" : "Mark task complete"}">${task.completed_at ? "✓" : "○"}</button><span><strong>${task.title.replace(/</g, "&lt;")}</strong><small>${task.assignee_display_name ? `For ${task.assignee_display_name.replace(/</g, "&lt;")} · ` : ""}${task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : "No deadline"}</small></span></li>`; }).join("") : "<li class=\"convo-utility-empty\">No group tasks yet.</li>";
      const assigneeOptions = [`<option value="">No assignee</option>`, ...groupMembers.map((member) => `<option value="${member.user_id}">${member.display_name.replace(/</g, "&lt;")}</option>`)].join("");
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog" role="dialog" aria-modal="true" aria-label="Group tasks"><button type="button" aria-label="Close group tasks" class="convo-private-label-close">×</button><span class="eyebrow dark">Shared work</span><h2>Group<br><em>tasks.</em></h2><ul class="convo-task-list">${tasksMarkup}</ul><form class="convo-utility-form"><label>Task<input name="title" maxlength="240" required></label><label>Assign to<select name="assignee">${assigneeOptions}</select></label><label>Due at<input name="due_at" type="datetime-local"></label><button type="submit" class="primary-button">Add task</button></form></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelectorAll<HTMLButtonElement>("[data-task-id]").forEach((button) => button.addEventListener("click", () => { const taskId = button.dataset.taskId; if (!taskId) return; const completed = button.dataset.taskComplete === "true"; void onSetGroupTaskCompleted(taskId, completed).then((result) => { if (!result.ok) toast.error("Couldn’t update task", { description: result.error || "Please try again." }); else { close(); openGroupTasksDialog(); } }); }));
      host.querySelectorAll<HTMLButtonElement>("[data-task-delete]").forEach((button) => button.addEventListener("click", () => { const taskId = button.dataset.taskDelete; if (!taskId || !onDeleteGroupTask) return; void confirmItemDeletion("task", () => onDeleteGroupTask(taskId)).then((result) => { if (!result) return; if (!result.ok) toast.error("Couldn’t delete task", { description: result.error || "Only the creator or a group admin can delete it." }); else { close(); openGroupTasksDialog(); } }); }));
      (host.querySelector("form") as HTMLFormElement).addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const rawDue = String(values.get("due_at") || ""); void onCreateGroupTask(activeConversation.id, String(values.get("title") || ""), String(values.get("assignee") || "") || null, rawDue ? new Date(rawDue).toISOString() : null).then((result) => { if (result.error) toast.error("Couldn’t create task", { description: result.error }); else { toast.success("Group task added"); close(); } }); });
      document.body.appendChild(host);
    });
  };
  const openGroupEventsDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupEvents || !onSetGroupEventResponse) return;
    void onLoadGroupEvents(activeConversation.id).then((loaded) => {
      if (loaded.error) { toast.error("Couldn’t load group events", { description: loaded.error.message }); return; }
      const esc = (value: string) => value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;" } as Record<string, string>)[character] || character);
      const eventsMarkup = loaded.data.length ? loaded.data.map((event) => { const canDelete = Boolean(onDeleteGroupEvent && (event.created_by === currentUserId || groupMembers.some((member) => member.user_id === currentUserId && (member.group_role === "owner" || member.group_role === "admin")))); return `<article class="convo-event-card">${canDelete ? `<button type="button" class="convo-item-delete" data-event-delete="${event.id}" aria-label="Delete event">×</button>` : ""}<strong>${esc(event.title)}</strong><small>${new Date(event.starts_at).toLocaleString()}${event.location ? ` · ${esc(event.location)}` : ""}</small>${event.description ? `<p>${esc(event.description)}</p>` : ""}<span>${event.going_count} going</span><div class="convo-event-response"><button type="button" data-event-id="${event.id}" data-event-response="going" class="${event.my_response === "going" ? "is-selected" : ""}">Going</button><button type="button" data-event-id="${event.id}" data-event-response="maybe" class="${event.my_response === "maybe" ? "is-selected" : ""}">Maybe</button><button type="button" data-event-id="${event.id}" data-event-response="declined" class="${event.my_response === "declined" ? "is-selected" : ""}">Can’t go</button>${onCancelGroupEvent && event.created_by === currentUserId ? `<button type="button" data-event-id="${event.id}" data-event-cancel="true">Cancel event</button>` : ""}</div></article>`; }).join("") : "<p class=\"convo-utility-empty\">No upcoming group events yet.</p>";
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog convo-events-dialog" role="dialog" aria-modal="true" aria-label="Group events"><button type="button" aria-label="Close group events" class="convo-private-label-close">×</button><span class="eyebrow dark">Shared calendar</span><h2>Group events.</h2><div class="convo-event-list">${eventsMarkup}</div>${onCreateGroupEvent ? `<form class="convo-utility-form"><label>Event name<input name="title" maxlength="160" required></label><label>Date and time<input name="starts_at" type="datetime-local" required></label><label>Location<input name="location" maxlength="240"></label><label>Description<textarea name="description" maxlength="2000" rows="3"></textarea></label><button type="submit" class="primary-button">Create event</button></form>` : ""}</section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelectorAll<HTMLButtonElement>("[data-event-id]").forEach((button) => button.addEventListener("click", () => { const eventId = button.dataset.eventId; if (!eventId) return; if (button.dataset.eventCancel && onCancelGroupEvent) { void onCancelGroupEvent(eventId).then((result) => { if (result.error) toast.error("Couldn’t cancel event", { description: result.error.message }); else { toast.success("Event cancelled"); close(); setGroupEventsVersion((version) => version + 1); } }); return; } const response = button.dataset.eventResponse as "going" | "maybe" | "declined" | undefined; if (!response) return; void onSetGroupEventResponse(eventId, response).then((result) => { if (result.error) toast.error("Couldn’t update attendance", { description: result.error.message }); else { close(); openGroupEventsDialog(); } }); }));
      host.querySelectorAll<HTMLButtonElement>("[data-event-delete]").forEach((button) => button.addEventListener("click", () => { const eventId = button.dataset.eventDelete; if (!eventId || !onDeleteGroupEvent) return; void confirmItemDeletion("event", () => onDeleteGroupEvent(eventId)).then((result) => { if (!result) return; if (!result.ok) toast.error("Couldn’t delete event", { description: result.error || "Only the creator or a group admin can delete it." }); else { close(); openGroupEventsDialog(); } }); }));
      host.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); if (!onCreateGroupEvent) return; const values = new FormData(event.currentTarget as HTMLFormElement); const rawStartsAt = String(values.get("starts_at") || ""); void onCreateGroupEvent(activeConversation.id, String(values.get("title") || ""), String(values.get("description") || ""), rawStartsAt ? new Date(rawStartsAt).toISOString() : "", String(values.get("location") || "")).then((result) => { if (result.error) toast.error("Couldn’t create event", { description: result.error.message }); else { toast.success("Event added"); setGroupEventsVersion((version) => version + 1); close(); openGroupEventsDialog(); } }); });
      document.body.appendChild(host);
    });
  };
  const openGroupNotesDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupNotes || !onCreateGroupNote) return;
    void onLoadGroupNotes(activeConversation.id).then((loaded) => {
      if (loaded.error) { toast.error("Couldn’t load shared notes", { description: loaded.error.message }); return; }
      const esc = (value: string) => value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;" } as Record<string, string>)[character] || character);
      const notesMarkup = loaded.data.length ? loaded.data.map((note) => `<article class="convo-note-card"><strong>${esc(note.title)}</strong><small>Updated ${new Date(note.updated_at).toLocaleString()}</small><p>${esc(note.body)}</p></article>`).join("") : "<p class=\"convo-utility-empty\">No shared notes yet.</p>";
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog convo-notes-dialog" role="dialog" aria-modal="true" aria-label="Shared group notes"><button type="button" aria-label="Close shared notes" class="convo-private-label-close">×</button><span class="eyebrow dark">Shared workspace</span><h2>Notes.</h2><div class="convo-note-list">${notesMarkup}</div><form class="convo-utility-form"><label>Note title<input name="title" maxlength="160" required></label><label>Note<textarea name="body" maxlength="12000" rows="5" placeholder="Write a shared note…"></textarea></label><button type="submit" class="primary-button">Save note</button></form></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); void onCreateGroupNote(activeConversation.id, String(values.get("title") || ""), String(values.get("body") || "")).then((result) => { if (result.error) toast.error("Couldn’t save note", { description: result.error.message }); else { toast.success("Note saved"); close(); openGroupNotesDialog(); } }); });
      document.body.appendChild(host);
    });
  };
  const openGroupAnnouncementsDialog = () => {
    if (activeConversation?.kind !== "group" || !onLoadGroupAnnouncements || !onCreateGroupAnnouncement) return;
    void onLoadGroupAnnouncements(activeConversation.id).then((loaded) => {
      if (loaded.error) { toast.error("Couldn’t load announcements", { description: loaded.error.message }); return; }
      const esc = (value: string) => value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;" } as Record<string, string>)[character] || character);
      const announcementsMarkup = loaded.data.length ? loaded.data.map((announcement) => { const canDelete = Boolean(onDeleteGroupAnnouncement && (announcement.created_by === currentUserId || groupMembers.some((member) => member.user_id === currentUserId && (member.group_role === "owner" || member.group_role === "admin")))); return `<article class="convo-announcement-card">${canDelete ? `<button type="button" class="convo-item-delete" data-announcement-delete="${announcement.id}" aria-label="Delete announcement">×</button>` : ""}<strong>${esc(announcement.title)}</strong><small>${new Date(announcement.publish_at).toLocaleString()}</small><p>${esc(announcement.body)}</p></article>`; }).join("") : "<p class=\"convo-utility-empty\">No active announcements.</p>";
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<section class="convo-private-label-dialog convo-utility-dialog convo-announcements-dialog" role="dialog" aria-modal="true" aria-label="Group announcements"><button type="button" aria-label="Close announcements" class="convo-private-label-close">×</button><span class="eyebrow dark">Group noticeboard</span><h2>Announcements.</h2><div class="convo-announcement-list">${announcementsMarkup}</div><form class="convo-utility-form"><label>Headline<input name="title" maxlength="160" required></label><label>Announcement<textarea name="body" maxlength="4000" rows="4" required></textarea></label><label>Expires at<input name="expires_at" type="datetime-local"></label><button type="submit" class="primary-button">Publish announcement</button></form></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
      host.querySelectorAll<HTMLButtonElement>("[data-announcement-delete]").forEach((button) => button.addEventListener("click", () => { const announcementId = button.dataset.announcementDelete; if (!announcementId || !onDeleteGroupAnnouncement) return; void confirmItemDeletion("announcement", () => onDeleteGroupAnnouncement(announcementId)).then((result) => { if (!result) return; if (!result.ok) toast.error("Couldn’t delete announcement", { description: result.error || "Only the creator or a group admin can delete it." }); else { close(); openGroupAnnouncementsDialog(); } }); }));
      host.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const rawExpiry = String(values.get("expires_at") || ""); void onCreateGroupAnnouncement(activeConversation.id, String(values.get("title") || ""), String(values.get("body") || ""), rawExpiry ? new Date(rawExpiry).toISOString() : null).then((result) => { if (result.error) toast.error("Couldn’t publish announcement", { description: result.error.message }); else { toast.success("Announcement published"); close(); openGroupAnnouncementsDialog(); } }); });
      document.body.appendChild(host);
    });
  };
  const openGroupInviteQrDialog = async () => {
    if (activeConversation?.kind !== "group" || !onCreateGroupInvite) { toast("Apply the group invitation SQL before creating a private QR invite."); return; }
    const result = await onCreateGroupInvite(activeConversation.id);
    if (result.error || !result.data) { toast.error("Couldn’t create group invite", { description: result.error || "Please try again shortly." }); return; }
    const link = groupInviteUrl(window.location.origin, result.data);
    try {
      const qrDataUrl = await QRCode.toDataURL(link, { width: 240, margin: 1, color: { dark: "#2B2A26", light: "#FBF8F0" } });
      const host = document.createElement("div"); host.className = "convo-private-label-backdrop";
      host.innerHTML = `<section class="convo-private-label-dialog convo-qr-dialog" role="dialog" aria-modal="true" aria-label="Private group QR invite"><button type="button" aria-label="Close QR invite" class="convo-private-label-close">×</button><span class="eyebrow dark">Private group invite</span><h2>Scan into<br><em>this circle.</em></h2><p>Only eligible MTU students can open this private invite. The token is not a student ID or email address.</p><div class="convo-qr-frame"><img alt="Scannable private group invite QR code" src="${qrDataUrl}"></div><div class="convo-qr-actions"><button type="button" class="outline-button" data-copy-group-invite>Copy invite link</button><button type="button" class="primary-button" data-close-group-invite>Done</button></div></section>`;
      const close = () => host.remove(); host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close); host.querySelector("[data-close-group-invite]")?.addEventListener("click", close); host.querySelector("[data-copy-group-invite]")?.addEventListener("click", async () => { try { await navigator.clipboard?.writeText(link); toast.success("Private invite link copied"); } catch { toast("Invite ready", { description: link }); } }); document.body.appendChild(host);
    } catch { toast.error("Couldn’t prepare the QR invite", { description: "Copy the private invite link instead." }); }
  };
  const openConversationProfilePanel = () => {
    if (!activeConversation) return;
    const host = document.createElement("div"); host.className = "convo-private-label-backdrop convo-conversation-profile-backdrop";
    const isGroup = activeConversation.kind === "group";
    const ownRole = groupMembers.find((member) => member.user_id === currentUserId)?.group_role;
    const isManager = ownRole === "owner" || ownRole === "admin";
    const canChangeGroupImage = Boolean(onUpdateGroupImage) && isManager;
    const safeName = activeConversation.name.replace(/</g, "&lt;");
    const directActions = `<div class="profile-sheet-utilities"><button type="button" data-copy-public-profile aria-label="Copy public student ID">Copy public student ID</button><button type="button" data-conversation-search>Search this chat</button><button type="button" data-conversation-notifications>Notifications</button><button type="button" data-conversation-appearance>Appearance</button><button type="button" data-profile-rename>Name this chat</button><button type="button" data-profile-archive>${activeConversation.isArchived ? "Unarchive from inbox" : "Archive conversation"}</button></div>${activeConversation.counterpartId && (onReportStudent || onBlockStudent) ? `<details class="profile-sheet-safety"><summary>Safety & privacy</summary><div>${onReportStudent ? '<button type="button" data-profile-report>Report student</button>' : ""}${onBlockStudent ? '<button type="button" data-profile-block class="is-danger">Block student</button>' : ""}</div></details>` : ""}`;
    const isPrivate = privateGroupIds.has(activeConversation.id);
    const groupPrivacyAction = ownRole === "owner" && onSetGroupPrivate ? `<button type="button" data-group-private>${isPrivate ? "Make group public" : "Make group private"}</button>` : "";
    const groupActions = `<div class="profile-sheet-utilities profile-sheet-utilities-group"><div class="profile-sheet-core-actions"><span class="profile-sheet-section-label">Group settings</span>${canChangeGroupImage ? '<button type="button" data-group-image>Change group photo</button>' : ""}<button type="button" data-group-members>${isManager ? "Add or manage members" : "View members"}</button>${groupPrivacyAction}<button type="button" data-conversation-notifications>Group notifications</button><button type="button" data-conversation-search>Search this chat</button><button type="button" data-group-polls>Polls</button><button type="button" data-group-tasks>Tasks</button></div><details class="profile-sheet-advanced"><summary>More group tools</summary><div><button type="button" data-group-events>Events</button><button type="button" data-group-notes>Shared notes</button><button type="button" data-group-announcements>Announcements</button><button type="button" data-group-share>Copy invite link</button><button type="button" data-group-qr>Show QR invite</button>${isManager ? '<button type="button" data-group-rotate>Rotate invite link</button><button type="button" data-group-requests>Join requests</button>' : ""}${ownRole === "owner" ? `<button type="button" data-group-permissions>Permissions</button><button type="button" data-group-end class="is-danger">End group</button>` : ""}</div></details></div>`;
    const groupImageUrl = groupImageUrls[activeConversation.id];
    const profileAvatar = groupImageUrl ? `<img class="conversation-profile-image" src="${groupImageUrl.replace(/"/g, "&quot;")}" alt="${safeName} group image">` : safeName.slice(0, 2).toUpperCase();
    const groupImageCover = isGroup && groupImageUrl ? `<div class="conversation-profile-cover" aria-hidden="true"><img src="${groupImageUrl.replace(/"/g, "&quot;")}" alt=""></div>` : "";
    const profileHeader = isGroup ? `${groupImageCover}<span class="eyebrow dark">MTU group profile</span><div class="conversation-profile-avatar">${profileAvatar}</div><h2>${safeName}</h2><p>${groupMembers.length} member${groupMembers.length === 1 ? "" : "s"} · ${ownRole ? `${ownRole} access` : "member access"}</p>` : "";
    host.innerHTML = `<section class="convo-private-label-dialog convo-conversation-profile ${isGroup && groupImageUrl ? "has-group-image" : ""} ${isGroup ? "" : "conversation-settings-sheet"}" role="dialog" aria-modal="true" aria-label="${isGroup ? "Group profile" : "Student profile"}"><button type="button" aria-label="Close conversation profile" class="convo-private-label-close">×</button>${profileHeader}<div class="conversation-profile-actions">${isGroup ? groupActions : directActions}</div></section>`;
    const close = () => host.remove();
    host.addEventListener("click", (event) => { if (event.target === host) close(); }); host.querySelector(".convo-private-label-close")?.addEventListener("click", close);
    host.querySelector<HTMLButtonElement>("[data-profile-rename]")?.addEventListener("click", () => { close(); openPrivateLabelDialog(); });
    host.querySelector<HTMLButtonElement>("[data-copy-public-profile]")?.addEventListener("click", () => { void shareMyProfile(); });
    host.querySelector<HTMLButtonElement>("[data-profile-archive]")?.addEventListener("click", () => { close(); void (activeConversation.isArchived ? unarchiveCurrentConversation() : archiveCurrentConversation()); });
    host.querySelector<HTMLButtonElement>("[data-profile-report]")?.addEventListener("click", () => { close(); openReportDialog(); });
    host.querySelector<HTMLButtonElement>("[data-profile-block]")?.addEventListener("click", () => { close(); void blockCurrentStudent(); });
    host.querySelector<HTMLButtonElement>("[data-conversation-search]")?.addEventListener("click", () => { close(); openConversationSearchDialog(); });
    host.querySelector<HTMLButtonElement>("[data-conversation-notifications]")?.addEventListener("click", () => { close(); openConversationNotificationDialog(); });
    host.querySelector<HTMLButtonElement>("[data-conversation-appearance]")?.addEventListener("click", () => { close(); openConversationAppearanceDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-members]")?.addEventListener("click", () => { close(); openGroupMembersDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-private]")?.addEventListener("click", () => {
      if (!onSetGroupPrivate) return;
      const nextPrivate = !privateGroupIds.has(activeConversation.id);
      if (!nextPrivate) {
        void onSetGroupPrivate(activeConversation.id, false).then((result) => {
          if (result.error) { toast.error("Couldn’t update group privacy", { description: result.error }); return; }
          setPrivateGroupIds((current) => { const next = new Set(current); next.delete(activeConversation.id); return next; });
          toast.success("Group is now public");
          close();
        });
        return;
      }
      const confirmHost = document.createElement("div");
      confirmHost.className = "convo-private-label-backdrop";
      confirmHost.innerHTML = `<section class="convo-private-label-dialog" role="dialog" aria-modal="true" aria-label="Make group private"><button type="button" aria-label="Close privacy dialog" class="convo-private-label-close">×</button><span class="eyebrow dark">Group privacy</span><h2>Make this group private?</h2><p>It will stop appearing in Communities and search. Current members will keep access.</p><div class="profile-sheet-actions"><button type="button" class="outline-button" data-cancel-private>Cancel</button><button type="button" class="primary-button" data-confirm-private>Make private</button></div></section>`;
      const closeConfirm = () => confirmHost.remove();
      confirmHost.addEventListener("click", (event) => { if (event.target === confirmHost) closeConfirm(); });
      confirmHost.querySelector(".convo-private-label-close")?.addEventListener("click", closeConfirm);
      confirmHost.querySelector("[data-cancel-private]")?.addEventListener("click", closeConfirm);
      confirmHost.querySelector("[data-confirm-private]")?.addEventListener("click", () => {
        void onSetGroupPrivate(activeConversation.id, true).then((result) => {
          if (result.error) { toast.error("Couldn’t update group privacy", { description: result.error }); return; }
          setPrivateGroupIds((current) => { const next = new Set(current); next.add(activeConversation.id); return next; });
          toast.success("Group is now private");
          closeConfirm();
          close();
        });
      });
      document.body.appendChild(confirmHost);
    });
    host.querySelector<HTMLButtonElement>("[data-group-image]")?.addEventListener("click", () => { close(); selectGroupImage(); });
    host.querySelector<HTMLButtonElement>("[data-group-qr]")?.addEventListener("click", () => { close(); void openGroupInviteQrDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-share]")?.addEventListener("click", () => { if (!onCreateGroupInvite) { toast("Apply the group-link SQL update before sharing this group."); return; } void onCreateGroupInvite(activeConversation.id).then(async (result) => { if (result.error || !result.data) { toast.error("Couldn’t create group link", { description: result.error || "Please try again." }); return; } const link = groupInviteUrl(window.location.origin, result.data); try { await navigator.clipboard?.writeText(link); } catch { /* Present the URL in an app toast if clipboard access is unavailable. */ } toast.success("Private group link copied", { description: "Only eligible MTU students can open it." }); }); });
    host.querySelector<HTMLButtonElement>("[data-group-events]")?.addEventListener("click", () => { close(); openGroupEventsDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-notes]")?.addEventListener("click", () => { close(); openGroupNotesDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-announcements]")?.addEventListener("click", () => { close(); openGroupAnnouncementsDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-requests]")?.addEventListener("click", () => { close(); openGroupJoinRequestsDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-permissions]")?.addEventListener("click", () => { close(); openGroupPermissionsDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-end]")?.addEventListener("click", () => {
      if (!onEndGroup || !activeConversation) return;
      void openAppConfirmation("End this group?", "All members will lose access. This cannot be undone.", "End group").then(async (confirmed) => {
        if (!confirmed || !activeConversation) return;
        const result = await onEndGroup(activeConversation.id);
        if (!result.ok) {
          toast.error("Couldn’t end group", { description: result.error || "Only the group owner can end this group." });
          return;
        }
        close();
        closeActiveThread();
        setLiveConversations((current) => current.filter((conversation) => conversation.id !== activeConversation.id));
        setActiveView("groups");
        toast.success("Group deleted");
      });
    });
    host.querySelector<HTMLButtonElement>("[data-group-polls]")?.addEventListener("click", () => { close(); openGroupPollsDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-tasks]")?.addEventListener("click", () => { close(); openGroupTasksDialog(); });
    host.querySelector<HTMLButtonElement>("[data-group-rotate]")?.addEventListener("click", () => { if (!onRotateGroupInvite) { toast("Apply the community utilities SQL before rotating invite links."); return; } void onRotateGroupInvite(activeConversation.id).then(async (result) => { if (result.error || !result.data) { toast.error("Couldn’t rotate invitation", { description: result.error || "Please try again." }); return; } const link = groupInviteUrl(window.location.origin, result.data); try { await navigator.clipboard?.writeText(link); } catch { /* The successful update remains visible in the confirmation. */ } toast.success("Invitation rotated", { description: "Old group links no longer work. The new private link was copied." }); }); });
    document.body.appendChild(host);
  };
  const openPublicConversationProfile = () => {
    if (!activeConversation?.counterpartId) return;
    const student = liveStudents.find((candidate) => candidate.id === activeConversation.counterpartId);
    const name = student?.name || activeConversation.name;
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] || character));
    const avatar = student?.avatarUrl ? `<img src="${escapeHtml(student.avatarUrl)}" alt="${escapeHtml(name)} profile photo">` : escapeHtml(student?.initials || name.slice(0, 2).toUpperCase());
    const bio = student?.bio?.trim();
    const host = document.createElement("div");
    host.className = "student-profile-backdrop conversation-public-profile-backdrop";
    host.innerHTML = `<section class="student-profile-sheet" role="dialog" aria-modal="true" aria-label="Student profile"><button class="student-profile-close" aria-label="Close profile">×</button><div class="student-profile-avatar ${escapeHtml(student?.tone || "sage")}">${avatar}</div><span class="eyebrow dark">MTU student profile</span><h2 id="conversation-student-profile-title">${escapeHtml(name)}</h2>${student?.status ? `<p class="student-profile-status">${escapeHtml(student.status)}</p>` : ""}<div class="student-profile-facts">${student?.programme ? `<div><span>Programme</span><b>${escapeHtml(student.programme)}</b></div>` : ""}${student?.department ? `<div><span>College / department</span><b>${escapeHtml(student.department)}</b></div>` : ""}${student?.level ? `<div><span>Level</span><b>${escapeHtml(student.level)}</b></div>` : ""}${bio ? `<div class="student-profile-bio"><span>Bio</span><p>${escapeHtml(bio)}</p></div>` : ""}</div><div class="student-profile-actions"><button class="outline-button" data-copy-public-profile aria-label="Copy public student ID">Copy public student ID</button><button class="outline-button" data-close-profile>Close</button></div></section>`;
    const close = () => host.remove();
    host.addEventListener("click", (event) => { if (event.target === host) close(); });
    host.querySelector(".student-profile-close")?.addEventListener("click", close);
    host.querySelector("[data-close-profile]")?.addEventListener("click", close);
    host.querySelector("[data-copy-public-profile]")?.addEventListener("click", () => { void shareMyProfile(); });
    document.body.appendChild(host);
  };
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("conversation");
    const messageId = params.get("message");
    if (!conversationId || !messageId || handledMessageLinkRef.current || !liveConversations.some((conversation) => conversation.id === conversationId)) return;
    handledMessageLinkRef.current = true;
    setSelectedConversationId(conversationId); setActiveView("messages"); window.history.replaceState({}, "", window.location.pathname);
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 260);
  }, [activeView, liveConversations]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const header = document.querySelector<HTMLElement>(".thread-header");
    if (!header) return;
    const actions = document.createElement("div"); actions.className = "thread-header-actions";
    if (activeConversation && (activeConversation.kind === "group" || activeConversation.counterpartId)) {
      const callName = activeConversation.name;
      const callDetail = { conversationId: activeConversation.id, calleeId: activeConversation.kind === "group" ? null : activeConversation.counterpartId, callType: "voice" as const, calleeName: callName, calleeAvatarUrl: activeConversation.counterpartAvatarUrl, isGroup: activeConversation.kind === "group" };
      const voiceCall = document.createElement("button");
      voiceCall.type = "button"; voiceCall.className = "thread-call-action thread-call-action-voice"; voiceCall.setAttribute("aria-label", `Voice call ${callName}`); voiceCall.title = "Voice call"; voiceCall.innerHTML = '<span class="thread-call-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.6 3.5 9 3l2 5-2.2 1.7a14 14 0 0 0 5.5 5.5L16 13l5 2 .5 2.4A2 2 0 0 1 19.6 20C11 20 4 13 4 4.4A2 2 0 0 1 6.6 3.5Z"/></svg></span>';
      const videoCall = document.createElement("button");
      videoCall.type = "button"; videoCall.className = "thread-call-action thread-call-action-video"; videoCall.setAttribute("aria-label", `Video call ${callName}`); videoCall.title = "Video call"; videoCall.innerHTML = '<span class="thread-call-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5V8l3.4-2.1A1 1 0 0 1 22 6.7v10.6a1 1 0 0 1-1.6.8L17 16v1.5a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 4 17.5v-11Z"/></svg></span>';
      voiceCall.addEventListener("click", () => window.dispatchEvent(new CustomEvent("convo:start-call", { detail: callDetail })));
      videoCall.addEventListener("click", () => window.dispatchEvent(new CustomEvent("convo:start-call", { detail: { ...callDetail, callType: "video" } })));
      actions.append(voiceCall, videoCall);
    }
    if (activeConversation) {
      const expandTrigger = document.createElement("button");
      expandTrigger.type = "button";
      expandTrigger.className = "thread-expand-trigger";
      expandTrigger.setAttribute("aria-label", isThreadExpanded ? "Collapse chat" : "Expand chat");
      expandTrigger.title = isThreadExpanded ? "Collapse chat" : "Expand chat";
      expandTrigger.textContent = isThreadExpanded ? "⤢" : "⛶";
      expandTrigger.addEventListener("click", () => setIsThreadExpanded((current) => !current));
      actions.appendChild(expandTrigger);
      const profileTrigger = document.createElement("button"); profileTrigger.type = "button"; profileTrigger.className = "thread-profile-trigger"; profileTrigger.setAttribute("aria-label", activeConversation.kind === "group" ? "Open group profile" : "Open student profile"); profileTrigger.title = "Conversation actions"; profileTrigger.textContent = "•••"; profileTrigger.addEventListener("click", openConversationProfilePanel); actions.appendChild(profileTrigger);
    }
    header.querySelector(".thread-header-actions")?.remove();
    header.appendChild(actions);
    return () => actions.remove();
  }, [activeConversation?.counterpartId, activeConversation?.id, activeConversation?.kind, activeConversation?.name, activeConversation?.isArchived, activeView, groupMembers, onBlockStudent, onReportStudent, onEndGroup, selectedConversationId, isThreadExpanded]);
  React.useEffect(() => {
    if (activeView !== "messages" || !activeConversation) return;
    const header = document.querySelector<HTMLElement>(".thread-header");
    if (!header) return;
    header.querySelector(".thread-close-action")?.remove();
    const close = document.createElement("button"); close.type = "button"; close.className = "thread-close-action"; close.setAttribute("aria-label", "Close conversation"); close.textContent = "×"; close.addEventListener("click", closeActiveThread); header.appendChild(close);
    return () => close.remove();
  }, [activeConversation?.id, activeView]);
  React.useEffect(() => {
    if (activeView !== "messages" || !onLoadSavedMessages) return;
    const list = document.querySelector<HTMLElement>(".conversation-list");
    if (!list) return;
    list.querySelector(".convo-saved-messages-trigger")?.remove();
    const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "convo-saved-messages-trigger"; trigger.setAttribute("aria-label", "Open saved messages"); trigger.textContent = "Saved messages"; trigger.addEventListener("click", openSavedMessagesDialog); list.querySelector(".conversation-search")?.after(trigger);
    return () => trigger.remove();
  }, [activeView, onLoadSavedMessages]);
  React.useEffect(() => {
    if (activeView !== "profile") return;
    const row = document.querySelector<HTMLElement>(".profile-id-row");
    if (!row) return;
    row.querySelector(".convo-profile-share-trigger")?.remove();
    const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "text-link convo-profile-share-trigger"; trigger.setAttribute("aria-label", "Copy public student ID"); trigger.textContent = "Copy ID"; trigger.addEventListener("click", () => { void shareMyProfile(); }); row.append(trigger);
    return () => trigger.remove();
  }, [activeView, studentId]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const panel = document.querySelector<HTMLElement>(".thread-panel");
    if (!panel) return;
    panel.querySelectorAll(".message-interaction-actions").forEach((node) => node.remove());
    threadMessages.forEach((message) => {
      const bubble = panel.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`);
      if (!bubble || message.deleted_at) return;
      const actions = document.createElement("div"); actions.className = "message-interaction-actions";
      const react = document.createElement("button"); react.type = "button"; react.setAttribute("aria-label", "React to message"); react.textContent = "☺";
      react.addEventListener("click", () => { actions.querySelector(".compact-reaction-picker")?.remove(); const picker = document.createElement("span"); picker.className = "compact-reaction-picker"; ["❤️", "😂", "👍", "🔥", "😮", "😢"].forEach((emoji) => { const option = document.createElement("button"); option.type = "button"; option.setAttribute("aria-label", `React ${emoji}`); option.textContent = emoji; option.addEventListener("click", () => { void toggleReaction(message.id, emoji); picker.remove(); }); picker.append(option); }); actions.append(picker); });
      const more = document.createElement("button"); more.type = "button"; more.setAttribute("aria-label", "More message actions"); more.textContent = "•••";
      const reply = document.createElement("button"); reply.type = "button"; reply.className = "message-quick-reply"; reply.setAttribute("aria-label", "Reply to message"); reply.textContent = "↩";
      reply.addEventListener("click", () => { setReplyingTo(message); composerTextareaRef.current?.focus(); });
      const openMenu = () => {
        actions.querySelector(".compact-message-menu")?.remove();
        const menu = document.createElement("span"); menu.className = "compact-message-menu";
        const canManage = message.sender_id === currentUserId && !message.deleted_at && Date.now() - Date.parse(message.created_at) < 15 * 60 * 1000;
        const isPinned = Boolean(messageInteractions[message.id]?.pinned);
        const entries: Array<[string, () => void]> = [
          ["Reply", () => { setReplyingTo(message); composerTextareaRef.current?.focus(); }],
          [message.reply_to_id ? "View 1 Reply" : "Forward", () => message.reply_to_id ? bubble.scrollIntoView({ behavior: "smooth", block: "center" }) : openForwardMessage(message)],
          [isPinned ? "Unpin" : "Pin", () => {
            if (!onTogglePinnedMessage || !activeConversation) return;
            void onTogglePinnedMessage(activeConversation.id, message.id).then((result) => {
              if (!result.ok) { toast.error("Couldn’t update pinned message", { description: result.error || "Please try again." }); return; }
              setMessageInteractions((current) => ({ ...current, [message.id]: { ...(current[message.id] || { reactions: [], saved: false, pinned: false }), pinned: result.active } }));
            });
          }],
          ["Copy", () => void copyMessageText(message)],
          [message.attachment_url ? "Save to device" : (messageInteractions[message.id]?.saved ? "Unsave" : "Save"), () => message.attachment_url ? void saveAttachmentToDevice(message.attachment_url, message.attachment_path?.split("/").pop() || "convo-attachment") : void toggleSaved(message.id)],
          ["Report", () => openReportDialog()],
          ["Select", () => { const selection = window.getSelection(); selection?.removeAllRanges(); const range = document.createRange(); range.selectNodeContents(bubble); selection?.addRange(range); }],
          ["Info", () => showMessageInfo(message)]
        ];
        if (canManage) entries.push(["Edit", () => startEditingMessage(message)], ["Delete", () => void removeMessage(message.id)]);
        entries.forEach(([label, handler]) => { const option = document.createElement("button"); option.type = "button"; option.textContent = label; option.addEventListener("click", () => { handler(); menu.remove(); }); menu.append(option); });
        actions.append(menu);
      };
      more.addEventListener("click", openMenu);
      bubble.addEventListener("contextmenu", (event) => { event.preventDefault(); openMenu(); });
      actions.append(reply, react, more); bubble.appendChild(actions);
    });
    return () => panel.querySelectorAll(".message-interaction-actions").forEach((node) => node.remove());
  }, [activeView, currentUserId, liveConversations, messageInteractions, selectedConversationId, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const panel = document.querySelector<HTMLElement>(".thread-panel");
    if (!panel) return;
    panel.querySelectorAll(".message-reply-context,.message-reaction-summary,.message-author-line,.message-pin-indicator").forEach((node) => node.remove());
    threadMessages.forEach((message) => {
      const bubble = panel.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`);
      if (!bubble || message.deleted_at) return;
      if (activeConversation?.kind === "group") {
        const member = groupMembers.find((candidate) => candidate.user_id === message.sender_id);
        const name = message.sender_id === currentUserId ? "You" : (member?.display_name || "Group member");
        const author = document.createElement("div"); author.className = "message-author-line";
        const avatar = member?.avatar_url ? `<img src="${member.avatar_url.replace(/"/g, "&quot;")}" alt="">` : name.slice(0, 2).toUpperCase();
        author.innerHTML = `<span class="message-author-avatar" aria-hidden="true">${avatar}</span><strong>${name.replace(/</g, "&lt;")}</strong>`;
        bubble.prepend(author);
      }
      if (message.reply_body) {
        const reply = document.createElement("button"); reply.type = "button"; reply.className = "message-reply-context"; reply.setAttribute("aria-label", "View replied message");
        reply.innerHTML = `<strong>${message.reply_sender_id === currentUserId ? "You" : "Reply"}</strong><span>${message.reply_body.slice(0, 110).replace(/</g, "&lt;")}</span>`;
        reply.addEventListener("click", () => panel.querySelector<HTMLElement>(`[data-message-id="${message.reply_to_id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })); bubble.prepend(reply);
      }
      if (messageInteractions[message.id]?.pinned) {
        const pin = document.createElement("span"); pin.className = "message-pin-indicator"; pin.setAttribute("aria-label", "Pinned message"); pin.textContent = "📌";
        bubble.appendChild(pin);
      }
      const reactions = messageInteractions[message.id]?.reactions || [];
      if (reactions.length) { const summary = document.createElement("div"); summary.className = "message-reaction-summary"; reactions.forEach((reaction) => { const button = document.createElement("button"); button.type = "button"; button.className = reaction.reacted ? "is-reacted" : ""; button.setAttribute("aria-label", `Toggle reaction ${reaction.emoji}`); button.textContent = `${reaction.emoji} ${reaction.count}`; button.addEventListener("click", () => void toggleReaction(message.id, reaction.emoji)); summary.appendChild(button); }); bubble.appendChild(summary); }
    });
    return () => panel.querySelectorAll(".message-reply-context,.message-reaction-summary").forEach((node) => node.remove());
  }, [activeConversation?.kind, activeView, currentUserId, groupMembers, messageInteractions, selectedConversationId, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const composer = document.querySelector<HTMLElement>(".message-composer");
    if (!composer) return;
    composer.querySelector(".reply-draft-context")?.remove();
    if (!replyingTo) return;
    const context = document.createElement("div"); context.className = "reply-draft-context";
    const replyText = replyingTo.body.length > 90 ? `${replyingTo.body.slice(0, 90)}…` : replyingTo.body;
    context.innerHTML = `<span>Replying to <strong>${replyingTo.sender_id === currentUserId ? "yourself" : "message"}</strong><small>${replyText.replace(/</g, "&lt;")}</small></span><button type="button" aria-label="Cancel reply">×</button>`;
    context.querySelector("button")?.addEventListener("click", () => setReplyingTo(null)); composer.prepend(context);
    return () => context.remove();
  }, [activeView, currentUserId, replyingTo]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const composer = document.querySelector<HTMLElement>(".message-composer");
    if (!composer) return;
    composer.querySelector(".group-mention-suggestions")?.remove();
    if (!mentionSuggestions.length) return;
    const panel = document.createElement("div"); panel.className = "group-mention-suggestions"; panel.setAttribute("role", "listbox"); panel.setAttribute("aria-label", "Group member mentions");
    mentionSuggestions.forEach((member) => { const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "option"); button.innerHTML = `<strong>@${member.display_name.replace(/</g, "&lt;")}</strong><small>${member.group_role}</small>`; button.addEventListener("mousedown", (event) => event.preventDefault()); button.addEventListener("click", () => insertMention(member.display_name)); panel.appendChild(button); });
    composer.appendChild(panel);
    return () => panel.remove();
  }, [activeView, mentionSuggestions]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const input = document.querySelector<HTMLInputElement>(".composer-file-input");
    const menu = document.querySelector<HTMLElement>(".composer-media-panel");
    if (!input || !menu) return;
    menu.querySelectorAll(".composer-video-action").forEach((node) => node.remove());
    const imageAction = menu.querySelector<HTMLButtonElement>('[aria-label="Choose image attachment"]');
    const resetImage = () => { input.accept = "image/png,image/jpeg,image/webp,image/gif"; input.removeAttribute("capture"); };
    imageAction?.addEventListener("click", resetImage);
    const openVideo = () => { input.accept = "video/mp4,video/webm,video/quicktime"; input.removeAttribute("capture"); input.click(); };
    const video = document.createElement("button"); video.type = "button"; video.className = "composer-video-action"; video.setAttribute("aria-label", "Choose video attachment"); video.innerHTML = '<span class="composer-media-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg></span><span>Video</span>'; video.addEventListener("click", openVideo);
    const record = document.createElement("button"); record.type = "button"; record.className = "composer-video-action"; record.setAttribute("aria-label", "Record video attachment"); record.innerHTML = '<span class="composer-media-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/></svg></span><span>Record video</span>'; record.addEventListener("click", openVideoRecorder);
    const voice = document.createElement("button"); voice.type = "button"; voice.className = "composer-video-action"; voice.setAttribute("aria-label", "Record voice message"); voice.innerHTML = '<span class="composer-media-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6"/></svg></span><span>Voice</span>'; voice.addEventListener("click", openVoiceRecorder);
    menu.append(video, record, voice);
    return () => { imageAction?.removeEventListener("click", resetImage); video.removeEventListener("click", openVideo); record.removeEventListener("click", openVideoRecorder); voice.removeEventListener("click", openVoiceRecorder); video.remove(); record.remove(); voice.remove(); };
  }, [activeView, openVideoRecorder, openVoiceRecorder, showMediaMenu]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const composer = document.querySelector<HTMLElement>(".message-composer");
    if (!composer) return;
    composer.querySelector(".composer-format-toolbar")?.remove();
    const toolbar = document.createElement("div"); toolbar.className = "composer-format-toolbar"; toolbar.setAttribute("aria-label", "Message formatting"); toolbar.style.setProperty("display", "flex", "important");
    [["Bold", "**", "**"], ["Italic", "_", "_"], ["Code", "`", "`"]].forEach(([label, prefix, suffix]) => { const button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-label", `Format ${label}`); button.textContent = label === "Bold" ? "B" : label === "Italic" ? "I" : "</>"; button.addEventListener("click", () => applyComposerWrapper(prefix, suffix)); toolbar.appendChild(button); });
    composer.appendChild(toolbar); return () => toolbar.remove();
  }, [activeView]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const composer = document.querySelector<HTMLElement>(".message-composer");
    if (!composer) return;
    composer.querySelector(".composer-command-suggestions")?.remove();
    if (!commandSuggestions.length) return;
    const panel = document.createElement("div"); panel.className = "composer-command-suggestions"; panel.setAttribute("role", "listbox"); panel.setAttribute("aria-label", "Text commands");
    commandSuggestions.forEach(([command, details]) => { const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "option"); button.innerHTML = `<strong>${command}</strong><small>${details.label}</small>`; button.addEventListener("mousedown", (event) => event.preventDefault()); button.addEventListener("click", () => applyTextCommand(details.value)); panel.appendChild(button); });
    composer.appendChild(panel); return () => panel.remove();
  }, [activeView, commandSuggestions]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const panel = document.querySelector<HTMLElement>(".thread-panel");
    if (!panel) return;
    threadMessages.filter((message) => Boolean(message.attachment_url) && message.attachment_mime?.startsWith("video/")).forEach((message) => {
      const bubble = panel.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`);
      if (!bubble || bubble.querySelector("video.message-attachment")) return;
      const image = bubble.querySelector("img.message-attachment"); const video = document.createElement("video"); video.className = "message-attachment"; video.controls = true; video.preload = "metadata"; video.src = message.attachment_url || ""; video.setAttribute("aria-label", "Video attachment");
      if (image) image.replaceWith(video); else bubble.appendChild(video);
    });
  }, [activeView, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const panel = document.querySelector<HTMLElement>(".thread-panel");
    if (!panel) return;
    const tokenPattern = /(https?:\/\/[^\s]+|\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
    threadMessages.forEach((message) => {
      if (message.deleted_at) return;
      const bubble = panel.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`); const body = Array.from(bubble?.children || []).find((child) => child.tagName === "SPAN") as HTMLSpanElement | undefined;
      if (!body || body.dataset.formatted === "true") return;
      const fragment = document.createDocumentFragment(); let cursor = 0; let match: RegExpExecArray | null;
      while ((match = tokenPattern.exec(message.body)) !== null) { if (match.index > cursor) fragment.append(document.createTextNode(message.body.slice(cursor, match.index))); const token = match[0]; if (token.startsWith("http")) { try { const url = new URL(token); if (url.protocol === "https:" || url.protocol === "http:") { const link = document.createElement("a"); link.href = url.toString(); link.target = "_blank"; link.rel = "noreferrer noopener"; link.textContent = token; fragment.append(link); } else fragment.append(document.createTextNode(token)); } catch { fragment.append(document.createTextNode(token)); } } else { const node = document.createElement(token.startsWith("**") ? "strong" : token.startsWith("_") ? "em" : "code"); node.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1); fragment.append(node); } cursor = match.index + token.length; }
      if (cursor < message.body.length) fragment.append(document.createTextNode(message.body.slice(cursor))); body.replaceChildren(fragment); body.dataset.formatted = "true";
    });
  }, [activeView, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const panel = document.querySelector<HTMLElement>(".thread-panel");
    if (!panel) return;
    const senderPalette = new Map<string, number>(); let nextColor = 0;
    threadMessages.forEach((message) => {
      const bubble = panel.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`); if (!bubble) return;
      if (message.sender_id === currentUserId) { bubble.dataset.participant = "self"; return; }
      if (!senderPalette.has(message.sender_id)) { senderPalette.set(message.sender_id, nextColor % 4); nextColor += 1; }
      bubble.dataset.participant = String(senderPalette.get(message.sender_id));
    });
  }, [activeView, currentUserId, threadMessages]);
  React.useEffect(() => {
    if (activeView !== "messages") return;
    const layout = document.querySelector<HTMLElement>(".conversation-layout");
    if (!layout || !activeConversation) return;
    layout.querySelector(".conversation-context-panel")?.remove();
    const context = document.createElement("aside"); context.className = "conversation-context-panel"; context.setAttribute("aria-label", "Conversation details");
    const eyebrow = document.createElement("span"); eyebrow.className = "eyebrow dark"; eyebrow.textContent = activeConversation.kind === "group" ? "Group context" : "Conversation";
    const title = document.createElement("h3"); title.textContent = activeConversation.name;
    const meta = document.createElement("p"); meta.textContent = activeConversation.kind === "group" ? `${groupMembers.length} member${groupMembers.length === 1 ? "" : "s"} in this private MTU group.` : "Only public student identity is shown in this direct conversation.";
    context.append(eyebrow, title, meta);
    if (activeConversation.kind === "group") { const members = document.createElement("button"); members.type = "button"; members.className = "context-primary-action"; members.textContent = "Open group profile"; members.addEventListener("click", openConversationProfilePanel); context.append(members); }
    const pinned = Object.entries(messageInteractions).filter(([, interaction]) => interaction.pinned).map(([messageId]) => threadMessages.find((message) => message.id === messageId)).filter((message): message is NonNullable<typeof message> => Boolean(message));
    const pinnedSection = document.createElement("section"); pinnedSection.className = "context-pins"; const pinnedTitle = document.createElement("strong"); pinnedTitle.textContent = "Pinned here"; pinnedSection.append(pinnedTitle);
    if (pinned.length) pinned.forEach((message) => { const item = document.createElement("button"); item.type = "button"; item.textContent = message.body || "Media attachment"; item.addEventListener("click", () => document.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })); pinnedSection.append(item); }); else { const empty = document.createElement("small"); empty.textContent = "No pinned messages yet."; pinnedSection.append(empty); }
    context.append(pinnedSection); layout.append(context); return () => context.remove();
  }, [activeConversation?.id, activeConversation?.kind, activeConversation?.name, activeView, groupMembers, messageInteractions, threadMessages]);
  const refreshUnreadBelow = () => { const element = threadViewportRef.current; if (!element) return; const distance = element.scrollHeight - element.scrollTop - element.clientHeight; const isAway = distance > 72; setIsThreadAway(distance > 72); if (!isAway) { setUnreadBelow(0); return; } const boundary = element.getBoundingClientRect().bottom; const belowIds = new Set(Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]")).filter((node) => node.getBoundingClientRect().top > boundary).map((node) => node.dataset.messageId)); setUnreadBelow(threadMessages.filter((message) => message.sender_id !== currentUserId && belowIds.has(message.id)).length); };
  React.useEffect(() => { if (!isThreadAway) return; const frame = window.requestAnimationFrame(refreshUnreadBelow); return () => window.cancelAnimationFrame(frame); }, [threadMessages, isThreadAway]);
  const handleThreadScroll = (event: React.UIEvent<HTMLDivElement>) => { const element = event.currentTarget; const distance = element.scrollHeight - element.scrollTop - element.clientHeight; threadNearBottomRef.current = distance <= 72; setIsThreadAway(distance > 72); if (distance <= 72) { setUnreadBelow(0); return; } const boundary = element.getBoundingClientRect().bottom; const belowIds = new Set(Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]")).filter((node) => node.getBoundingClientRect().top > boundary).map((node) => node.dataset.messageId)); setUnreadBelow(threadMessages.filter((message) => message.sender_id !== currentUserId && belowIds.has(message.id)).length); };
  const jumpToLatest = () => { threadNearBottomRef.current = true; threadViewportRef.current?.scrollTo({ top: threadViewportRef.current.scrollHeight, behavior: "smooth" }); setIsThreadAway(false); setUnreadBelow(0); };
  const updateConversationRail = async (conversationId: string, patch: { pinned?: boolean; archived?: boolean; markUnread?: boolean }) => {
    const previous = liveConversations.find((conversation) => conversation.id === conversationId);
    if (!previous) return;
    const next = { ...previous, isPinned: patch.pinned ?? previous.isPinned, isArchived: patch.archived ?? previous.isArchived, isMarkedUnread: patch.markUnread ?? previous.isMarkedUnread };
    setLiveConversations((current) => current.map((conversation) => conversation.id === conversationId ? next : conversation));
    if (!onSetConversationRailState) { toast("This rail preference will save when the live conversation schema is connected."); return; }
    const result = await onSetConversationRailState(conversationId, patch.pinned ?? null, patch.archived ?? null, null, patch.markUnread ?? null);
    if (result.error) {
      setLiveConversations((current) => current.map((conversation) => conversation.id === conversationId ? previous : conversation));
      toast.error("We couldn’t update this conversation", { description: result.error });
      return;
    }
    toast.success(patch.archived !== undefined ? (patch.archived ? "Conversation archived" : "Conversation restored") : patch.pinned !== undefined ? (patch.pinned ? "Conversation pinned" : "Conversation unpinned") : patch.markUnread !== undefined ? (patch.markUnread ? "Marked unread" : "Marked read") : "Conversation updated");
  };

  React.useEffect(() => { const handleEscape = (event: KeyboardEvent) => { if (event.key !== "Escape") return; setShowMoreMenu(false); setShowEmojiPicker(false); setShowMediaMenu(false); setShowLogoutConfirm(false); setShowGroupComposer(false); setShowCameraCapture(false); setShowVideoRecorder(false); setShowVoiceRecorder(false); setReplyingTo(null); setIsThreadExpanded(false); document.querySelectorAll<HTMLElement>(".convo-private-label-backdrop,.convo-group-composer-backdrop").forEach((node) => node.remove()); }; window.addEventListener("keydown", handleEscape); return () => window.removeEventListener("keydown", handleEscape); }, []);
  const resetThreadWorkspace = (nextConversationId = "") => {
    setMessageError("");
    setThreadMessages([]);
    setMessageInteractions({});
    setReplyingTo(null);
    setMessageDraft("");
    setAttachmentFile(null);
    setOpenMessageMenuId("");
    setEditingMessageId("");
    setEditingDraft("");
    threadNearBottomRef.current = true;
    setUnreadBelow(0);
    setIsThreadAway(false);
    setIsThreadExpanded(false);
    setShowMediaMenu(false);
    setShowEmojiPicker(false);
    setSelectedConversationId(nextConversationId);
  };
  React.useEffect(() => {
    if (activeView !== "messages" || !selectedConversationId) return;
    const closeConversationOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") resetThreadWorkspace();
    };
    window.addEventListener("keydown", closeConversationOnEscape);
    return () => window.removeEventListener("keydown", closeConversationOnEscape);
  }, [activeView, selectedConversationId]);
  const closeActiveThread = () => resetThreadWorkspace();
  const selectConversation = (conversationId: string) => resetThreadWorkspace(conversationId);
  React.useEffect(() => {
    if (activeView === "messages" || activeView === "events" || activeView === "files") return;
    resetThreadWorkspace();
    document.querySelectorAll<HTMLElement>(".convo-conversation-profile-backdrop,.convo-private-label-backdrop").forEach((node) => node.remove());
  }, [activeView]);
  const renderMessages = () => {
    const submitOnEnter = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      void sendMessage(event as unknown as React.FormEvent);
    };
    const filters: Array<{ id: typeof conversationFilter; label: string }> = [{ id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "people", label: "People" }, { id: "groups", label: "Groups" }, { id: "archived", label: "Archived" }];
    const renderConversationAvatar = (conversation: typeof liveConversations[number], clickable = false) => {
      const imageUrl = conversation.kind === "group" ? conversation.groupImageUrl : conversation.counterpartAvatarUrl;
      const imageKey = `${conversation.id}:${imageUrl || ""}`;
      const imageLoading = Boolean(imageUrl) && !loadedAvatarImages[imageKey];
      const isOnline = conversation.kind !== "group" && ((conversation.counterpartId ? onlineUserIds.includes(conversation.counterpartId) : false) || (Boolean(typingUserId) && conversation.counterpartId === typingUserId));
      const avatar = <span className={`conversation-avatar ${conversation.tone} ${isOnline ? "is-online" : ""}`} title={isOnline ? "Active now" : "Offline or inactive"}>{imageLoading && <span className="conversation-avatar-skeleton" aria-hidden="true" />}{imageUrl ? <img className={loadedAvatarImages[imageKey] ? "is-loaded" : ""} src={imageUrl} alt="" onLoad={() => setLoadedAvatarImages((current) => current[imageKey] ? current : { ...current, [imageKey]: true })} /> : <span>{conversation.name.slice(0, 2).toUpperCase()}</span>}<i aria-label={isOnline ? "Online now" : "Offline"} /></span>;
      return clickable ? <button type="button" className="thread-header-avatar-button" aria-label={imageUrl ? `View larger image for ${conversation.name}` : conversation.kind === "group" ? "Open group profile" : `Open profile for ${conversation.name}`} onClick={() => imageUrl ? setLargeHeaderImage({ url: imageUrl, name: conversation.name }) : conversation.kind === "group" ? openConversationProfilePanel() : openPublicConversationProfile()}>{avatar}</button> : avatar;
    };
    return <><section className={`workspace-view messages-view ${selectedConversationId ? "has-thread" : "has-list"} ${isThreadExpanded ? "is-thread-expanded" : ""}`}><div className="conversation-layout"><aside className="conversation-list"><div className="messages-list-heading"><div><span className="eyebrow dark">Convo inbox</span><h2>Messages</h2></div><div className="messages-list-actions"><button type="button" aria-label="New message" onClick={() => setActiveView("discover")}><MessageCircle size={15} /></button><button type="button" aria-label="New group" onClick={() => setShowGroupComposer(true)}><Users size={15} /></button></div></div><div className="conversation-search"><Search size={16} /><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></div><nav className="conversation-filters" aria-label="Conversation filters" role="tablist">{filters.map((filter) => <button type="button" role="tab" aria-selected={conversationFilter === filter.id} className={conversationFilter === filter.id ? "is-active" : ""} key={filter.id} onClick={() => setConversationFilter(filter.id)}>{filter.label}</button>)}</nav>{conversationRows.length ? conversationRows.map((conversation) => <div className={`conversation-row-wrap ${conversation.id === selectedConversationId ? "is-active" : ""}`} key={conversation.id}><button className={`conversation-row ${conversation.id === selectedConversationId ? "is-active" : ""}`} onClick={() => { setSelectedConversationId(conversation.id); if (conversation.isMarkedUnread) void updateConversationRail(conversation.id, { markUnread: false }); }}>{renderConversationAvatar(conversation)}<span><b>{conversation.name}{conversation.isPinned && <Pin size={10} aria-label="Pinned" />}</b><small>{conversation.meta}{conversation.mutedUntil ? " · Muted" : ""}</small><p className={conversation.draftBody ? "has-draft" : ""}>{conversation.draftBody ? `Draft: ${conversation.draftBody}` : conversation.message}</p></span>{conversation.unread && <strong>{conversation.unread}</strong>}</button><button type="button" className="conversation-row-mark" aria-label={conversation.isMarkedUnread ? "Mark conversation read" : "Mark conversation unread"} onClick={(event) => { event.stopPropagation(); void updateConversationRail(conversation.id, { markUnread: !conversation.isMarkedUnread }); }}>{conversation.isMarkedUnread ? <MailOpen size={12} /> : <span aria-hidden="true">•</span>}</button><button type="button" className="conversation-row-pin" aria-label={conversation.isPinned ? "Unpin conversation" : "Pin conversation"} onClick={(event) => { event.stopPropagation(); void updateConversationRail(conversation.id, { pinned: !conversation.isPinned }); }}><Pin size={12} /></button></div>) : <div className="conversation-list-empty"><MessageCircle size={17} /><span>{conversationFilter === "archived" ? "No archived conversations" : conversationSearch ? "No conversations match that search" : "No conversations in this view"}</span></div>}</aside><section className="thread-panel" ref={threadViewportRef} onScroll={handleThreadScroll}><header className="thread-header"><button type="button" className="thread-mobile-back" aria-label="Back to conversations" onClick={() => setSelectedConversationId("")}><ChevronRight size={15} /></button>{activeConversation ? renderConversationAvatar(activeConversation, true) : <span className="conversation-avatar rose"><span>M</span><i /></span>}    <button type="button" className="thread-header-identity" onClick={activeConversation?.kind === "group" ? openConversationProfilePanel : openPublicConversationProfile} aria-label={`Open profile for ${activeConversation?.name || "conversation"}`}><h2>{activeConversation?.name || "Messages"}</h2><p>{typingUserId && typingUserId !== currentUserId ? "Typing…" : activeConversation?.kind === "direct" ? (activeConversation.counterpartId && onlineUserIds.includes(activeConversation.counterpartId) ? "Active now" : activeConversation.counterpartLastSeenAt ? `Last seen ${new Date(activeConversation.counterpartLastSeenAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Offline or inactive") : activeConversation?.meta || "Choose a conversation"}</p></button></header>{!activeConversation &&     <div className="thread-blank-state"><span className="empty-chat-bubble" aria-hidden="true"><MessageCircle size={34} /></span><span>Choose a conversation from the left.</span></div>}{groupedThreadMessages.map(([dateKey, messages]) => <React.Fragment key={dateKey}><div className="thread-date-divider"><span>{messageDateLabel(messages[0]?.created_at || dateKey)}</span></div>{messages.map((message) => { const seen = Boolean(message.read_at); const canManage = message.sender_id === currentUserId && !message.deleted_at && Date.now() - Date.parse(message.created_at) < 15 * 60 * 1000; const canModerate = activeConversation?.kind === "group" && message.sender_id !== currentUserId && !message.deleted_at && groupMembers.some((member) => member.user_id === currentUserId && (member.group_role === "owner" || member.group_role === "admin")); return <div className={`thread-message ${message.sender_id === currentUserId ? "is-own" : ""}`} data-message-id={message.id} key={message.id}><span>{message.deleted_at ? "Message deleted" : message.body}</span>{message.attachment_url && !message.deleted_at && (message.attachment_mime?.startsWith("video/") ? <video className="message-attachment message-video-attachment" src={message.attachment_url} controls playsInline preload="metadata" aria-label="Video attachment" /> : message.attachment_mime?.startsWith("audio/") ? <audio className="message-audio-attachment" src={message.attachment_url} controls preload="metadata" aria-label="Voice message" /> : message.attachment_mime?.startsWith("image/") ? <img className="message-attachment" src={message.attachment_url} alt="Image attachment" loading="lazy" /> : <a className="message-file-attachment" href={message.attachment_url} target="_blank" rel="noreferrer"><FileText size={15} /><span>Open shared file</span><ArrowRight size={13} /></a>)}{editingMessageId === message.id ? <form className="inline-edit-form" onSubmit={saveEditedMessage}><input value={editingDraft} onChange={(event) => setEditingDraft(event.target.value)} aria-label="Edit message" autoFocus /><button type="submit" aria-label="Save edited message"><Check size={14} /></button></form> : <small>{messageTime(message.created_at)}{message.edited_at ? " · Edited" : ""}{message.sender_id === currentUserId ? ` · ${seen ? "Seen" : "Sent"}` : ""}</small>}{(canManage || canModerate) && editingMessageId !== message.id && <span className="message-actions">{canManage && <><button type="button" onClick={() => startEditingMessage(message)} aria-label="Edit message"><Pencil size={12} /></button><button type="button" onClick={() => void removeMessage(message.id)} aria-label="Delete message"><Trash2 size={12} /></button></>}{canModerate && <button type="button" onClick={() => void moderateGroupMessage(message.id)} aria-label="Remove member message"><Trash2 size={12} /></button>}</span>}</div>; })}</React.Fragment>)}{typingUserId && typingUserId !== currentUserId && <div className="typing-indicator" role="status"><span className="typing-dots"><i /><i /><i /></span>Someone is typing…</div>}{isThreadAway && <button className="scroll-latest-button" type="button" onClick={jumpToLatest}><ArrowDown size={14} />{unreadBelow > 0 ? `${unreadBelow} new below` : "Jump to latest"}</button>}<form className="message-composer multiline-composer" onSubmit={sendMessage}><input ref={imageInputRef} className="composer-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip" onChange={(event) => { setAttachmentFile(event.target.files?.[0] || null); setShowMediaMenu(false); }} /><button type="button" className="composer-media-trigger" aria-label="Open attachment menu" aria-expanded={showMediaMenu} onClick={() => { setShowMediaMenu((open) => !open); setShowEmojiPicker(false); }}>+</button>{showMediaMenu && <div className="composer-media-panel" role="menu"><button type="button" aria-label="Choose image attachment" onClick={() => { if (imageInputRef.current) imageInputRef.current.accept = "image/png,image/jpeg,image/webp,image/gif"; imageInputRef.current?.click(); }}><Paperclip size={14} /> Image</button><button type="button" aria-label="Choose file attachment" onClick={() => { if (imageInputRef.current) imageInputRef.current.accept = "application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip"; imageInputRef.current?.click(); }}><FileText size={14} /> File</button><button type="button" aria-label="Open camera" onClick={openCameraCapture}><Camera size={14} /> Camera</button></div>}<textarea ref={composerTextareaRef} value={messageDraft} maxLength={4000} onChange={(event) => handleMessageDraftChange(event.target.value)} onKeyDown={submitOnEnter} placeholder={attachmentFile ? `${attachmentFile.type.startsWith("video/") ? "Video" : attachmentFile.type.startsWith("audio/") ? "Voice" : attachmentFile.type.startsWith("image/") ? "Image" : "File"} ready · ${attachmentFile.name}` : "Write a message…"} aria-label="Write a message" disabled={!activeConversation} rows={1} spellCheck autoCorrect="on" autoCapitalize="sentences" />{composerSuggestions.length > 0 && <div className="emoji-autocomplete" role="listbox" aria-label="Emoji suggestions">{composerSuggestions.map(([alias, emoji]) => <button type="button" role="option" key={alias} onMouseDown={(event) => event.preventDefault()} onClick={() => { setMessageDraft((draft) => draft.replace(/:[a-z_]+$/i, emoji)); setLastEmoji(emoji); }}>{emoji}<span>{alias}</span></button>)}</div>}<button type="button" className="composer-emoji-trigger" aria-label="Choose emoji" aria-expanded={showEmojiPicker} onClick={() => { setShowEmojiPicker((open) => !open); setShowMediaMenu(false); }}>☺</button>    {showEmojiPicker && <div className="full-emoji-popover convo-emoji-sticker-panel" role="dialog"         aria-label="Emoji picker">    <div className="emoji-sticker-tabs" role="tablist"><button type="button" role="tab" aria-selected={emojiPanelTab === "emoji"} className={emojiPanelTab === "emoji" ? "is-active" : ""} onClick={() => setEmojiPanelTab("emoji")}>Emoji</button><button type="button" role="tab" aria-selected={emojiPanelTab === "stickers"} className={emojiPanelTab === "stickers" ? "is-active" : ""} onClick={() => setEmojiPanelTab("stickers")}>Stickers</button></div>{emojiPanelTab === "emoji" ? <EmojiPicker onEmojiClick={(emoji: EmojiClickData) => insertEmoji(emoji.emoji)} autoFocusSearch emojiStyle={EmojiStyle.NATIVE} theme={Theme.LIGHT} suggestedEmojisMode={SuggestionMode.RECENT} searchPlaceholder="Search all emojis" previewConfig={{ showPreview: false }} height={356} width="100%" /> : <div className="sticker-panel-content">{stickerEditorOpen ? <div className="sticker-editor"><strong>Create sticker</strong>{stickerEditorUrl ? <img src={stickerEditorUrl} alt="Sticker preview" /> : <button type="button" className="sticker-upload" onClick={() => stickerFileInputRef.current?.click()}>Choose image</button>}<input value={stickerEditorName} onChange={(event) => setStickerEditorName(event.target.value)} placeholder="Sticker name" /><input value={stickerEditorText} onChange={(event) => setStickerEditorText(event.target.value)} placeholder="Add text (optional)" /><div><button type="button" className="outline-button" onClick={() => setStickerEditorOpen(false)}>Back</button><button type="button" className="primary-button" onClick={saveSticker} disabled={!stickerEditorUrl}>Save sticker</button></div></div> : <><div className="sticker-search-row"><input value={stickerSearch} onChange={(event) => setStickerSearch(event.target.value)} placeholder="Search stickers" aria-label="Search stickers" /><button type="button" className="outline-button" onClick={() => setStickerEditorOpen(true)}>＋ Create sticker</button></div><input ref={stickerFileInputRef} className="sr-only" type="file" accept="image/*" onChange={(event) => chooseStickerImage(event.target.files?.[0])} /><div className="sticker-grid">{savedStickers.filter((sticker) => !stickerSearch.trim() || sticker.name.toLowerCase().includes(stickerSearch.trim().toLowerCase())).map((sticker) => <button type="button" className="sticker-tile" key={sticker.id} onClick={() => void sendSticker(sticker)}><img src={sticker.dataUrl} alt={sticker.name} /><span>{sticker.favorite ? "★" : "♡"}</span></button>)}{!savedStickers.length && <p className="sticker-empty">Create a sticker from an image to start your collection.</p>}</div></>}</div>}</div>}<button type="submit" aria-label="Send message" disabled={sendingMessage || !activeConversation}>{sendingMessage ? "…" : <Send size={16} />}</button></form>{messageError && <small className="composer-error" role="alert">{messageError}</small>}</section></div></section>{showVoiceRecorder && <div className="camera-capture-backdrop" role="presentation" onClick={cancelVoiceRecording}><section className="camera-capture-modal voice-recorder-modal" role="dialog" aria-modal="true" aria-label="Record a voice message" onClick={(event) => event.stopPropagation()}><button type="button" className="camera-close" aria-label="Close voice recorder" onClick={cancelVoiceRecording}><X size={17} /></button><span className="eyebrow dark">Voice message</span><h2>{voicePreviewUrl ? "Review your recording" : "Record a voice message"}</h2>{voiceError ? <div className="camera-fallback"><p>{voiceError}</p><button type="button" className="outline-button" onClick={cancelVoiceRecording}>Close</button></div> : voicePreviewUrl ? <><audio className="voice-review" src={voicePreviewUrl} controls aria-label="Recorded voice preview" /><div className="camera-capture-actions"><button type="button" className="outline-button" onClick={() => { setVoicePreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; }); setAttachmentFile(null); }}>Retake</button><button type="button" className="primary-button" onClick={() => { stopVoiceStream(); setShowVoiceRecorder(false);  }}>Use recording</button></div></> : <><div className="voice-recording-orb" aria-hidden="true">◉</div><p className="video-recording-status">{isVoiceRecording ? `Recording · ${voiceRecordingSeconds}s` : "Up to 3 minutes · microphone stays on this device"}</p><div className="camera-capture-actions"><button type="button" className="outline-button" onClick={cancelVoiceRecording}>Cancel</button><button type="button" className="primary-button" onClick={isVoiceRecording ? stopVoiceRecording : startVoiceRecording}>{isVoiceRecording ? "Stop recording" : "Start recording"}</button></div></>}</section></div>}{showCameraCapture && <div className="camera-capture-backdrop" role="presentation" onClick={closeCameraCapture}><section className="camera-capture-modal" role="dialog" aria-modal="true" aria-label="Take a photo" onClick={(event) => event.stopPropagation()}><button type="button" className="camera-close" aria-label="Close camera" onClick={closeCameraCapture}><X size={17} /></button><span className="eyebrow dark">Camera</span><h2>Take a photo</h2>{cameraError ? <div className="camera-fallback"><p>{cameraError}</p><button type="button" className="primary-button" onClick={() => { closeCameraCapture(); imageInputRef.current?.click(); }}><Paperclip size={15} /> Choose image</button></div> : <><video ref={cameraVideoRef} autoPlay muted playsInline aria-label="Camera preview" /><div className="camera-capture-actions"><button type="button" className="outline-button" onClick={closeCameraCapture}>Cancel</button><button type="button" className="primary-button" onClick={captureCameraPhoto}><Camera size={15} /> Capture photo</button></div></>}</section></div>}{showVideoRecorder && <div className="camera-capture-backdrop" role="presentation" onClick={closeVideoRecorder}><section className="camera-capture-modal video-recorder-modal" role="dialog" aria-modal="true" aria-label="Record a video" onClick={(event) => event.stopPropagation()}><button type="button" className="camera-close" aria-label="Close video recorder" onClick={closeVideoRecorder}><X size={17} /></button><span className="eyebrow dark">Video message</span><h2>{videoPreviewUrl ? "Review your clip" : "Record a video"}</h2>{cameraError ? <div className="camera-fallback"><p>{cameraError}</p><button type="button" className="primary-button" onClick={() => { closeVideoRecorder(); if (imageInputRef.current) { imageInputRef.current.accept = "video/mp4,video/webm,video/quicktime"; imageInputRef.current.click(); } }}>Choose saved video</button></div> : videoPreviewUrl ? <><video className="video-review" src={videoPreviewUrl} controls playsInline aria-label="Recorded video preview" /><div className="camera-capture-actions"><button type="button" className="outline-button" onClick={() => { setVideoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; }); setAttachmentFile(null); }}>Retake</button><button type="button" className="primary-button" onClick={() => { closeVideoRecorder();  }}>Use video</button></div></> : <><video ref={cameraVideoRef} autoPlay muted playsInline aria-label="Video camera preview" /><p className="video-recording-status">{isVideoRecording ? `Recording · ${videoRecordingSeconds}s` : "Up to 25 MB · camera and microphone stay on this device"}</p><div className="camera-capture-actions"><button type="button" className="outline-button" onClick={closeVideoRecorder}>Cancel</button>{isVideoRecording ? <button type="button" className="primary-button is-recording" onClick={stopVideoRecording}><span className="recording-dot" /> Stop recording</button> : <button type="button" className="primary-button" onClick={startVideoRecording}><Video size={15} /> Start recording</button>}</div></>}</section></div>}</>;
  };


  const acceptRequest = async (request: (typeof connectionRequests)[number]) => {
    if (!onAcceptConnectionRequest) { toast("Apply the live connection schema to accept requests."); return; }
    const result = await onAcceptConnectionRequest(request.id);
    if (!result.ok) { toast.error("We couldn’t accept that request", { description: result.error || "Please try again shortly." }); return; }
    setConnectionRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: "accepted" } : item));
    if (onStartDirectConversation) {
      const conversation = await onStartDirectConversation(request.requester_id);
      if (!conversation.error && conversation.data) {
        const name = request.requester_display_name || "New connection";
        setLiveConversations((current) => current.some((item) => item.id === conversation.data) ? current : [{ id: conversation.data as string, name, meta: "Direct conversation", message: "No messages yet.", tone: "rose", unread: "" }, ...current]);
        setSelectedConversationId(conversation.data);
        setActiveView("messages");
        toast.success("Connection accepted", { description: `You can now message ${name}.` });
        return;
      }
    }
    toast.success("Connection accepted", { description: "You can now start a private conversation." });
  };
  const pendingRequests = connectionRequests.filter((request) => request.direction === "received" && request.status === "pending");
  const renderNotifications = () => {
    const connectionItems: ActivityNotification[] = pendingRequests.map((request) => ({
      id: `connection:${request.id}`,
      kind: "connection",
      title: `${request.requester_display_name || "An MTU student"} wants to connect`,
      body: request.requester_student_id ? `Public ID · ${request.requester_student_id}` : "Verified MTU student",
      createdAt: new Date().toISOString(),
      unread: true,
    }));
    const unreadConversationItems: ActivityNotification[] = liveConversations.filter((conversation) => conversation.unread || conversation.isMarkedUnread).map((conversation) => ({
      id: `conversation:${conversation.id}`,
      kind: conversation.kind === "group" ? "group" : "message",
      title: conversation.kind === "group" ? `${conversation.name} has new activity` : `New message from ${conversation.name}`,
      body: conversation.message || "Open the conversation to view the latest update.",
      createdAt: new Date().toISOString(),
      conversationId: conversation.id,
      unread: true,
    }));
    const items = [...connectionItems, ...unreadConversationItems, ...activityNotifications].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const openNotification = (item: ActivityNotification) => {
      if (item.conversationId) {
        setSelectedConversationId(item.conversationId);
        setActiveView("messages");
        void onSetConversationRailState?.(item.conversationId, null, null, null, false);
      }
      setActivityNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry));
      if (item.id && onMarkNotificationRead) void onMarkNotificationRead(item.id);
    };
    return <section className="workspace-view notifications-view"><div className="workspace-heading"><div><span className="eyebrow dark">A little movement</span><h1>Your<br /><em>notifications.</em></h1><p>Messages, calls, connection requests, and group activity appear here.</p></div><div className="workspace-heading-actions"><button type="button" className="outline-button" onClick={() => { setActivityNotifications((current) => current.filter((item) => item.unread)); if (onClearNotifications) void onClearNotifications(); }} disabled={!activityNotifications.some((item) => !item.unread)}>Clear activity</button></div></div><div className="notification-stack">{items.length ? items.map((item) => <article className={`notification-card ${item.unread ? "is-unread" : ""}`} key={item.id} onClick={() => openNotification(item)}><span className="notification-mark rose">{item.kind === "connection" ? <Users size={16} /> : item.kind === "group" ? <Bell size={16} /> : <MessageCircle size={16} />}</span><span><b>{item.title}</b><small>{item.body}</small><small>{new Date(item.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></span>{item.kind === "connection" ? <button type="button" className="primary-button" onClick={(event) => { event.stopPropagation(); const request = pendingRequests.find((candidate) => `connection:${candidate.id}` === item.id); if (request) void acceptRequest(request); }}>Accept</button> : <ArrowRight size={16} aria-hidden="true" />}</article>) : <div className="directory-empty"><Bell size={22} /><strong>You’re all caught up.</strong><span>Messages, calls, requests, and group updates will appear here.</span></div>}</div></section>;
  };

  const renderGroups = () => { const remoteGroups = liveGroupDirectory.map((group, index) => ({ id: group.conversation_id, name: group.title, meta: group.category ? group.category.replace("_", " & ") : "MTU group", members: group.member_count, tone: ["rose", "sage", "butter", "apricot"][index % 4], category: group.category, isMember: group.is_member, requestStatus: group.my_request_status, imageUrl: group.group_image_url })); const sourceGroups = (onSearchGroups ? remoteGroups : groups.map((group) => ({ ...group, category: null, isMember: joinedGroups.includes(String(group.id)), requestStatus: null, imageUrl: null }))).filter((group) => !privateGroupIds.has(String(group.id))); const normalizedQuery = groupSearchQuery.trim().toLowerCase(); const filteredGroups = sourceGroups.filter((group) => { const haystack = `${group.name} ${group.meta}`.toLowerCase(); const categoryMatch = groupCategoryFilter === "all" || group.category === groupCategoryFilter || (!onSearchGroups && haystack.includes(groupCategoryFilter)); return categoryMatch && (!normalizedQuery || haystack.includes(normalizedQuery)); }); return <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Your communities</span><h1>Campus<br /><em>groups.</em></h1><p>Course circles, societies, and project rooms live here. Every group uses real membership data from Convo.</p></div><div className="workspace-heading-actions"><button className="primary-button" onClick={() => void createGroupConversation()}><Users size={16} /> Create group</button></div></div><div className="group-discovery-controls"><label className="sr-only" htmlFor="group-discovery-search">Search groups</label><input id="group-discovery-search" value={groupSearchQuery} onChange={(event) => setGroupSearchQuery(event.target.value)} placeholder="Search groups, courses, programmes..." /><div className="group-category-tabs" role="tablist" aria-label="Group categories">{["all", "academic", "social", "sports", "technology", "business", "arts", "club", "project", "code_tech", "cruise"].map((category) => <button type="button" role="tab" aria-selected={groupCategoryFilter === category} className={groupCategoryFilter === category ? "is-active" : ""} key={category} onClick={() => setGroupCategoryFilter(category)}>{category === "all" ? "All" : category === "code_tech" ? "Code & Tech" : category.charAt(0).toUpperCase() + category.slice(1)}</button>)}</div></div>{groupDirectoryLoading ? <div className="group-row-list" aria-busy="true"><div className="group-directory-skeleton" /><div className="group-directory-skeleton" /><div className="group-directory-skeleton" /></div> : groupDirectoryError ? <div className="premium-empty-state"><h2>Groups are unavailable.</h2><p>{groupDirectoryError}</p></div> : sourceGroups.length ? <div className="group-row-list">{filteredGroups.map((group) => { const joined = joinedGroups.includes(String(group.id)); return <article className={`group-row ${group.tone}`} key={group.id}><span className="group-row-mark" aria-hidden="true">{group.imageUrl ? <img className={loadedAvatarImages[`group:${group.id}:${group.imageUrl}`] ? "is-loaded" : ""} src={group.imageUrl} alt="" loading="lazy" onLoad={() => setLoadedAvatarImages((current) => ({ ...current, [`group:${group.id}:${group.imageUrl}`]: true }))} /> : <Users size={17} />}</span><div><span className="eyebrow dark">{joined ? "Your circle" : "Discover group"}</span><h2>{group.name}</h2><p>{group.meta}</p></div><small>{group.members ? `${group.members} members` : "Membership updates live"}</small><button className={joined ? "outline-button" : "primary-button"} onClick={() => { if (onSearchGroups) { if (joined || group.isMember) { setSelectedConversationId(String(group.id)); setActiveView("messages"); } else if (group.requestStatus === "pending") return; else void requestToJoinGroup(String(group.id), group.name); } else joinGroup(String(group.id), group.name); }}>{joined || group.isMember ? "Open group" : group.requestStatus === "pending" ? "Request pending" : "Request to join"} <ArrowRight size={14} /></button></article>; })}{!filteredGroups.length && <div className="premium-empty-state"><h2>No live groups match that search.</h2><p>Try another course, programme, or category.</p></div>}</div> : <div className="premium-empty-state"><span className="empty-orbit"><Users size={22} /></span><h2>Your groups will gather here.</h2><p>Create a private group chat or join a verified campus circle when one is available.</p><button className="primary-button" onClick={() => void createGroupConversation()}>Create a group <ArrowRight size={14} /></button></div>}</section>; };

  const renderCampus = () => <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Campus pulse</span><h1>What is<br /><em>moving.</em></h1><p>Verified announcements, circle updates, and campus conversations in one calm place.</p></div><div className="workspace-heading-actions"><button className="outline-button" onClick={() => openView("events")}><CalendarDays size={16} /> Events</button></div></div>{posts.length ? <div className="campus-pulse-list">{posts.map((post) => <article className="campus-pulse-card" key={post.id}><span className={`feed-avatar ${post.tone}`}>{post.author_name.slice(0, 2).toUpperCase()}</span><div><span className="eyebrow dark">Campus update</span><b>{post.author_name}</b><small>{post.author_meta}</small><p>{post.body}</p><div className="post-actions"><button aria-label="React to post">♡ {post.likes}</button><button onClick={() => openView("messages")}><MessageCircle size={13} /> Discuss</button></div></div></article>)}</div> : <div className="premium-empty-state"><span className="empty-orbit"><Compass size={22} /></span><h2>Campus pulse is quiet.</h2><p>Verified posts, announcements, polls, and event updates will appear here when they are shared.</p></div>}</section>;

  React.useEffect(() => {
    if (activeView !== "events" || activeConversation?.kind !== "group") { setStandaloneEvents([]); setStandalonePolls([]); setStandaloneTasks([]); setStandaloneAnnouncements([]); return; }
    let cancelled = false; setStandaloneEventsLoading(true); setStandaloneEventsError("");
    setStandaloneActivityLoading(true); setStandaloneActivityError("");
    const conversationId = activeConversation.id;
    const loadEvents = onLoadGroupEvents ? onLoadGroupEvents(conversationId) : Promise.resolve({ data: [], error: null });
    const loadPolls = onLoadGroupPolls ? onLoadGroupPolls(conversationId) : Promise.resolve({ data: [], error: null });
    const loadTasks = onLoadGroupTasks ? onLoadGroupTasks(conversationId) : Promise.resolve({ data: [], error: null });
    const loadAnnouncements = onLoadGroupAnnouncements ? onLoadGroupAnnouncements(conversationId) : Promise.resolve({ data: [], error: null });
    void Promise.all([loadEvents, loadPolls, loadTasks, loadAnnouncements]).then(([events, polls, tasks, announcements]) => {
      if (cancelled) return;
      if (events.error || polls.error || tasks.error || announcements.error) setStandaloneActivityError(events.error?.message || (typeof polls.error === "string" ? polls.error : "") || (typeof tasks.error === "string" ? tasks.error : "") || announcements.error?.message || "Group activity could not be loaded right now.");
      setStandaloneEvents(events.data);
      const grouped = Array.from(polls.data.reduce((collection, row) => { const current = collection.get(row.poll_id) || { poll_id: row.poll_id, question: row.question, created_by: row.created_by, closes_at: row.closes_at, is_closed: row.is_closed, anonymous_voters: row.anonymous_voters, options: [] as Array<typeof row> }; current.options.push({ option_id: row.option_id, option_label: row.option_label, vote_count: row.vote_count, selected_by_me: row.selected_by_me }); collection.set(row.poll_id, current); return collection; }, new Map<string, { poll_id: string; question: string; created_by: string; closes_at?: string | null; is_closed: boolean; anonymous_voters: boolean; options: Array<{ option_id: string; option_label: string; vote_count: number; selected_by_me: boolean }> }>()).values());
      setStandalonePolls(grouped);
      setStandaloneTasks(tasks.data);
      setStandaloneAnnouncements(announcements.data);
      setStandaloneEventsLoading(false); setStandaloneActivityLoading(false);
    }).catch(() => { if (!cancelled) { setStandaloneEventsError("Events could not be loaded right now."); setStandaloneActivityError("Group activity could not be loaded right now."); setStandaloneEventsLoading(false); setStandaloneActivityLoading(false); } });
    return () => { cancelled = true; };
  }, [activeView, activeConversation?.id, activeConversation?.kind, groupEventsVersion, onLoadGroupEvents, onLoadGroupPolls, onLoadGroupTasks, onLoadGroupAnnouncements]);
  React.useEffect(() => {
    if (activeView !== "events" || activeConversation?.kind !== "group" || !onSubscribeToGroupActivity) return;
    return onSubscribeToGroupActivity(activeConversation.id, () => setGroupEventsVersion((version) => version + 1));
  }, [activeView, activeConversation?.id, activeConversation?.kind, onSubscribeToGroupActivity]);
  const renderEvents = (): React.ReactElement => {
    const groupReady = activeConversation?.kind === "group";
    if (!groupReady) return renderEventsPreview();
    const refreshActivity = () => setGroupEventsVersion((version) => version + 1);
    const groupRole = groupMembers.find((member) => member.user_id === currentUserId)?.group_role;
    const canManage = (createdBy: string) => Boolean(currentUserId && (createdBy === currentUserId || groupRole === "owner" || groupRole === "admin"));
    const editPoll = async (poll: typeof standalonePolls[number]) => {
      if (!onUpdateGroupPoll) return;
      const question = (await openAppPrompt("Poll question", poll.question))?.trim();
      if (!question) return;
      const options: string[] = [];
      for (const option of poll.options) options.push((await openAppPrompt(`Option ${option.option_id}`, option.option_label))?.trim() || option.option_label);
      const result = await onUpdateGroupPoll(poll.poll_id, question, options, poll.closes_at || null, poll.anonymous_voters);
      if (!result.ok) toast.error("Couldn’t edit poll", { description: result.error || "Please try again." }); else refreshActivity();
    };
    const editTask = async (task: typeof standaloneTasks[number]) => {
      if (!onUpdateGroupTask) return;
      const title = (await openAppPrompt("Task title", task.title))?.trim();
      if (!title) return;
      const result = await onUpdateGroupTask(task.task_id, title, task.assignee_id || null, task.due_at || null);
      if (!result.ok) toast.error("Couldn’t edit task", { description: result.error || "Please try again." }); else refreshActivity();
    };
    const editEvent = async (event: typeof standaloneEvents[number]) => {
      if (!onUpdateGroupEvent) return;
      const title = (await openAppPrompt("Event title", event.title))?.trim();
      if (!title) return;
      const description = (await openAppPrompt("Event description", event.description)) ?? event.description;
      const location = (await openAppPrompt("Event location", event.location)) ?? event.location;
      const result = await onUpdateGroupEvent(event.id, title, description, event.starts_at, location);
      if (!result.ok) toast.error("Couldn’t edit event", { description: result.error || "Please try again." }); else refreshActivity();
    };
    const editAnnouncement = async (announcement: typeof standaloneAnnouncements[number]) => {
      if (!onUpdateGroupAnnouncement) return;
      const title = (await openAppPrompt("Announcement title", announcement.title))?.trim();
      if (!title) return;
      const body = (await openAppPrompt("Announcement message", announcement.body))?.trim();
      if (!body) return;
      const result = await onUpdateGroupAnnouncement(announcement.id, title, body, announcement.expires_at);
      if (!result.ok) toast.error("Couldn’t edit announcement", { description: result.error || "Please try again." }); else refreshActivity();
    };
    const submitActivity = async (formEvent: React.FormEvent<HTMLFormElement>, kind: "poll" | "task" | "announcement") => {
      formEvent.preventDefault();
      if (!activeConversation) return;
      const values = new FormData(formEvent.currentTarget);
      if (kind === "poll" && onCreateGroupPoll) {
        const question = String(values.get("question") || "").trim();
        const optionOne = String(values.get("option_one") || "").trim();
        const options = Array.from(values.entries()).filter(([name, value]) => name.startsWith("poll_option_") && typeof value === "string").map(([, value]) => String(value).trim()).filter(Boolean);
        const closesAt = String(values.get("closes_at") || "");
        const anonymous = Boolean(values.get("anonymous"));
        if (!question || options.length < 2) {
          toast.error("Polls need a question and at least two options.");
          return;
        }
        const result = await onCreateGroupPoll(activeConversation.id, question, options, closesAt ? new Date(closesAt).toISOString() : null, anonymous);
        if (result.error) toast.error("Couldn’t create poll", { description: result.error }); else { toast.success("Poll created"); setEventComposer(null); refreshActivity(); }
      } else if (kind === "task" && onCreateGroupTask) {
        const title = String(values.get("title") || "").trim();
        const dueAt = String(values.get("due_at") || "");
        if (!title) {
          toast.error("Task title is required.");
          return;
        }
        const result = await onCreateGroupTask(activeConversation.id, title, null, dueAt ? new Date(dueAt).toISOString() : null);
        if (result.error) toast.error("Couldn’t create task", { description: result.error }); else { toast.success("Task added"); setEventComposer(null); refreshActivity(); }
      } else if (kind === "announcement" && onCreateGroupAnnouncement) {
        const title = String(values.get("title") || "").trim();
        const body = String(values.get("body") || "").trim();
        if (!title || !body) {
          toast.error("Announcements need a title and body.");
          return;
        }
        const result = await onCreateGroupAnnouncement(activeConversation.id, title, body, null);
        if (result.error) toast.error("Couldn’t publish announcement", { description: result.error.message }); else { toast.success("Announcement published"); setEventComposer(null); refreshActivity(); }
      }
    };

    return (
      <section className="workspace-view premium-feature-view">
        <div className="workspace-heading">
          <div>
            <span className="eyebrow dark">Campus calendar</span>
            <h1>Group<br /><em>activity.</em></h1>
            <p>{groupReady ? `Live events, polling, tasks, and announcements for ${activeConversation?.name}.` : "Choose a group to see live shared activity."}</p>
          </div>
          <div className="workspace-heading-actions">
            <button type="button" className="outline-button" onClick={() => setSelectedConversationId("")}><ArrowLeft size={16} /> Back to groups</button>
            <button type="button" className="primary-button" onClick={openGroupEventsDialog} disabled={!groupReady || !onCreateGroupEvent}><CalendarDays size={16} /> Create event</button>
            <button type="button" className="outline-button" onClick={() => activeConversation && setEventComposer("poll")} disabled={!groupReady || !onCreateGroupPoll}><CalendarDays size={16} /> New poll</button>
            <button type="button" className="outline-button" onClick={() => activeConversation && setEventComposer("task")} disabled={!groupReady || !onCreateGroupTask}><Check size={16} /> New task</button>
            <button type="button" className="outline-button" onClick={() => activeConversation && setEventComposer("announcement")} disabled={!groupReady || !onCreateGroupAnnouncement}><Bell size={16} /> Announce</button>
          </div>
        </div>

        {eventComposer && groupReady && (
          <div className="convo-utility-form-wrap" style={{ marginBottom: 16 }}>
            <form className="convo-utility-form" onSubmit={(formEvent) => void submitActivity(formEvent, eventComposer)}>
              {eventComposer === "poll" && (
                <>
                  <label>
                    Question
                    <input name="question" placeholder="What should we decide next?" required />
                  </label>
                  <div className="poll-option-fields">
                    {Array.from({ length: pollOptionCount }, (_, index) => (
                      <label key={index}>
                        Option {index + 1}
                        <div className="poll-option-input-row">
                          <input name={`poll_option_${index + 1}`} placeholder={`Option ${index + 1}`} required />
                          {index >= 2 && <button type="button" className="poll-option-remove" aria-label={`Remove option ${index + 1}`} onClick={() => setPollOptionCount((count) => Math.max(2, count - 1))}>×</button>}
                        </div>
                      </label>
                    ))}
                    <button type="button" className="outline-button poll-add-option" onClick={() => setPollOptionCount((count) => Math.min(8, count + 1))} disabled={pollOptionCount >= 8}>+ Add option</button>
                  </div>
                  <label>
                    Closes at
                    <input type="datetime-local" name="closes_at" />
                  </label>
                  <label className="convo-checkbox-row">
                    <input type="checkbox" name="anonymous" />
                    Hide voter identities
                  </label>
                </>
              )}
              {eventComposer === "task" && (
                <>
                  <label>
                    Task title
                    <input name="title" placeholder="Prepare briefing deck" required />
                  </label>
                  <label>
                    Due at
                    <input type="datetime-local" name="due_at" />
                  </label>
                </>
              )}
              {eventComposer === "announcement" && (
                <>
                  <label>
                    Title
                    <input name="title" placeholder="Updated campus briefing" required />
                  </label>
                  <label>
                    Message
                    <textarea name="body" placeholder="Share an update with the group" rows={4} required />
                  </label>
                </>
              )}
              <div className="convo-composer-actions">
                <button type="button" className="outline-button" onClick={() => setEventComposer(null)}>Cancel</button>
                <button type="submit" className="primary-button">Save</button>
              </div>
            </form>
          </div>
        )}

        {standaloneActivityLoading ? (
          <div className="event-list event-list-loading" aria-busy="true"><div /><div /><div /></div>
        ) : standaloneActivityError ? (
          <div className="premium-empty-state"><h2>Activity is unavailable.</h2><p>{standaloneActivityError}</p></div>
        ) : !groupReady ? (
          <div className="premium-empty-state"><CalendarDays size={22} /><h2>Choose a group to view activity.</h2><p>Open a group conversation to see live events, polls, tasks, and announcements.</p></div>
        ) : (
          <div className="event-list">
            {standaloneEvents.map((event) => (
              <article className="event-row convo-collab-card" key={event.id}>
                {canManage(event.created_by) && onDeleteGroupEvent && <button type="button" className="convo-item-delete" aria-label="Delete event" onClick={() => void confirmItemDeletion("event", () => onDeleteGroupEvent(event.id)).then((result) => result && (result.ok ? refreshActivity() : toast.error("Couldn’t delete event", { description: result.error || "Please try again." })))}>×</button>}
                <div>
                  <span className="eyebrow dark">Event</span>
                  <h2>{event.title}</h2>
                  <p>{event.description}</p>
                  <small>{new Date(event.starts_at).toLocaleString()} · {event.location}</small>
                </div>
                <div className="event-response-actions">
                  {(["going", "maybe", "declined"] as const).map((response) => (
                    <button type="button" className={event.my_response === response ? "is-active" : ""} key={response} onClick={() => { if (!onSetGroupEventResponse) return; void onSetGroupEventResponse(event.id, response).then((result) => result.error ? toast.error("Couldn’t update attendance", { description: result.error.message }) : refreshActivity()); }}>
                      {response}
                    </button>
                  ))}
                </div>
                {canManage(event.created_by) && onCancelGroupEvent && (
                  <button type="button" className="ghost-button" onClick={() => void onCancelGroupEvent(event.id).then((result) => result.error ? toast.error("Couldn’t cancel event", { description: result.error.message }) : refreshActivity())}>Cancel event</button>
                )}
                {canManage(event.created_by) && onUpdateGroupEvent && <div className="event-row-actions"><button type="button" className="ghost-button" onClick={() => void editEvent(event)}>Edit</button></div>}
              </article>
            ))}

            {standalonePolls.map((poll) => (
              <article className="event-row convo-collab-card" key={poll.poll_id}>
                {canManage(poll.created_by) && onDeleteGroupPoll && <button type="button" className="convo-item-delete" aria-label="Delete poll" onClick={() => void confirmItemDeletion("poll", () => onDeleteGroupPoll(poll.poll_id)).then((result) => result && (result.ok ? refreshActivity() : toast.error("Couldn’t delete poll", { description: result.error || "Please try again." })))}>×</button>}
                <div>
                  <span className="eyebrow dark">Poll</span>
                  <h2>{poll.question}</h2>
                  {poll.options.map((option) => (
                    <button type="button" className="outline-button" key={option.option_id} disabled={poll.is_closed || !onVoteOnGroupPoll} onClick={() => onVoteOnGroupPoll && void onVoteOnGroupPoll(poll.poll_id, option.option_id).then((result) => result.ok ? refreshActivity() : toast.error("Couldn’t cast vote", { description: result.error }))}>
                      {option.option_label} · {option.vote_count}
                    </button>
                  ))}
                  <small>{poll.is_closed ? "Voting closed" : poll.closes_at ? `Closes ${new Date(poll.closes_at).toLocaleString()}` : "No deadline"}</small>
                  {canManage(poll.created_by) && (onUpdateGroupPoll || onCloseGroupPoll) && <div className="event-row-actions">{onUpdateGroupPoll && <button type="button" className="ghost-button" onClick={() => void editPoll(poll)}>Edit</button>}{onCloseGroupPoll && !poll.is_closed && <button type="button" className="ghost-button" onClick={() => void onCloseGroupPoll(poll.poll_id).then((result) => result.ok ? refreshActivity() : toast.error("Couldn’t close poll", { description: result.error || "Please try again." }))}>Close</button>}</div>}
                </div>
              </article>
            ))}

            {standaloneTasks.map((task) => (
              <article className="event-row convo-collab-card" key={task.task_id}>
                {canManage(task.created_by) && onDeleteGroupTask && <button type="button" className="convo-item-delete" aria-label="Delete task" onClick={() => void confirmItemDeletion("task", () => onDeleteGroupTask(task.task_id)).then((result) => result && (result.ok ? refreshActivity() : toast.error("Couldn’t delete task", { description: result.error || "Please try again." })))}>×</button>}
                <div>
                  <span className="eyebrow dark">Task</span>
                  <h2>{task.title}</h2>
                  <small>{task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : "No deadline"}</small>
                </div>
                {onSetGroupTaskCompleted && (
                  <button type="button" className="outline-button" onClick={() => void onSetGroupTaskCompleted(task.task_id, !task.completed_at).then((result) => result.ok ? refreshActivity() : toast.error("Couldn’t update task", { description: result.error }))}>
                    {task.completed_at ? "Reopen" : "Complete"}
                  </button>
                )}
                {canManage(task.created_by) && onUpdateGroupTask && <div className="event-row-actions"><button type="button" className="ghost-button" onClick={() => void editTask(task)}>Edit</button></div>}
              </article>
            ))}

            {standaloneAnnouncements.map((announcement) => (
              <article className="event-row convo-collab-card" key={announcement.id}>
                {canManage(announcement.created_by) && onDeleteGroupAnnouncement && <button type="button" className="convo-item-delete" aria-label="Delete announcement" onClick={() => void confirmItemDeletion("announcement", () => onDeleteGroupAnnouncement(announcement.id)).then((result) => result && (result.ok ? refreshActivity() : toast.error("Couldn’t delete announcement", { description: result.error || "Please try again." })))}>×</button>}
                <div>
                  <span className="eyebrow dark">Announcement</span>
                  <h2>{announcement.title}</h2>
                  <p>{announcement.body}</p>
                  <small>{announcement.publish_at ? new Date(announcement.publish_at).toLocaleString() : "Published recently"}</small>
                </div>
                {canManage(announcement.created_by) && onUpdateGroupAnnouncement && <div className="event-row-actions"><button type="button" className="ghost-button" onClick={() => void editAnnouncement(announcement)}>Edit</button></div>}
              </article>
            ))}

            {!standaloneEvents.length && !standalonePolls.length && !standaloneTasks.length && !standaloneAnnouncements.length && (
              <div className="premium-empty-state">
                <h2>No group activity yet.</h2>
                <p>Create the first event, poll, task, or announcement.</p>
              </div>
            )}
          </div>
        )}
      </section>
    );
  };


  React.useEffect(() => {
    if (activeView !== "files" && activeView !== "assistant" || !onLoadSharedFilesRef.current) return;
    let cancelled = false;
    setSharedFilesLoading(true); setSharedFilesError("");
    const conversations = liveConversationsRef.current;
    void Promise.all(conversations.map(async (conversation) => ({ conversation, result: await onLoadSharedFilesRef.current!(conversation.id), members: conversation.kind === "group" && onLoadGroupMembersRef.current ? (await onLoadGroupMembersRef.current(conversation.id)).data : [] }))).then((loaded) => {
     if (cancelled) return;
     const failed = loaded.find(({ result }) => result.error);
     if (failed) { setSharedFilesError(failed.result.error || "Shared files could not be loaded right now."); setSharedFilesData([]); }
     else setSharedFilesData(loaded.flatMap(({ conversation, result, members }) => result.data.map((file) => ({ ...file, conversation_id: conversation.id, conversation_name: conversation.name, sender_name: conversation.kind === "group" ? members.find((member) => member.user_id === file.sender_id)?.display_name : conversation.name }))));
     setSharedFilesLoading(false);
    }).catch(() => { if (!cancelled) { setSharedFilesError("Shared files could not be loaded right now."); setSharedFilesLoading(false); } });
    const unsubscribers = conversations.map((conversation) => onSubscribeToMessagesRef.current?.(conversation.id, (message) => {
     const attachmentUrl = typeof message.attachment_url === "string" ? message.attachment_url : "";
     if (attachmentUrl) addSharedFile({ message_id: String(message.id || crypto.randomUUID()), sender_id: String(message.sender_id || ""), attachment_url: attachmentUrl, attachment_path: typeof message.attachment_path === "string" ? message.attachment_path : null, attachment_mime: typeof message.attachment_mime === "string" ? message.attachment_mime : null, body: typeof message.body === "string" ? message.body : "", created_at: typeof message.created_at === "string" ? message.created_at : new Date().toISOString(), conversation_id: conversation.id, conversation_name: conversation.name, sender_name: conversation.kind === "group" ? groupMembersRef.current.find((member) => member.user_id === String(message.sender_id || ""))?.display_name : conversation.name });
    })).filter((unsubscribe): unsubscribe is () => void => Boolean(unsubscribe));
    return () => { cancelled = true; unsubscribers.forEach((unsubscribe) => unsubscribe()); };
  }, [activeView, addSharedFile]);
  const renderFiles = () => {
    const sharedFiles: SharedFile[] = onLoadSharedFiles ? sharedFilesData : threadMessages.filter((message) => Boolean(message.attachment_url) && !message.deleted_at).map((message) => ({ message_id: message.id, sender_id: message.sender_id, attachment_url: message.attachment_url as string, attachment_path: message.attachment_path || null, attachment_mime: message.attachment_mime || null, body: message.body, created_at: message.created_at, conversation_id: selectedConversationId, conversation_name: activeConversation?.name, sender_name: activeConversation?.name }));
    const fileName = (file: SharedFile) => (file.attachment_path?.split("/").pop() || "convo-attachment").replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i, "");
    const groupedFiles = Array.from(sharedFiles.reduce((groups, file) => { const key = file.conversation_id || "current"; const group = groups.get(key) || { name: file.conversation_name || activeConversation?.name || "Shared files", files: [] as SharedFile[] }; group.files.push(file); groups.set(key, group); return groups; }, new Map<string, { name: string; files: SharedFile[] }>()).values());
    return <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Shared files</span><h1>Keep work<br /><em>together.</em></h1><p>Images, voice messages, videos, and documents shared by members, grouped by conversation.</p></div><button className="outline-button" onClick={() => openView("messages")}><MessageCircle size={15} /> Open Messages</button></div>{sharedFilesLoading ? <div className="shared-files-list shared-files-loading" aria-busy="true"><div /><div /><div /></div> : sharedFilesError ? <div className="premium-empty-state"><h2>Shared files are unavailable.</h2><p>{sharedFilesError}</p></div> : groupedFiles.length ? <div className="shared-files-groups">{groupedFiles.map((group) => <section className="shared-files-group" key={group.name}><h2>{group.name}</h2><div className="shared-files-list">{group.files.map((file) => <a className="shared-file-row" href={file.attachment_url || "#"} target="_blank" rel="noreferrer" download={fileName(file)} onClick={(event) => { if (!file.attachment_url) return; event.preventDefault(); void saveAttachmentToDevice(file.attachment_url, fileName(file)); }} key={file.message_id}><span className="shared-file-icon">{file.attachment_mime?.startsWith("image/") ? <FolderOpen size={16} /> : file.attachment_mime?.startsWith("video/") ? <Video size={16} /> : file.attachment_mime?.startsWith("audio/") ? <Headphones size={16} /> : <FileText size={16} />}</span><span><b>{fileName(file)}</b><small>{file.sender_name ? `Shared by ${file.sender_name} · ` : ""}{file.attachment_mime || "File"} · {messageTime(file.created_at)}</small></span><ArrowRight size={14} /></a>)}</div></section>)}</div> : <div className="premium-empty-state"><span className="empty-orbit"><FolderOpen size={22} /></span><h2>No shared files yet.</h2><p>Images, voice messages, videos, and documents will appear here after a member shares them.</p><button className="outline-button" onClick={() => openView("messages")}><Paperclip size={15} /> Share a file</button></div>}</section>;
  };

  const addAssistantFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 4 - assistantAttachments.length).forEach((file) => {
      if (file.size > 8 * 1024 * 1024) { toast.error(`${file.name} is larger than 8 MB.`); return; }
      const reader = new FileReader();
      reader.onload = () => setAssistantAttachments((current) => current.length >= 4 ? current : [...current, { name: file.name, mimeType: file.type || "application/octet-stream", data: String(reader.result || "") }]);
      reader.onerror = () => toast.error(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    });
  };
  const copyAssistantText = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard")).catch(() => toast.error("Could not copy text"));
  };
  const downloadAssistantPdf = (text: string) => {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) { toast.error("Allow pop-ups to create the PDF."); return; }
    popup.document.write(`<html><head><title>Timothy response</title><style>body{font-family:Arial,sans-serif;white-space:pre-wrap;padding:40px;line-height:1.6}</style></head><body>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c))}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };
  const renderVault = () => <VaultPanel client={vaultClient || null} />;
  const renderAssistant = () => <section className="workspace-view premium-feature-view assistant-view"><input ref={assistantFileInputRef} className="sr-only" type="file" multiple accept="image/*,.pdf,.txt,.csv,.json" onChange={(event) => { addAssistantFiles(event.target.files); event.currentTarget.value = ""; }} /><div className="assistant-heading"><div><span className="eyebrow dark"><Bot size={13} /> Timothy · Study assistant</span><h1>Study with<br /><em>context.</em></h1><p>Ask Timothy to explain, summarize, or work through a concept. He can use your shared-folder file list and any files or photos you attach.</p></div><div className="assistant-limit"><span>{assistantSecondsLeft ? `Time left · ${Math.floor(assistantSecondsLeft / 60)}:${String(assistantSecondsLeft % 60).padStart(2, "0")}` : "2-hour study window"}</span><small>Unlimited questions while active · 1-hour cooldown after</small></div></div><div className="assistant-launch"><div className="assistant-launch-bar"><span className="assistant-orb"><Bot size={22} /></span><div><strong>Hi, I’m Timothy.</strong><small>Upload a page, photo, or document when you want me to inspect it. I’ll remind you before your study window ends.</small></div></div>{assistantMessages.length > 0 && <div ref={assistantTranscriptRef} className="assistant-transcript">{assistantMessages.map((m, i) => <article key={i} className={`assistant-message ${m.role}`}><b>{m.role === "user" ? "You" : "Timothy"}</b>{m.role === "assistant" ? <><Streamdown>{m.content}</Streamdown><div className="assistant-message-tools"><button type="button" className="ghost-button" onClick={() => copyAssistantText(m.content)}><Copy size={13} /> Copy</button><button type="button" className="ghost-button" onClick={() => downloadAssistantPdf(m.content)}><Download size={13} /> PDF</button></div></> : <><p>{m.content}</p><button type="button" className="ghost-button" onClick={() => copyAssistantText(m.content)}><Copy size={13} /> Copy prompt</button></>}{m.attachmentNames?.length ? <div className="assistant-message-attachments">{m.attachmentNames.map((name) => <span key={name}><Paperclip size={12} />{name}</span>)}</div> : null}</article>)}</div>}<form className="assistant-form" onSubmit={(event) => { event.preventDefault(); const text = assistantDraft.trim(); if ((!text && !assistantAttachments.length) || assistantBusy || !onAskAssistant) return; const files = assistantAttachments; const next = [...assistantMessages, { role: "user" as const, content: text || "Please review these attachments.", attachmentNames: files.map((file) => file.name) }]; const sharedFiles = sharedFilesData.map((file) => ({ name: file.attachment_path?.split("/").pop() || "Shared file", mimeType: file.attachment_mime || "file" })); setAssistantMessages(next); setAssistantDraft(""); setAssistantAttachments([]); setAssistantBusy(true); void onAskAssistant(next.map(({ role, content }) => ({ role, content })), files, sharedFiles).then((answer) => { setAssistantMessages([...next, { role: "assistant" as const, content: answer.text }]); if (answer.sessionSeconds) setAssistantSecondsLeft(answer.sessionSeconds); }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Timothy is unavailable.")).finally(() => setAssistantBusy(false)); }}><label htmlFor="assistant-question">What would you like help studying?</label><textarea id="assistant-question" value={assistantDraft} onChange={(event) => setAssistantDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Explain this passage, summarize a concept, or define a word…" rows={3} /><div className="assistant-composer-footer"><div className="assistant-attachment-list">{assistantAttachments.map((file, index) => <span key={`${file.name}-${index}`}><Paperclip size={12} />{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAssistantAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div><div className="assistant-actions"><button type="button" className="outline-button" onClick={() => assistantFileInputRef.current?.click()} disabled={assistantAttachments.length >= 4}><Paperclip size={15} /> Add files or photos</button><button className="primary-button" type="submit" disabled={assistantBusy || !onAskAssistant}><MessageCircle size={15} /> {assistantBusy ? "Timothy is thinking…" : "Ask Timothy"}</button></div></div></form></div></section>;

  const renderPrivacyControls = () => <article className="settings-privacy-card"><div><span className="eyebrow dark">Profile privacy</span><h2>Choose what<br /><em>students see.</em></h2><p>Your nickname and public student ID remain discoverable. Turn an academic field off to hide it from other students and your public card.</p></div><div className="privacy-control-list">{([['programme', 'Programme'], ['college', 'College'], ['level', 'Level'], ['incognito', 'Incognito mode'], ['allow_exact_id_lookup', 'Exact Convo ID lookup']] as const).map(([field, label]) => <label key={field} className="privacy-control"><span><b>{label}</b><small>{field === "incognito" ? (visibilityDraft[field] ? 'Only approved people can find you' : 'Discoverable to eligible verified students') : field === "allow_exact_id_lookup" ? (visibilityDraft[field] ? 'People with your exact ID can find you' : 'Exact ID lookup is disabled') : (visibilityDraft[field] ? 'Visible to eligible verified students' : 'Private to you')}</small></span><button type="button" role="switch" aria-label={`Show ${label} to students`} aria-checked={visibilityDraft[field]} className={`theme-toggle ${visibilityDraft[field] ? 'is-dark' : ''}`} onClick={() => void updatePrivacy(field)} disabled={privacySaving}><i /></button></label>)}</div></article>;

  const loadApprovedPeople = React.useCallback(async () => { if (!onLoadApprovedPeople) return; setApprovedPeopleLoading(true); const result = await onLoadApprovedPeople(); setApprovedPeopleLoading(false); if (result.error) setApprovedPeopleError(result.error); else { setApprovedPeopleError(""); setApprovedPeople(result.data); } }, [onLoadApprovedPeople]);
  React.useEffect(() => { if (activeView === "settings") void loadApprovedPeople(); }, [activeView, loadApprovedPeople]);
  const renderApprovedPeople = () => <article className="settings-privacy-card"><div><span className="eyebrow dark">Incognito access</span><h2>Approved<br /><em>people.</em></h2><p>Add an exact Convo ID to let someone find you while Incognito mode is enabled. Existing accepted connections remain allowed.</p></div><div className="privacy-control-list"><form className="privacy-control" onSubmit={(event) => { event.preventDefault(); const id = approvedIdDraft.trim(); if (!id || !onSetApprovedPerson) return; void onSetApprovedPerson(id, true).then((result) => { if (!result.ok) { toast.error("Couldn’t add approved person", { description: result.error }); return; } setApprovedIdDraft(""); void loadApprovedPeople(); toast.success("Approved person added"); }); }}><span><b>Add by exact Convo ID</b><small>Example: MTU-26-7K4Q2</small></span><input aria-label="Exact Convo ID" value={approvedIdDraft} onChange={(event) => setApprovedIdDraft(event.target.value)} placeholder="MTU-…" /><button className="outline-button" type="submit" disabled={!onSetApprovedPerson || !approvedIdDraft.trim()}>Add</button></form>{approvedPeopleLoading ? <p>Loading approved people…</p> : approvedPeopleError ? <p role="alert">{approvedPeopleError}</p> : approvedPeople.length ? approvedPeople.map((person) => <div className="blocked-student-row" key={person.approved_id}><span><b>{person.display_name || "MTU student"}</b><small>{person.student_id || "Convo ID unavailable"}</small></span><button className="outline-button" type="button" onClick={() => { if (!onSetApprovedPerson) return; void onSetApprovedPerson(person.student_id || person.approved_id, false).then((result) => { if (!result.ok) { toast.error("Couldn’t remove approved person", { description: result.error }); return; } setApprovedPeople((current) => current.filter((item) => item.approved_id !== person.approved_id)); toast.success("Approved person removed"); }); }}>Remove</button></div>) : <p>No approved people yet.</p>}</div></article>;

  const renderMessagingPrivacy = () => <article className="settings-privacy-card messaging-privacy-card"><div><span className="eyebrow dark">Messaging privacy</span><h2>Set your<br /><em>boundaries.</em></h2><p>These controls affect who can start conversations or calls with you and which presence signals you share.</p></div><div className="privacy-control-list messaging-privacy-list"><label className="privacy-control"><span><b>Who can message you</b><small>New direct conversations</small></span><select aria-label="Who can message you" value={messagingPrivacy.allow_messages} disabled={messagingPrivacySaving} onChange={(event) => void updateMessagingPrivacy({ allow_messages: event.target.value as MtuPrivacySettings["allow_messages"] })}><option value="everyone">Everyone verified</option><option value="connections">Connections only</option><option value="nobody">Nobody new</option></select></label><label className="privacy-control"><span><b>Who can call you</b><small>Voice and video call requests</small></span><select aria-label="Who can call you" value={messagingPrivacy.allow_calls} disabled={messagingPrivacySaving} onChange={(event) => void updateMessagingPrivacy({ allow_calls: event.target.value as MtuPrivacySettings["allow_calls"] })}><option value="everyone">Everyone verified</option><option value="connections">Connections only</option><option value="nobody">Nobody new</option></select></label>{([['show_read_receipts', 'Read receipts', 'Let people know when you have seen a message.'], ['show_online_status', 'Online status', 'Show when you are currently active.'], ['allow_group_invites', 'Group invitations', 'Allow verified students to invite you to groups.']] as const).map(([field, label, description]) => <label key={field} className="privacy-control"><span><b>{label}</b><small>{description}</small></span><button type="button" role="switch" aria-label={`Toggle ${label}`} aria-checked={messagingPrivacy[field]} className={`theme-toggle ${messagingPrivacy[field] ? "is-dark" : ""}`} onClick={() => void updateMessagingPrivacy({ [field]: !messagingPrivacy[field] })} disabled={messagingPrivacySaving}><i /></button></label>)}<label className="privacy-control"><span><b>Disappearing messages</b><small>Applies to new messages in supported conversations.</small></span><select aria-label="Disappearing messages duration" value={messagingPrivacy.disappearing_messages_seconds} disabled={messagingPrivacySaving} onChange={(event) => void updateMessagingPrivacy({ disappearing_messages_seconds: Number(event.target.value) as MtuPrivacySettings["disappearing_messages_seconds"] })}><option value={0}>Off</option><option value={86400}>24 hours</option><option value={604800}>7 days</option><option value={2592000}>30 days</option></select></label></div></article>;

  const unblockStudent = async (blockedId: string) => {
    if (!onUnblockStudent) return;
    const result = await onUnblockStudent(blockedId);
    if (!result.ok) { toast.error("Couldn’t unblock student", { description: result.error || "Please try again." }); return; }
    setBlockedStudents((current) => current.filter((student) => student.blocked_id !== blockedId));
    toast.success("Student unblocked", { description: "They are not reconnected automatically." });
  };
  const renderBlockedStudents = () => <article className="settings-privacy-card blocked-students-card"><div><span className="eyebrow dark">Safety & privacy</span><h2>Blocked<br /><em>students.</em></h2><p>Only you can view this list. Unblocking does not restore a connection or reopen a chat.</p></div><div className="blocked-students-list">{blockedStudentsLoading ? <p>Loading your blocked students…</p> : blockedStudentsError ? <p role="alert">{blockedStudentsError}</p> : blockedStudents.length ? blockedStudents.map((student) => <div className="blocked-student-row" key={student.blocked_id}><span className="conversation-avatar">{student.avatar_url ? <img src={student.avatar_url} alt="" /> : (student.nickname || student.display_name || "?").slice(0, 2).toUpperCase()}</span><span><b>{student.nickname || student.display_name || "Blocked student"}</b><small>{student.student_id || "Public student ID unavailable"}</small></span><button className="outline-button" type="button" onClick={() => void unblockStudent(student.blocked_id)}>Unblock</button></div>) : <p>No students are blocked.</p>}</div></article>;

  const renderSettings = () => <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Your Convo</span><h1>Small details.<br /><em>Your space.</em></h1><p>Manage appearance and identity without exposing information beyond your chosen privacy settings.</p></div></div><div className="settings-stack"><article className="settings-row"><span><Download size={17} /></span><div><b>Install Convo</b><small>Download Convo to your laptop as a desktop app without using the Microsoft Store.</small></div>{installState === "installed" ? <span className="settings-value">Installed</span> : <button className="outline-button" type="button" onClick={() => window.dispatchEvent(new Event("convo-install-request"))}>{installState === "available" ? "Install app" : "How to install"}</button>}</article><article className="settings-row"><span><SunMoon size={17} /></span><div><b>Appearance</b><small>Choose the atmosphere that feels right for your study day.</small></div><button className={`theme-toggle ${isDarkMode ? "is-dark" : ""}`} type="button" role="switch" aria-checked={isDarkMode} aria-label="Toggle dark mode" onClick={() => setIsDarkMode((value) => !value)}><i /></button></article><article className="settings-row public-identity-row"><span><UserRound size={17} /></span><div><b>Public identity</b><small>Your nickname and public student ID remain discoverable.</small></div><button className="outline-button" onClick={() => openView("profile")}>Edit profile</button><button className="outline-button public-identity-share" onClick={shareMyProfile}>Share profile</button></article>{renderPrivacyControls()}{renderApprovedPeople()}{renderMessagingPrivacy()}{renderBlockedStudents()}  <article className="settings-row"><span><Bell size={17} /></span><div><b>Notifications</b><small>Get alerts for new messages and calls.</small></div><button type="button" role="switch" aria-label="Toggle message and call notifications" aria-checked={notificationsEnabled} className={`theme-toggle ${notificationsEnabled ? "is-dark" : ""}`} onClick={() => { const next = !notificationsEnabled; onSetNotificationsEnabled?.(next); if (next && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission(); }}><i /></button></article></div></section>;

  const renderDigitalId = () => <section className="workspace-view premium-feature-view"><div className="workspace-heading"><div><span className="eyebrow dark">Verified identity</span><h1>Your campus<br /><em>card.</em></h1><p>Only your chosen public information appears on this card. Your legal name stays private.</p></div></div><div className="digital-id-layout"><StudentIdCard nickname={displayName} displayName={legalName || displayName} studentId={studentId} programme={programme || major} college={department} level={level} /><div className="digital-id-copy"><span className="eyebrow dark">Privacy by design</span><h2>One card.<br /><em>Your terms.</em></h2><p>Use your public student ID to help verified classmates find you. Academic visibility can be adjusted from your profile.</p><button className="outline-button" onClick={() => openView("profile")}>Manage profile <ArrowRight size={14} /></button></div></div></section>;

  const renderProfile = () => <section className="workspace-view profile-view"><input ref={profileAvatarInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a new profile photo" onChange={(event) => { void changeProfileAvatar(event.target.files?.[0] || null); event.currentTarget.value = ""; }} /><header className="profile-summary"><button type="button" className="profile-summary-avatar profile-summary-avatar-button" aria-label={avatarUrl ? "View your larger profile photo" : "Choose a profile photo"} onClick={() => avatarUrl ? setLargeHeaderImage({ url: avatarUrl, name: displayName || "Your profile", isOwn: true }) : profileAvatarInputRef.current?.click()}>{avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{displayName ? displayName.slice(0, 2).toUpperCase() : "?"}</span>}</button><div className="profile-summary-copy"><span className="eyebrow dark">Your Convo profile</span><h1>{displayName || firstName || "Your profile"}</h1><p>{programme || major || "Complete your academic details"}{level ? ` · ${level}` : ""}</p></div><div className="profile-summary-status"><span><ShieldCheck size={14} /> MTU verified</span><button className="outline-button" type="button" onClick={() => profileAvatarInputRef.current?.click()} disabled={!onUpdateAvatar}>Change photo</button><button className="outline-button" onClick={() => { setProfileDraft({ nickname: displayName, programme: programme || major, college: department, level, bio }); setShowEditProfile(true); }}>Edit profile <ArrowRight size={15} /></button></div></header><div className="profile-content"><div className="profile-id-panel"><div className="profile-panel-heading"><div><span className="eyebrow dark">Your public card</span><h2>Share your<br /><em>student identity.</em></h2></div><button className="text-link" onClick={() => toast("Your public card only shows the details you choose to share.")}>How it works <ArrowRight size={14} /></button></div><StudentIdCard nickname={displayName} displayName={legalName || displayName} studentId={studentId} programme={programme || major} college={department} level={level} /><div className="profile-id-row"><span>Public student ID</span><strong>{studentId || "Complete your profile to receive an ID."}</strong><button className="text-link" aria-label="Copy student ID" onClick={() => toast("Student ID copied.")}>Copy</button></div></div><aside className="profile-details-panel"><div className="profile-panel-heading"><div><span className="eyebrow dark">Profile details</span><h2>Your campus<br /><em>at a glance.</em></h2></div></div><div className="profile-facts"><div><span>Programme</span><b>{programme || major || "Not set yet"}</b></div><div><span>College</span><b>{department || "Not set yet"}</b></div><div><span>Level</span><b>{level || "Not set yet"}</b></div><div><span>Privacy</span><b><ShieldCheck size={14} /> MTU verified</b></div></div>{bio && <div className="profile-bio"><span>About</span><p>{bio}</p></div>}<div className="profile-actions"><button className="primary-button" onClick={() => { setProfileDraft({ nickname: displayName, programme: programme || major, college: department, level, bio }); setShowEditProfile(true); }}>Update details <ArrowRight size={15} /></button><button className="outline-button" onClick={() => openView("discover")}><Search size={15} /> Find people</button></div></aside></div>{showEditProfile && <div className="profile-edit-backdrop" role="presentation" onClick={() => setShowEditProfile(false)}><div className="profile-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close edit profile" onClick={() => setShowEditProfile(false)}>×</button><div className="profile-edit-card-preview"><StudentIdCard nickname={profileDraft.nickname || "Your nickname"} displayName={legalName || profileDraft.nickname || "Your name"} studentId={studentId} programme={profileDraft.programme} college={profileDraft.college} level={profileDraft.level} /></div><div className="profile-edit-copy"><span className="eyebrow dark">Quick edit</span><h2 id="edit-profile-title">Keep your<br /><em>identity current.</em></h2><p>Only your nickname is public. Your legal name remains private.</p></div><form className="profile-edit-form" onSubmit={saveProfileDraft}><input className="auth-input" aria-label="Public nickname" value={profileDraft.nickname} onChange={(event) => setProfileDraft((current) => ({ ...current, nickname: event.target.value }))} placeholder="Nickname" required /><select className="auth-input auth-select" aria-label="Edit college" value={profileDraft.college} onChange={(event) => setProfileDraft((current) => ({ ...current, college: event.target.value }))}><option value="">Choose college</option>{Array.from(new Set([profileDraft.college, ...MTU_COLLEGE_OPTIONS])).filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}</select><select className="auth-input auth-select" aria-label="Edit programme" value={profileDraft.programme} onChange={(event) => setProfileDraft((current) => ({ ...current, programme: event.target.value }))}><option value="">Choose programme</option>{Array.from(new Set([profileDraft.programme, ...MTU_PROGRAMME_OPTIONS])).filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}</select><select className="auth-input auth-select" aria-label="Edit level" value={profileDraft.level} onChange={(event) => setProfileDraft((current) => ({ ...current, level: event.target.value }))}><option value="">Choose level</option>{Array.from(new Set([profileDraft.level, ...MTU_LEVEL_OPTIONS])).filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}</select><textarea className="auth-input profile-bio-input" aria-label="Edit bio" value={profileDraft.bio} onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value }))} placeholder="About you (optional)" rows={3} /><div className="profile-edit-actions"><button type="button" className="outline-button" onClick={() => setShowEditProfile(false)}>Cancel</button><button type="submit" className="primary-button" disabled={profileSaving || !onUpdateProfile}>{profileSaving ? "Saving…" : "Save changes"} <Check size={15} /></button></div></form></div></div>}</section>;

  return <StudentIdCardVisibilityContext.Provider value={visibilityDraft}><main className={`dashboard-shell ${isDarkMode ? "theme-dark" : ""} ${isExiting ? "is-exiting" : ""} ${isEntering ? "is-entering" : ""}`}>
    <header className="dashboard-topbar"><button className="brand" onClick={() => openView("home")} aria-label="Open Convo home"><span className="brand-mark"><span /><span /><span /></span><span><b>Convo</b><small>MTU COMMUNITY</small></span></button><div className="dashboard-topbar-center"><span className="topbar-location"><span className="pulse-dot" /> {navLabel(activeView)}</span></div><div className="dashboard-actions"><button className="icon-button" aria-label={unreadConversationCount ? `Notifications, ${unreadConversationCount} unread messages` : "Notifications"} onClick={() => openView("notifications")}><Bell size={17} />{unreadConversationCount > 0 && <i className="notification-dot has-unread">{unreadConversationCount > 9 ? "9+" : unreadConversationCount}</i>}</button><button className="profile-chip" onClick={() => openView("profile")}><span className="profile-chip-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{(displayName || "MT").slice(0, 2).toUpperCase()}</span>}</span><b>{displayName || "Your profile"}</b><ChevronRight size={14} /></button><button className="logout-button" onClick={() => setShowLogoutConfirm(true)}>Log out</button></div></header>
    <div className="dashboard-body"><aside className="convo-sidebar" aria-label="Convo navigation"><div className="sidebar-section-label">Workspace</div><nav>{sidebarNavItems.map((item) => <button key={item.view} className={`sidebar-nav-item ${activeView === item.view ? "is-active" : ""}`} onClick={() => openView(item.view)} aria-current={activeView === item.view ? "page" : undefined} aria-label={`Open ${navLabel(item.view)}`}><span>{item.icon}</span><b>{navLabel(item.view)}</b>{item.badge && <i>{item.badge}</i>}</button>)}</nav></aside><nav ref={dockRef} className="convo-top-dock" aria-label="Convo workspace" onPointerMove={moveDock} onPointerLeave={resetDock}>{primaryNavItems.map((item) => <button key={item.view} className={`dock-item ${activeView === item.view ? "is-active" : ""} ${item.badge && (item.view === "messages" || item.view === "notifications") ? "has-unread" : ""}`} onClick={() => openView(item.view)} aria-current={activeView === item.view ? "page" : undefined} aria-label={navLabel(item.view)}><span className="dock-icon-wrap">{item.icon}{item.badge && <i>{item.badge}</i>}</span><span className="dock-tooltip" role="tooltip">{navLabel(item.view)}</span></button>)}<span className="dock-divider" aria-hidden="true" /><div className="dock-more-wrap"><button className={`dock-item ${showMoreMenu ? "is-active" : ""}`} onClick={() => setShowMoreMenu((open) => !open)} aria-label="More" aria-expanded={showMoreMenu} aria-haspopup="menu"><MoreHorizontal size={17} /><span className="dock-tooltip" role="tooltip">More</span></button>{showMoreMenu && <div className="dock-menu" role="menu"><button role="menuitem" onClick={() => { setShowMoreMenu(false); openView("events"); }}><span>Events</span><small>Group events, polls, tasks, and announcements</small></button><button role="menuitem" onClick={() => { setShowMoreMenu(false); openView("settings"); }}><span>Settings</span><small>Personalize your space</small></button><button role="menuitem" onClick={() => { setShowMoreMenu(false); setShowLogoutConfirm(true); }}><span>Log out</span><small>Close this session safely</small></button></div>}</div><span className="dock-status"><span className="pulse-dot" /><small>MTU verified</small></span></nav><div className="dashboard-atmosphere"><ConvoOrbit /></div><div className="dashboard-content">{activeView === "home" && renderHome()}{activeView === "discover" && renderDiscover()}{activeView === "messages" && renderMessages()}{activeView === "notifications" && renderNotifications()}{activeView === "profile" && renderProfile()}{activeView === "groups" && renderGroups()}{activeView === "campus" && renderCampus()}{activeView === "events" && renderEvents()}{activeView === "files" && renderFiles()}{activeView === "assistant" && renderAssistant()}{activeView === "vault" && renderVault()}{activeView === "settings" && renderSettings()}{activeView === "id" && renderDigitalId()}</div></div>
    {showLogoutConfirm && <div className="logout-backdrop" role="presentation" onClick={() => setShowLogoutConfirm(false)}><div className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title" onClick={(event) => event.stopPropagation()}><span className="logout-orbit"><Check size={18} /></span><span className="eyebrow dark">SECURE EXIT</span><h2 id="logout-title">Leave Convo<br /><em>for now?</em></h2><p>Your session will close safely on this device.</p><div className="logout-dialog-actions"><button className="outline-button" onClick={() => setShowLogoutConfirm(false)}>Stay in Convo</button><button className="primary-button" onClick={() => { if (onLogout) void onLogout(); else setShowLogoutConfirm(false); }}>Log out safely <ArrowRight size={15} /></button></div></div></div>}
  </main></StudentIdCardVisibilityContext.Provider>;
}
