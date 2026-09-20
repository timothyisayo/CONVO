import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type CampusStory = { id: string; name: string; initials: string; tone: string; avatar_url?: string | null };
export type CampusPost = { id: string; author_name: string; author_meta: string; body: string; tone: string; created_at: string; likes: number };
export type CampusGroup = { id: string; name: string; meta: string; tone: string; members: number; active: boolean };
export type CampusPanelState = "loading" | "error" | "empty" | "preview" | "live";

export function getCampusPanelState(input: { isLoading: boolean; error: string | null; hasItems: boolean; isPreview: boolean }): CampusPanelState {
  if (input.isLoading) return "loading";
  if (input.error) return "error";
  if (!input.hasItems) return "empty";
  return input.isPreview ? "preview" : "live";
}

type MembershipClient = { rpc: (name: string, args?: Record<string, string>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };

export async function joinCampusGroup(client: MembershipClient, userId: string, groupId: string) {
  const { data, error } = await client.rpc("join_campus_group", { p_group_id: groupId });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, alreadyJoined: data === false };
}

export function useCampusData() {
  const [stories, setStories] = useState<CampusStory[]>([]);
  const [posts, setPosts] = useState<CampusPost[]>([]);
  const [groups, setGroups] = useState<CampusGroup[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [joinedGroupIds, setJoinedGroupIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) { setIsLoading(false); return; }
    let active = true;
    const load = async () => {
      const { data: authData } = await client.auth.getUser();
      const currentUserId = authData.user?.id || null;
      if (active) setUserId(currentUserId);
      const [storiesResult, postsResult, groupsResult] = await Promise.all([
        client.from("campus_stories").select("id,name,initials,tone,avatar_url").eq("is_active", true).order("created_at", { ascending: false }).limit(8),
        client.from("campus_posts").select("id,author_name,author_meta,body,tone,created_at,likes").order("created_at", { ascending: false }).limit(6),
        client.from("campus_groups").select("id,name,meta,tone,members,active").order("active", { ascending: false }).limit(6),
      ]);
      const membershipResult = currentUserId ? await client.rpc("get_my_campus_group_memberships") : { data: [], error: null };
      if (!active) return;
      const firstError = storiesResult.error || postsResult.error || groupsResult.error || membershipResult.error;
      if (firstError) setError(firstError.message);
      if (!storiesResult.error) setStories((storiesResult.data || []) as CampusStory[]);
      if (!postsResult.error) setPosts((postsResult.data || []) as CampusPost[]);
      if (!groupsResult.error) setGroups((groupsResult.data || []) as CampusGroup[]);
      if (!membershipResult.error) setJoinedGroupIds((membershipResult.data || []).map((membership: { group_id: string }) => membership.group_id));
      setIsLive(!storiesResult.error && !postsResult.error && !groupsResult.error && !membershipResult.error);
      setIsLoading(false);
    };
    void load();
    const channel = client.channel("campus-live").on("postgres_changes", { event: "*", schema: "public", table: "campus_posts" }, () => void load()).on("postgres_changes", { event: "*", schema: "public", table: "campus_groups" }, () => void load()).on("postgres_changes", { event: "*", schema: "public", table: "campus_group_memberships" }, () => void load()).subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, []);

  const joinGroup = useCallback(async (groupId: string) => {
    if (!supabase || !userId) return { ok: false, error: "Sign in to join a group." };
    if (joinedGroupIds.includes(groupId)) return { ok: true, alreadyJoined: true };
    const result = await joinCampusGroup(supabase, userId, groupId);
    if (!result.ok) return result;
    setJoinedGroupIds((current) => current.includes(groupId) ? current : [...current, groupId]);
    return { ok: true, alreadyJoined: false };
  }, [joinedGroupIds, userId]);

  return { stories, posts, groups, joinedGroupIds, joinGroup, isLive, isLoading, error, mode: supabase ? (isLive ? "live" : "connecting") : "setup" as const };
}
