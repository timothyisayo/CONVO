import { useEffect, useRef, useState } from "react";
import { FileText, Link, MessageCircle, Plus, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addVaultNote,
  addVaultSource,
  askVault,
  loadVault,
  type VaultNote,
  type VaultSource,
} from "@/lib/vault";

type Props = { client: SupabaseClient | null };
const vaultEnabled = import.meta.env.VITE_ENABLE_VAULT === "true";

export function VaultPanel({ client }: Props) {
  const [sources, setSources] = useState<VaultSource[]>([]);
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!client || !vaultEnabled) return;
    const vaultClient = client;
    void loadVault(vaultClient)
      .then((data) => {
        setSources(data.sources || []);
        setNotes(data.notes || []);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Vault could not load."));
  }, [client]);
  if (!client) {
    return <section className="workspace-view premium-feature-view"><div className="premium-empty-state"><h2>Sign in to open Convo Vault.</h2><p>Your Vault is private to your Supabase account.</p></div></section>;
  }
  if (!vaultEnabled) {
    return (
      <section className="workspace-view premium-feature-view vault-coming-soon">
        <div className="vault-coming-soon-card">
          <span className="eyebrow dark"><Sparkles size={14} /> AI Writing</span>
          <h1>AI Writing — <em>Coming Soon</em></h1>
          <p>
            A private space for turning your notes and sources into thoughtful
            study help is in development. We&apos;re polishing the experience
            before it becomes available in Convo.
          </p>
          <span className="vault-coming-soon-badge">In development</span>
        </div>
      </section>
    );
  }
  const vaultClient = client;

  const run = async (action: () => Promise<void>) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Vault could not complete that action.");
    } finally {
      setBusy(false);
    }
  };

  const addUrl = () => run(async () => {
    if (!url.trim()) throw new Error("Enter a website URL first.");
    const source = await addVaultSource(vaultClient, { type: "link", url: url.trim() });
    setSources((current) => [source, ...current]);
    setUrl("");
  });

  const addNote = () => run(async () => {
    if (!noteContent.trim()) throw new Error("Write something for your Vault note first.");
    const note = await addVaultNote(vaultClient, { title: noteTitle.trim() || "Vault note", content: noteContent.trim() });
    setNotes((current) => [note, ...current]);
    setNoteTitle("");
    setNoteContent("");
  });

  const addFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void run(async () => {
      const source = await addVaultSource(vaultClient, {
        type: "upload",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        data: String(reader.result || ""),
      });
      setSources((current) => [source, ...current]);
      setFileName(file.name);
    });
    reader.onerror = () => toast.error(`Could not read ${file.name}.`);
    reader.readAsDataURL(file);
  };

  const ask = () => run(async () => {
    if (!question.trim()) throw new Error("Ask a question about your Vault sources.");
    const result = await askVault(vaultClient, question.trim());
    setAnswer(result.answer);
  });

  return (
    <section className="workspace-view premium-feature-view assistant-view">
      <div className="assistant-heading">
        <div>
          <span className="eyebrow dark"><MessageCircle size={13} /> Convo Vault</span>
          <h1>Your sources,<br /><em>your answers.</em></h1>
          <p>Private PDFs, documents, notes, websites, and supported video URLs processed by Open Notebook with local Ollama Qwen and embeddings.</p>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <div className="panel-heading"><div><span className="eyebrow dark">Add knowledge</span><h2>Build your Vault</h2></div></div>
          <div className="vault-actions">
            <label><Link size={15} /> Website URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /><button type="button" onClick={addUrl} disabled={busy}><Plus size={14} /> Add website</button></label>
            <label><FileText size={15} /> Note title<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Lecture 4" /><textarea value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="Paste or write a note..." /><button type="button" onClick={addNote} disabled={busy}><Plus size={14} /> Save note</button></label>
            <button type="button" className="outline-button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={15} /> {fileName || "Upload PDF or document"}</button>
            <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,.ppt,.pptx" onChange={(event) => { addFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </div>
        </section>
        <section className="dashboard-panel">
          <div className="panel-heading"><div><span className="eyebrow dark">Private RAG</span><h2>Ask your Vault</h2></div></div>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What do my sources say about..." />
          <button type="button" className="primary-button" onClick={ask} disabled={busy}><MessageCircle size={15} /> {busy ? "Working..." : "Ask local Qwen"}</button>
          {answer && <div className="vault-answer"><strong>Vault answer</strong><p>{answer}</p></div>}
        </section>
      </div>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><span className="eyebrow dark">Your private library</span><h2>{sources.length + notes.length} items</h2></div></div>
        <div className="dashboard-empty">{sources.length ? sources.map((source) => <p key={source.id}>{source.title || "Untitled source"} · {source.status || "processing"}</p>) : null}{notes.map((note) => <p key={note.id}>{note.title || "Vault note"} · note</p>)}{!sources.length && !notes.length && <p>Add your first source to start building your private knowledge base.</p>}</div>
      </section>
    </section>
  );
}
