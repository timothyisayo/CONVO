import {
  getConvoFeatureRegistry,
  type ConvoWorkspaceView,
} from "@shared/assistant-knowledge";

export type AssistantHelpAction = {
  label: string;
  view: ConvoWorkspaceView;
};

export type AssistantHelpAnswer = {
  text: string;
  action?: AssistantHelpAction;
};

export type AssistantPageContext = {
  view?: ConvoWorkspaceView;
  vaultEnabled?: boolean;
};

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function editDistanceAtMostOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  if (leftIndex < left.length || rightIndex < right.length) edits += 1;
  return edits <= 1;
}

function hasTerm(question: string, terms: string[]) {
  const normalized = normalize(question);
  const words = normalized.split(" ");
  return terms.some((term) => {
    const normalizedTerm = normalize(term);
    if (normalized.includes(normalizedTerm)) return true;
    if (normalizedTerm.includes(" ")) return false;
    return words.some(
      (word) =>
        word === normalizedTerm ||
        (normalizedTerm.length >= 6 &&
          word.length >= 6 &&
          editDistanceAtMostOne(word, normalizedTerm)),
    );
  });
}

function findFeature(
  id: string,
  vaultEnabled: boolean,
) {
  return getConvoFeatureRegistry(vaultEnabled).find((feature) => feature.id === id);
}

