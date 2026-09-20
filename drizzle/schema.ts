import { int, mysqlEnum, mysqlTable, timestamp, varchar, text, bigint } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).notNull().default("user"),
  lastSignedIn: timestamp("lastSignedIn").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const campusPosts = mysqlTable("campus_posts", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  authorId: bigint("author_id", { mode: "number", unsigned: true }).notNull(),
  authorName: varchar("author_name", { length: 120 }).notNull(),
  authorMeta: varchar("author_meta", { length: 220 }).notNull(),
  body: text("body").notNull(),
  tone: varchar("tone", { length: 24 }).notNull().default("rose"),
  likes: int("likes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const campusStories = mysqlTable("campus_stories", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  authorId: bigint("author_id", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  initials: varchar("initials", { length: 8 }).notNull(),
  tone: varchar("tone", { length: 24 }).notNull().default("rose"),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  isActive: int("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const campusGroups = mysqlTable("campus_groups", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  meta: varchar("meta", { length: 160 }).notNull(),
  tone: varchar("tone", { length: 24 }).notNull().default("sage"),
  members: int("members").notNull().default(0),
  active: int("active").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const campusProfiles = mysqlTable("campus_profiles", {
  userId: bigint("user_id", { mode: "number", unsigned: true }).primaryKey(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  level: varchar("level", { length: 32 }),
  department: varchar("department", { length: 180 }),
  programme: varchar("programme", { length: 180 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
