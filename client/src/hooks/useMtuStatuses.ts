import { useCallback, useEffect, useState } from "react";
import {
  deleteMtuStatus,
  listMtuStatuses,
  publishMtuStatus,
  recordMtuStatusView,
  subscribeToMtuStatuses,
  supabase,
  type MtuStatus,
  type MtuStatusDraft,
} from "@/lib/supabase";

export function useMtuStatuses(currentUserId: string) {
  const [statuses, setStatuses] = useState<MtuStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase) {
      setStatuses([]);
      setError("Sign in to view Status updates.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await listMtuStatuses(supabase);
      if (result.error) {
        setError(result.error.message);
        setStatuses([]);
      } else {
        setError("");
        setStatuses(result.data.filter((status) => Date.parse(status.expires_at) > Date.now()));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Status updates could not be loaded.");
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUserId || !supabase) {
      setStatuses([]);
      setLoading(false);
      return;
    }
    void refresh();
    return subscribeToMtuStatuses(supabase, () => { void refresh(); });
  }, [currentUserId, refresh]);

  const publish = useCallback(async (draft: MtuStatusDraft) => {
    if (!supabase || !currentUserId) return { data: null, error: "Sign in to post a Status." };
    try {
      const result = await publishMtuStatus(supabase, currentUserId, draft);
      if (result.error) return { data: null, error: result.error.message };
      if (result.data) setStatuses((current) => [...current.filter((item) => item.status_id !== result.data!.status_id), result.data!]);
      return { data: result.data, error: result.data ? null : "Your Status was saved, but the preview could not be refreshed." };
    } catch (caught) {
      return { data: null, error: caught instanceof Error ? caught.message : "Status could not be posted." };
    }
  }, [currentUserId]);

  const remove = useCallback(async (statusId: string) => {
    if (!supabase) return { ok: false, error: "Sign in to delete a Status." };
    try {
      const result = await deleteMtuStatus(supabase, statusId);
      if (result.data) setStatuses((current) => current.filter((status) => status.status_id !== statusId));
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
    if (!result.error) {
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
