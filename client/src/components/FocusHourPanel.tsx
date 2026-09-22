import React from "react";
import { Clock3, Eye, Square } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { endMtuFocusHour, getMyMtuFocusHour, listMtuFocusHours, startMtuFocusHour, subscribeToMtuFocusHours, type MtuFocusHour, type MtuFocusParticipant } from "@/lib/supabase";
import { toast } from "sonner";

type Props = { client: SupabaseClient | null };

function remaining(endsAt: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
}
function label(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

export function FocusHourPanel({ client }: Props) {
  const [mine, setMine] = React.useState<MtuFocusHour | null>(null);
  const [participants, setParticipants] = React.useState<MtuFocusParticipant[]>([]);
  const [seconds, setSeconds] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const refresh = React.useCallback(async () => {
    if (!client) return;
    const [own, others] = await Promise.all([getMyMtuFocusHour(client), listMtuFocusHours(client)]);
    setMine(own.data); setParticipants(others.data);
    setSeconds(own.data ? remaining(own.data.ends_at) : 0);
  }, [client]);
  React.useEffect(() => { void refresh(); if (!client) return; return subscribeToMtuFocusHours(client, () => { void refresh(); }); }, [client, refresh]);
  React.useEffect(() => {
    if (!mine) return;
    const timer = window.setInterval(() => {
      const next = remaining(mine.ends_at);
      setSeconds(next);
      if (!next) { setMine(null); void refresh(); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mine, refresh]);
  React.useEffect(() => {
    if (!participants.length) return;
    const timer = window.setInterval(() => {
      setParticipants((current) => current.filter((person) => remaining(person.ends_at) > 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [participants.length]);
  const start = async (minutes: 30 | 45 | 60) => {
    if (!client) return;
    setBusy(true); const result = await startMtuFocusHour(client, minutes); setBusy(false);
    if (result.error) { toast.error("Couldn’t start Focus Hour", { description: result.error.message }); return; }
    if (result.data) { setMine(result.data); setSeconds(remaining(result.data.ends_at)); }
  };
  const end = async () => { if (!client) return; setBusy(true); const result = await endMtuFocusHour(client); setBusy(false); if (result.error) { toast.error("Couldn’t end Focus Hour", { description: result.error.message }); return; } setMine(null); setSeconds(0); void refresh(); };
  return <section className="dashboard-panel focus-hour-panel" aria-label="Focus Hour">
    <div className="panel-heading"><div><span className="eyebrow dark"><Clock3 size={14} /> Focus Hour</span><h2>{mine ? "Your focus is on." : "Make space to focus."}</h2></div>{mine && <button className="text-link" onClick={() => void end()} disabled={busy}><Square size={13} /> End</button>}</div>
    {mine ? <div className="focus-hour-active"><strong data-testid="focus-countdown">{label(seconds)}</strong><span>Quiet time until {new Date(mine.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div> : <><p className="focus-hour-copy">Set a personal study block. Only eligible classmates who are also focusing can see you.</p><div className="focus-hour-options">{([30, 45, 60] as const).map((minutes) => <button key={minutes} className="outline-button" onClick={() => void start(minutes)} disabled={busy}>{minutes} min</button>)}</div></>}
    <div className="focus-hour-others"><span><Eye size={14} /> {participants.length ? `${participants.length} classmate${participants.length === 1 ? "" : "s"} focusing` : "No classmates are focusing yet"}</span>{participants.slice(0, 3).map((person) => <span key={person.user_id}>{person.display_name || "MTU student"} · {label(remaining(person.ends_at))}</span>)}</div>
  </section>;
}
