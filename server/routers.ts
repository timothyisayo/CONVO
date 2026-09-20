import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { isMtuEmail } from "@shared/mtu";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createCampusGroup, createCampusPost, createCampusStory, getCampusSnapshot, upsertCampusProfile } from "./db";

const campusPostInput = z.object({
  body: z.string().trim().min(1).max(2000),
  authorMeta: z.string().trim().min(1).max(220),
  tone: z.enum(["rose", "apricot", "sage", "butter"]).default("rose"),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    validateMtuEmail: publicProcedure.input(z.object({ email: z.string().email() })).query(({ input }) => ({
      allowed: isMtuEmail(input.email),
    })),
  }),
  campus: router({
    snapshot: protectedProcedure.query(({ ctx }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can access campus data.");
      return getCampusSnapshot();
    }),
    createPost: protectedProcedure.input(campusPostInput).mutation(({ ctx, input }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can post.");
      return createCampusPost({ authorId: ctx.user.id, authorName: ctx.user.name || "MTU student", authorMeta: input.authorMeta, body: input.body, tone: input.tone, likes: 0 });
    }),
    listStories: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can read stories.");
      return (await getCampusSnapshot()).stories;
    }),
    listGroups: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can read groups.");
      return (await getCampusSnapshot()).groups;
    }),
    getProfile: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can read profiles.");
      return { userId: ctx.user.id, displayName: ctx.user.name || "MTU student" };
    }),
    saveProfile: protectedProcedure.input(z.object({ displayName: z.string().trim().min(1).max(120), level: z.string().max(32).optional(), department: z.string().max(180).optional(), programme: z.string().max(180).optional() })).mutation(({ ctx, input }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can create profiles.");
      return upsertCampusProfile({ userId: ctx.user.id, ...input });
    }),
    createStory: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(120), initials: z.string().trim().min(1).max(8), tone: z.string().max(24).default("rose"), avatarUrl: z.string().url().optional() })).mutation(({ ctx, input }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU accounts can create stories.");
      return createCampusStory({ authorId: ctx.user.id, ...input, isActive: 1 });
    }),
    createGroup: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(180), meta: z.string().trim().min(1).max(160), tone: z.string().max(24).default("sage") })).mutation(({ ctx, input }) => {
      if (!ctx.user.email || !isMtuEmail(ctx.user.email)) throw new Error("Only verified MTU admins can create official groups.");
      if (ctx.user.role !== "admin") throw new Error("Only Convo admins can create official groups.");
      return createCampusGroup({ ...input, members: 0, active: 0 });
    }),
  }),
});

export type AppRouter = typeof appRouter;
