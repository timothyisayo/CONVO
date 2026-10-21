import { describe, expect, it } from "vitest";
import { assistantUnavailableFallback, getLocalAssistantAnswer } from "./assistant-help";

describe("local assistant help", () => {
  it("answers common website navigation without relying on Gemini", () => {
    const answer = getLocalAssistantAnswer("How do I turn off notifications?");
    expect(answer?.text).toContain("notification preferences");
    expect(answer?.action).toEqual({ label: "Open Settings and privacy", view: "settings" });
  });

  it("handles common wording and a one-character spelling error", () => {
    const answer = getLocalAssistantAnswer("Where are notifcations?");
    expect(answer?.action?.view).toBe("notifications");
  });

  it("builds the feature guide from verified available features only", () => {
    const answer = getLocalAssistantAnswer("What can I do on Convo?");
    expect(answer?.text).toContain("Messages");
    expect(answer?.text).toContain("Campus");
    expect(answer?.text).toContain("Student Marketplace");
    expect(answer?.text).not.toContain("Convo Vault:");
  });

  it("describes the real peer-to-peer Marketplace without implying verification", () => {
    const answer = getLocalAssistantAnswer("How do I sell a textbook?");
    expect(answer?.text).toContain("peer-to-peer area");
    expect(answer?.text).toContain("does not verify items");
    expect(answer?.action).toEqual({ label: "Open Student Marketplace", view: "marketplace" });
  });

  it("does not search for or invent institutional information", () => {
    const answer = getLocalAssistantAnswer("Are there any scholarship opportunities?");
    expect(answer?.text).toContain("independent student platform");
    expect(answer?.text).toContain("don’t have a verified institutional data source");
    expect(answer?.text).not.toContain("I found");
  });

  it("explains the Convo Campus page without implying its posts are official", () => {
    const navigationAnswer = getLocalAssistantAnswer("Where do I find campus announcements?");
    const dataAnswer = getLocalAssistantAnswer("Are there any official announcements?");
    expect(navigationAnswer?.action?.view).toBe("feed");
    expect(navigationAnswer?.text).toContain("member-submitted");
    expect(dataAnswer?.text).toContain("not an official university information source");
    expect(dataAnswer?.text).toContain("don’t have a verified institutional data source");
  });

  it("keeps group announcements distinct from official university information", () => {
    const answer = getLocalAssistantAnswer("What is the latest announcement in my group?");
    expect(answer?.action?.view).toBe("events");
    expect(answer?.text).toContain("not official university notices");
  });

  it("does not claim to know upcoming university events", () => {
    const answer = getLocalAssistantAnswer("What campus events are happening?");
    expect(answer?.text).toContain("not an official university information source");
  });

  it("routes story help to the persisted Campus status feed", () => {
    const answer = getLocalAssistantAnswer("How do I post a story?");
    expect(answer?.action).toEqual({ label: "Open Campus Stories", view: "feed" });
    expect(answer?.text).toContain("member-submitted");
  });

  it("routes document-help questions to the right available path", () => {
    const vaultDisabled = getLocalAssistantAnswer("How do I find past questions?");
    const vaultEnabled = getLocalAssistantAnswer("How do I find past questions?", { vaultEnabled: true });
    expect(vaultDisabled?.text).toContain("coming soon");
    expect(vaultDisabled?.action?.view).toBe("assistant");
    expect(vaultEnabled?.action?.view).toBe("vault");
  });

  it("does not fabricate answers for unknown questions", () => {
    expect(getLocalAssistantAnswer("Explain a theorem I have not named")).toBeNull();
  });

  it("explains the daily provider quota fallback accurately", () => {
    expect(assistantUnavailableFallback("DAILY_QUOTA_EXHAUSTED")).toContain("daily free-tier allowance");
  });
});
