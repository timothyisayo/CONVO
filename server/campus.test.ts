import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  snapshot: { posts: [], stories: [], groups: [] },
  getCampusSnapshot: vi.fn(async () => dbMocks.snapshot),
  createCampusPost: vi.fn(async (input) => ({ ...dbMocks.snapshot, created: input })),
  upsertCampusProfile: vi.fn(async (input) => input),
  createCampusStory: vi.fn(async (input) => ({ ...dbMocks.snapshot, created: input })),
  createCampusGroup: vi.fn(async (input) => ({ ...dbMocks.snapshot, created: input })),
}));

vi.mock("./db", () => ({
  getCampusSnapshot: dbMocks.getCampusSnapshot,
  createCampusPost: dbMocks.createCampusPost,
  upsertCampusProfile: dbMocks.upsertCampusProfile,
  createCampusStory: dbMocks.createCampusStory,
  createCampusGroup: dbMocks.createCampusGroup,
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function publicContext(): TrpcContext {
  return { user: undefined, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function userContext(email = "student@mtu.edu.ng", role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: { id: 7, openId: "student-7", email, name: "MTU Student", loginMethod: "test", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("campus account and access rules", () => {
  it("allows only official MTU email domains", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.auth.validateMtuEmail({ email: "student@mtu.edu.ng" })).resolves.toEqual({ allowed: true });
    await expect(caller.auth.validateMtuEmail({ email: "student@gmail.com" })).resolves.toEqual({ allowed: false });
  });

  it("requires verified MTU access for campus reads", async () => {
    await expect(appRouter.createCaller(publicContext()).campus.snapshot()).rejects.toThrow();
    await expect(appRouter.createCaller(userContext("student@gmail.com")).campus.listStories()).rejects.toThrow("Only verified MTU accounts can read stories.");
    await expect(appRouter.createCaller(userContext("student@gmail.com")).campus.listGroups()).rejects.toThrow("Only verified MTU accounts can read groups.");
  });
});

describe("campus procedures", () => {
  it("returns typed snapshot, story, group, and profile reads", async () => {
    const caller = appRouter.createCaller(userContext());
    await expect(caller.campus.snapshot()).resolves.toEqual(dbMocks.snapshot);
    await expect(caller.campus.listStories()).resolves.toEqual([]);
    await expect(caller.campus.listGroups()).resolves.toEqual([]);
    await expect(caller.campus.getProfile()).resolves.toMatchObject({ userId: 7, displayName: "MTU Student" });
  });

  it("supports successful MTU profile, story, and admin group writes", async () => {
    const caller = appRouter.createCaller(userContext());
    await expect(caller.campus.saveProfile({ displayName: "Ada", level: "300", department: "Computing", programme: "Computer Science" })).resolves.toMatchObject({ userId: 7, displayName: "Ada" });
    await expect(caller.campus.createStory({ name: "Ada", initials: "AO", tone: "rose" })).resolves.toHaveProperty("created");
    const adminCaller = appRouter.createCaller(userContext("admin@mtu.edu.ng", "admin"));
    await expect(adminCaller.campus.createGroup({ name: "Computer Science", meta: "Level circle", tone: "sage" })).resolves.toHaveProperty("created");
  });

  it("rejects unauthenticated writes and invalid input", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.campus.createPost({ body: "Hello", authorMeta: "Level 300", tone: "rose" })).rejects.toThrow();
    await expect(caller.campus.saveProfile({ displayName: "" })).rejects.toThrow();
    await expect(appRouter.createCaller(userContext()).campus.createPost({ body: "", authorMeta: "Level 300", tone: "rose" })).rejects.toThrow();
    await expect(appRouter.createCaller(userContext()).campus.saveProfile({ displayName: "" })).rejects.toThrow();
  });

  it("protects stories, groups, and posts from non-MTU or non-admin writers", async () => {
    await expect(appRouter.createCaller(userContext("student@gmail.com")).campus.createStory({ name: "Guest", initials: "GU", tone: "rose" })).rejects.toThrow("Only verified MTU accounts can create stories.");
    await expect(appRouter.createCaller(userContext()).campus.createGroup({ name: "Student group", meta: "Level circle", tone: "sage" })).rejects.toThrow("Only Convo admins can create official groups.");
    await expect(appRouter.createCaller(userContext("student@gmail.com")).campus.createPost({ body: "Hello", authorMeta: "Level 300", tone: "rose" })).rejects.toThrow("Only verified MTU accounts can post.");
  });
});
