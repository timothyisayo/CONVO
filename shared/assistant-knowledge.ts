export const CONVO_WORKSPACE_VIEWS = [
  "home",
  "discover",
  "messages",
  "notifications",
  "profile",
  "groups",
  "feed",
  "campus",
  "marketplace",
  "events",
  "files",
  "assistant",
  "vault",
  "settings",
  "id",
] as const;

export type ConvoWorkspaceView = (typeof CONVO_WORKSPACE_VIEWS)[number];
export type ConvoFeatureStatus = "available" | "conditional" | "unavailable";

export type ConvoFeature = {
  id: string;
  name: string;
  view: ConvoWorkspaceView;
  status: ConvoFeatureStatus;
  description: string;
  howTo: string;
  actions: string[];
};

export function getConvoFeatureRegistry(vaultEnabled: boolean): ConvoFeature[] {
  return [
    {
      id: "home",
      name: "Home",
      view: "home",
      status: "available",
      description: "The Convo home workspace and personalized overview.",
      howTo: "Open Home from the workspace navigation to see your Convo overview.",
      actions: ["View your home overview"],
    },
    {
      id: "messages",
      name: "Messages",
      view: "messages",
      status: "available",
      description: "Direct and group conversations, messages, and shared files.",
      howTo: "Open Messages, choose a conversation, and use its composer to send a message or attachment.",
      actions: ["Send messages", "Open a conversation's shared files"],
    },
    {
      id: "notifications",
      name: "Notifications",
      view: "notifications",
      status: "available",
      description: "Your Convo activity and notification inbox.",
      howTo: "Open Notifications from the workspace navigation to review activity.",
      actions: ["Review notification activity"],
    },
    {
      id: "profile",
      name: "Profile",
      view: "profile",
      status: "available",
      description: "Your Convo profile and profile information.",
      howTo: "Open Profile from the workspace navigation to review your profile.",
      actions: ["View your profile"],
    },
    {
      id: "settings",
      name: "Settings and privacy",
      view: "settings",
      status: "available",
      description: "Profile visibility, privacy, notification preferences, and account controls.",
      howTo: "Open Settings from the workspace navigation and use the relevant settings panel.",
      actions: ["Manage privacy and notification preferences"],
    },
    {
      id: "discover",
      name: "Discover students",
      view: "discover",
      status: "available",
      description: "Search for discoverable students using available profile information.",
      howTo: "Open Discover and search by a student's name or other supported profile details.",
      actions: ["Search discoverable student profiles"],
    },
    {
      id: "groups",
      name: "Groups and communities",
      view: "groups",
      status: "available",
      description: "Discover and manage Convo groups and group conversations.",
      howTo: "Open Groups to search for groups or manage groups you belong to.",
      actions: ["Search groups", "Open group conversations"],
    },
    {
      id: "events",
      name: "Group events",
      view: "events",
      status: "available",
      description: "Events and shared activity for groups you belong to.",
      howTo: "Open Events and select one of your groups to view its events and activity.",
      actions: ["View group events and activity"],
    },
    {
      id: "feed",
      name: "Feed and Campus Hub",
      view: "feed",
      status: "conditional",
      description: "One social destination for member-submitted posts, public Stories, and existing community discussions.",
      howTo: "Open Feed to browse and publish community posts and public Stories. Private Stories are shared with accepted connections in Messages.",
      actions: ["Browse, publish, edit, delete, or react to community posts", "View and publish public Stories", "Open Marketplace as a separate destination"],
    },
    {
      id: "marketplace",
      name: "Student Marketplace",
      view: "marketplace",
      status: "conditional",
      description: "A peer-to-peer area for student-posted listings; Convo does not verify sellers, items, prices, or payments.",
      howTo: "Open Student Marketplace to search listings, create your own listing, or message a seller.",
      actions: ["Search listings", "Create, edit, mark sold, relist, or delete your own listing", "Message a seller"],
    },
    {
      id: "stories",
      name: "Stories",
      view: "feed",
      status: "conditional",
      description: "Temporary member-submitted updates that expire after 24 hours.",
      howTo: "Open Feed for public Stories, or Messages for private Stories shared with accepted, unblocked connections.",
      actions: ["Publish and view Stories", "Delete your own Story"],
    },
    {
      id: "files",
      name: "Shared files",
      view: "files",
      status: "available",
      description: "Files shared in your conversations.",
      howTo: "Open Files or a conversation's Shared Files panel to review conversation attachments.",
      actions: ["Review shared conversation files"],
    },
    {
      id: "assistant",
      name: "Study assistant",
      view: "assistant",
      status: "available",
      description: "Ask study questions or attach supported documents and images for analysis.",
      howTo: "Open the Study Assistant, type a question, or attach a supported file.",
      actions: ["Ask a study question", "Attach a PDF, text file, CSV, JSON file, or image"],
    },
    {
      id: "vault",
      name: "Convo Vault",
      view: "vault",
      status: vaultEnabled ? "conditional" : "unavailable",
      description: vaultEnabled
        ? "A private source library that requires the configured Vault service."
        : "The private source library is shown as coming soon in this deployment.",
      howTo: vaultEnabled
        ? "Open Convo Vault to add a source and ask questions about your private library."
        : "Attach a supported file to the Study Assistant instead; Convo Vault is not enabled in this deployment.",
      actions: vaultEnabled ? ["Add and ask about private sources"] : ["Ask about an attached file in the Study Assistant"],
    },
    {
      id: "student-id",
      name: "Student ID card",
      view: "id",
      status: "available",
      description: "Your Convo student ID card and sharing controls.",
      howTo: "Open Student ID from the workspace navigation to view your card.",
      actions: ["View your student ID card"],
    },
  ];
}