export function getLocalAssistantAnswer(
  question: string,
  context: AssistantPageContext = {},
): AssistantHelpAnswer | null {
  const normalized = normalize(question);
  if (!normalized) return null;

  const vaultEnabled = context.vaultEnabled ?? false;
  const registry = getConvoFeatureRegistry(vaultEnabled);

  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)$/.test(normalized)) {
    return { text: "Hi! I can explain how Convo works, point you to its available features, or help with a study question. What would you like to do?" };
  }

  if (
    (hasTerm(question, ["what can you do", "what can i do", "what can the assistant do", "what can timothy do", "features", "capabilities"]) &&
      hasTerm(question, ["you", "convo", "website", "assistant", "do", "features", "capabilities"])) ||
    /^(what can i do|what can you do|what can the assistant do|what can timothy do|what does convo do|how do i use this website)$/.test(normalized)
  ) {
    const availableFeatures = registry.filter((feature) => feature.status !== "unavailable");
    const list = availableFeatures
      .map((feature) => `- **${feature.name}:** ${feature.description}`)
      .join("\n");
    return {
      text: `Here are the features currently present in Convo:\n\n${list}\n\nSome data depends on the deployment and your account permissions. I’ll say so when a feature is conditional rather than presenting it as live.`,
    };
  }

  if (hasTerm(question, ["notification", "notifications", "alert", "alerts"])) {
    const settingsQuestion = hasTerm(question, ["turn off", "disable", "stop", "manage", "settings", "change", "quiet"]);
    const feature = findFeature(settingsQuestion ? "settings" : "notifications", vaultEnabled);
    return {
      text: settingsQuestion
        ? "Open **Settings** from the Convo workspace navigation, then use the notification preferences there. The app also has a Notifications view for reviewing activity."
        : "Open **Notifications** from the workspace navigation to review recent activity. Notification preferences are in **Settings**.",
      action: feature ? { label: `Open ${feature.name}`, view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["privacy", "who can see", "visibility", "blocked", "block"])) {
    const feature = findFeature("settings", vaultEnabled);
    return {
      text: "Open **Settings** to review profile visibility and privacy controls. The controls shown there are the available settings for your account.",
      action: feature ? { label: "Open Settings", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["find students", "discover students", "classmates", "student directory", "search students", "people in my department", "students in my department"])) {
    const feature = findFeature("discover", vaultEnabled);
    return {
      text: "Open **Discover** and search for students. Results respect the profile information and discoverability settings students have made available.",
      action: feature ? { label: "Open Discover", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["profile", "avatar", "picture", "programme", "edit my details"])) {
    const feature = findFeature("profile", vaultEnabled);
    return {
      text: "Open **Profile** from the workspace navigation to review your profile. Use the profile editing controls there to change supported details.",
      action: feature ? { label: "Open Profile", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["study group", "groups", "community", "communities", "join a group", "create a group"])) {
    const feature = findFeature("groups", vaultEnabled);
    return {
      text: "Open **Groups** to search for groups or manage groups you belong to. Group membership and available actions depend on each group's settings.",
      action: feature ? { label: "Open Groups", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["send a message", "message someone", "start a chat", "start conversation", "chat with"])) {
    const feature = findFeature("messages", vaultEnabled);
    return {
      text: "Open **Messages**, choose an existing conversation or start one from a student's profile, and type into the conversation composer.",
      action: feature ? { label: "Open Messages", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["lecture notes", "past questions", "resource", "resources", "download notes", "study guide"])) {
    const feature = findFeature(vaultEnabled ? "vault" : "assistant", vaultEnabled);
    return {
      text: vaultEnabled
        ? "Your private **Convo Vault** is enabled. Add a source there, then ask a question about the material. You can also attach a supported document or image here for study help."
        : "**Convo Vault is currently marked as coming soon in this deployment**, so I can’t search a stored course-resource library. To get help with material now, attach a supported PDF, TXT, CSV, JSON file, or image to the Study Assistant.",
      action: feature ? { label: `Open ${feature.name}`, view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["seller", "sell", "marketplace", "buy", "listing", "textbook for sale"])) {
    const feature = findFeature("marketplace", vaultEnabled);
    return {
      text: "Convo’s **Student Marketplace** is a separate peer-to-peer area for member-posted listings. Open Student Marketplace to search, publish or manage your own listing, and message a seller. Convo does not verify items, sellers, prices, or payments.",
      action: feature ? { label: "Open Student Marketplace", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["story", "stories", "status", "post a story"])) {
    const feature = findFeature("feed", vaultEnabled);
    return {
      text: "Open **Campus** to view and publish Convo status updates. They are member-submitted and expire; they are not official university information.",
      action: feature ? { label: "Open Campus Stories", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["report", "inappropriate content", "spam", "copyright"])) {
    return {
      text: "I can’t confirm a general report flow for every content type in the current workspace. Use a report control only where it is visibly available; tell me which page or content you mean and I’ll guide you based on that feature.",
    };
  }

  if (
    hasTerm(question, ["group", "groups", "community", "communities"]) &&
    hasTerm(question, ["event", "events", "announcement", "announcements", "deadline", "deadlines"])
  ) {
    const feature = findFeature("events", vaultEnabled);
    return {
      text: "Convo's **Events** view contains activity for groups you belong to. I can’t search group records from this chat, so open Events and select the relevant group. Group posts are not official university notices.",
      action: feature ? { label: "Open Group Events", view: feature.view } : undefined,
    };
  }

  if (
    hasTerm(question, ["event", "events", "announcement", "announcements", "deadline", "deadlines", "campus"]) &&
    hasTerm(question, ["where", "how do i find", "how do i open", "how to access", "navigate"])
  ) {
    const feature = findFeature("feed", vaultEnabled);
    return {
      text: "Open **Campus** to review Convo's community feed and status updates. The page shows whether content is live, empty, or unavailable. Posts and stories are member-submitted, not official university information.",
      action: feature ? { label: "Open Campus", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, [
    "announcement",
    "announcements",
    "scholarship",
    "scholarships",
    "opportunity",
    "opportunities",
    "deadline",
    "deadlines",
    "campus events",
    "university events",
    "official events",
    "institutional information",
    "university information",
    "official university",
  ])) {
    return {
      text: "Convo is an independent student platform, not an official university information source, and I don’t have a verified institutional data source to search. I can’t confirm announcements, scholarships, opportunities, or deadlines here. Please check the university’s official channels; treat related Convo posts as user-submitted unless explicitly marked as verified.",
    };
  }

  if (hasTerm(question, ["file", "files", "attachment", "attachments", "shared file"])) {
    const feature = findFeature("files", vaultEnabled);
    return {
      text: "Shared files are attached to conversations. Open **Files** or the relevant conversation's Shared Files panel to review available attachments.",
      action: feature ? { label: "Open Shared Files", view: feature.view } : undefined,
    };
  }

  if (hasTerm(question, ["where am i", "what page", "what screen", "this page"])) {
    const current = context.view
      ? registry.find((feature) => feature.view === context.view)
      : undefined;
    return current
      ? { text: `You’re in **${current.name}**. ${current.description}` }
      : null;
  }

  if (hasTerm(question, ["why isn't", "not working", "doesn't work", "error", "broken", "can't"])) {
    return {
      text: "I can help troubleshoot, but I need the feature name and the exact error or what happened. I won’t guess at a cause without that information.",
    };
  }

  return null;
}

export function assistantUnavailableFallback(code?: string) {
  if (code === "DAILY_QUOTA_EXHAUSTED") {
    return "Gemini’s daily free-tier allowance is exhausted for now. I can still answer verified Convo how-to questions locally, but complex study explanations and analysis of attached documents need the AI provider. Try those again when the provider quota resets.";
  }
  if (code === "AI_RATE_LIMITED") {
    return "Gemini is temporarily rate-limiting requests. Verified Convo how-to help still works locally; try advanced study generation again shortly.";
  }
  if (code === "AI_PROVIDER_AUTH") {
    return "Gemini rejected the server's provider credentials. Verified Convo how-to help still works locally; an administrator needs to check the server-side AI configuration.";
  }
  if (code === "AI_PROVIDER_UNAVAILABLE") {
    return "Gemini is temporarily unavailable or not configured. Verified Convo how-to help still works locally; complex study generation needs the provider.";
  }
  if (code === "APP_COOLDOWN") {
    return "The Study Assistant’s usage cooldown is active. Verified Convo how-to answers still work locally; try generative study help again when the cooldown ends.";
  }
  return "Advanced AI generation is temporarily unavailable. I can still answer verified Convo how-to questions locally. I can’t reliably analyze a document or answer a complex study question until generation is available.";
}
