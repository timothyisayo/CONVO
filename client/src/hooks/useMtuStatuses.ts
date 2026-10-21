import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMtuStatus,
  listMtuStatuses,
  publishMtuStatus,
  recordMtuStatusView,
  subscribeToMtuStatuses,
  supabase,
  type MtuStatusAudience,
  type MtuStatus,
  type MtuStatusDraft,
} from "@/lib/supabase";

export function useMtuStatuses(currentUserId: string, audience: MtuStatusAudience) {
  const [statuses, setStatuses] = useState<MtuStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!supabase) {
      if (mountedRef.current) {
        setStatuses([]);
        setError("Sign in to view Status updates.");
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) setLoading(true);
    try {
      const result = await listMtuStatuses(supabase, audience);
      if (!mountedRef.current) return;
      if (result.error) {
        setError(result.error.message);
        setStatuses([]);
      } else {
        setError("");
        setStatuses(result.data.filter((status) => Date.parse(status.expires_at) > Date.now()));
      }
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught.message : "Status updates could not be loaded.");
      setStatuses([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [audience]);

  useEffect(() => {
    if (!currentUserId || !supabase) {
      setStatuses([]);
      setLoading(false);
      return;
    }
    void refresh();
    return subscribeToMtuStatuses(supabase, () => { void refresh(); });
  }, [currentUserId, audience, refresh]);

  const publish = useCallback(async (draft: MtuStatusDraft) => {
    if (!supabase || !currentUserId) return { data: null, error: "Sign in to post a Story.", persisted: false };
    try {
      const result = await publishMtuStatus(supabase, currentUserId, draft);
      if (mountedRef.current && result.data?.audience === audience) {
        setStatuses((current) => [...current.filter((item) => item.status_id !== result.data!.status_id), result.data!]);
      }
      return {
        data: result.data,
        error: result.error?.message || (result.persisted && !result.data ? "Your Story was saved, but its preview could not be refreshed." : null),
        persisted: result.persisted,
      };
    } catch (caught) {
      return { data: null, error: caught instanceof Error ? caught.message : "Story could not be posted.", persisted: false };
    }
  }, [currentUserId, audience]);

  const remove = useCallback(async (statusId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete a Status." };
    try {
      const result = await deleteMtuStatus(supabase, statusId);
      if (mountedRef.current && result.data) setStatuses((current) => current.filter((status) => status.status_id !== statusId));
      return result.error
        ? { ok: Boolean(result.data), error: result.error.message }
        : { ok: result.data };
    } catch (caught) {
      return { ok: false, error: caught instanceof Error ? caught.message : "Status could not be deleted." };
    }
  }, []);

  const markViewed = useCallback(async (statusId: string) => {
    if (!supabase || !currentUserId) return { ok: false, error: "Sign in to view Status updates." };
    const result = await recordMtuStatusView(supabase, statusId, currentUserId);
    if (!result.error && mountedRef.current) {
      setStatuses((current) => current.map((status) => status.status_id === statusId
        ? {
            ...status,
            viewed_by_me: true,
          }
        : status));
    }
    return result.error ? { ok: false, error: result.error.message } : { ok: true };
  }, [currentUserId]);

  return { statuses, loading, error, refresh, publish, remove, markViewed };
}
