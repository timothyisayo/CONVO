// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CampusPanels } from "./CampusPanels";

const base = { stories: [], posts: [], groups: [], isLoading: false, error: null, isLive: false, onAction: () => undefined };

afterEach(() => cleanup());

describe("CampusPanels rendered state matrix", () => {
  it("renders loading copy for all panels", () => {
    render(<CampusPanels {...base} isLoading />);
    expect(screen.getByText("Loading stories…")).toBeTruthy();
    expect(screen.getByText("Gathering the latest conversations…")).toBeTruthy();
    expect(screen.getByText("Loading your groups…")).toBeTruthy();
  });

  it("renders error copy for all panels", () => {
    render(<CampusPanels {...base} error="missing tables" />);
    expect(screen.getByText("Stories unavailable")).toBeTruthy();
    expect(screen.getByText("We couldn’t load posts right now. Please try again shortly.")).toBeTruthy();
    expect(screen.getByText("Groups unavailable — please try again shortly.")).toBeTruthy();
  });

  it("renders empty copy for all panels", () => {
    render(<CampusPanels {...base} />);
    expect(screen.getByText("No stories yet — start the first one.")).toBeTruthy();
    expect(screen.getByText("No posts yet — your campus pulse starts here.")).toBeTruthy();
    expect(screen.getByText("No groups yet — create the first circle.")).toBeTruthy();
  });

  it("does not invent community records when live panels are empty", () => {
    render(<CampusPanels {...base} isLive />);
    expect(screen.queryByText("Ada")).toBeNull();
    expect(screen.queryByText("Mariam A.")).toBeNull();
    expect(screen.queryByText("Computer Science")).toBeNull();
  });

  it("renders supplied live content states", () => {
    const content = {
      stories: [{ id: "s1", name: "Ada", initials: "AO", tone: "rose" }],
      posts: [{ id: "p1", author_name: "Ada", author_meta: "Level 300", body: "Hello Convo", tone: "rose", created_at: "2026-01-01", likes: 0 }],
      groups: [{ id: "g1", name: "Computer Science", meta: "Level circle", tone: "sage", members: 20, active: true }],
    };
    const { rerender } = render(<CampusPanels {...base} {...content} />);
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    expect(screen.getByText("Hello Convo")).toBeTruthy();
    expect(screen.getByText("Computer Science")).toBeTruthy();
    rerender(<CampusPanels {...base} {...content} isLive />);
    expect(screen.getByText("updated just now")).toBeTruthy();
  });
});
