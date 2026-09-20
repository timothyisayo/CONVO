import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, campusGroups, campusPosts, campusProfiles, campusStories, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
    catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) { if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; } }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb(); if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getCampusSnapshot() {
  const db = await getDb();
  if (!db) return { posts: [], stories: [], groups: [] };
  const [posts, stories, groups] = await Promise.all([
    db.select().from(campusPosts).orderBy(desc(campusPosts.createdAt)).limit(12),
    db.select().from(campusStories).where(eq(campusStories.isActive, 1)).orderBy(desc(campusStories.createdAt)).limit(12),
    db.select().from(campusGroups).orderBy(desc(campusGroups.active), desc(campusGroups.createdAt)).limit(12),
  ]);
  return { posts, stories, groups };
}

export async function createCampusPost(input: typeof campusPosts.$inferInsert) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  await db.insert(campusPosts).values(input);
  return getCampusSnapshot();
}

export async function upsertCampusProfile(input: typeof campusProfiles.$inferInsert) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  const current = await db.select().from(campusProfiles).where(eq(campusProfiles.userId, input.userId)).limit(1);
  if (current[0]) await db.update(campusProfiles).set(input).where(eq(campusProfiles.userId, input.userId));
  else await db.insert(campusProfiles).values(input);
}

export async function createCampusStory(input: typeof campusStories.$inferInsert) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  await db.insert(campusStories).values(input);
  return getCampusSnapshot();
}

export async function createCampusGroup(input: typeof campusGroups.$inferInsert) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  await db.insert(campusGroups).values(input);
  return getCampusSnapshot();
}
