import React, { useEffect, useRef, useState } from "react";
import { Download, FileText, Link, MessageCircle, Pencil, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addVaultNote,
  addVaultSource,
  askVault,
  deleteVaultNote,
  deleteVaultSource,
  downloadVaultSource,
  loadVault,
  updateVaultNote,
  updateVaultSource,
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
  const [editingItem, setEditingItem] = useState<{ kind: "source" | "note"; id: string; title: string; content: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "source" | "note"; id: string } | null>(null);
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

  const saveItemEdit = () => run(async () => {
    if (!editingItem?.id || !editingItem.title.trim()) throw new Error("A title is required.");
    if (editingItem.kind === "source") {
      const updated = await updateVaultSource(vaultClient, editingItem.id, editingItem.title.trim());
      setSources((current) => current.map((source) => source.id === editingItem.id ? { ...source, ...updated } : source));
    } else {
      const updated = await updateVaultNote(vaultClient, editingItem.id, editingItem.title.trim(), editingItem.content);
      setNotes((current) => current.map((note) => note.id === editingItem.id ? { ...note, ...updated } : note));
    }
    setEditingItem(null);
  });

  const removeItem = (kind: "source" | "note", id: string) => run(async () => {
    if (kind === "source") {
      await deleteVaultSource(vaultClient, id);
      setSources((current) => current.filter((source) => source.id !== id));
    } else {
      await deleteVaultNote(vaultClient, id);
      setNotes((current) => current.filter((note) => note.id !== id));
    }
    setConfirmDelete(null);
  });

  const downloadSource = (source: VaultSource) => run(async () => {
    if (!source.id) throw new Error("This source does not have a downloadable identifier.");
    const blob = await downloadVaultSource(vaultClient, source.id);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = (source.title || "vault-source").replace(/[\\/:*?"<>|]/g, "-");
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
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
            <label><FileText size={15} /> Note title<input value={noteTitle} maxLength={120} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Lecture 4" /><textarea value={noteContent} maxLength={20000} onChange={(event) => setNoteContent(event.target.value)} placeholder="Paste or write a note..." /><button type="button" onClick={addNote} disabled={busy}><Plus size={14} /> Save note</button></label>
            <button type="button" className="outline-button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={15} /> {fileName || "Upload PDF or document"}</button>
            <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,.ppt,.pptx" onChange={(event) => { addFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </div>
        </section>
        <section className="dashboard-panel">
          <div className="panel-heading"><div><span className="eyebrow dark">Private RAG</span><h2>Ask your Vault</h2></div></div>
          <textarea value={question} maxLength={4000} onChange={(event) => setQuestion(event.target.value)} placeholder="What do my sources say about..." />
          <button type="button" className="primary-button" onClick={ask} disabled={busy}><MessageCircle size={15} /> {busy ? "Working..." : "Ask local Qwen"}</button>
          {answer && <div className="vault-answer"><strong>Vault answer</strong><p>{answer}</p></div>}
        </section>
      </div>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><span className="eyebrow dark">Your private library</span><h2>{sources.length + notes.length} items</h2></div></div>
        <div className="vault-library">
          {sources.map((source) => <article className="vault-library-item" key={source.id}>
            <div><b>{source.title || "Untitled source"}</b><small>{source.type || "Source"} · {source.status || "processing"}</small></div>
            <div className="vault-item-actions">
              {source.id && <button type="button" aria-label={`Edit ${source.title || "source"}`} onClick={() => setEditingItem({ kind: "source", id: source.id!, title: source.title || "", content: "" })}><Pencil size={14} /></button>}
              {source.id && (source.type === "upload" || source.type === "file") && <button type="button" aria-label={`Download ${source.title || "source"}`} onClick={() => void downloadSource(source)} disabled={busy}><Download size={14} /></button>}
              {source.id && (confirmDelete?.kind === "source" && confirmDelete.id === source.id
                ? <span><button type="button" onClick={() => void removeItem("source", source.id!)} disabled={busy}>Delete</button><button type="button" aria-label="Cancel delete" onClick={() => setConfirmDelete(null)}><X size={14} /></button></span>
                : <button type="button" aria-label={`Delete ${source.title || "source"}`} onClick={() => setConfirmDelete({ kind: "source", id: source.id! })}><Trash2 size={14} /></button>)}
            </div>
          </article>)}
          {notes.map((note) => <article className="vault-library-item" key={note.id}>
            <div><b>{note.title || "Vault note"}</b><small>Private note</small></div>
            <div className="vault-item-actions">
              {note.id && <button type="button" aria-label={`Edit ${note.title || "note"}`} onClick={() => setEditingItem({ kind: "note", id: note.id!, title: note.title || "", content: note.content || "" })}><Pencil size={14} /></button>}
              {note.id && (confirmDelete?.kind === "note" && confirmDelete.id === note.id
                ? <span><button type="button" onClick={() => void removeItem("note", note.id!)} disabled={busy}>Delete</button><button type="button" aria-label="Cancel delete" onClick={() => setConfirmDelete(null)}><X size={14} /></button></span>
                : <button type="button" aria-label={`Delete ${note.title || "note"}`} onClick={() => setConfirmDelete({ kind: "note", id: note.id! })}><Trash2 size={14} /></button>)}
            </div>
          </article>)}
          {!sources.length && !notes.length && <p>Add your first source to start building your private knowledge base.</p>}
        </div>
      </section>
      {editingItem && <div className="vault-edit-backdrop" role="presentation" onClick={() => setEditingItem(null)}><section className="vault-edit-dialog" role="dialog" aria-modal="true" aria-label={`Edit Vault ${editingItem.kind}`} onClick={(event) => event.stopPropagation()}>
        <div><h2>Edit {editingItem.kind}</h2><button type="button" aria-label="Close edit form" onClick={() => setEditingItem(null)}><X size={16} /></button></div>
        <label>Title<input value={editingItem.title} maxLength={120} onChange={(event) => setEditingItem((current) => current ? { ...current, title: event.target.value } : current)} /></label>
        {editingItem.kind === "note" && <label>Note content<textarea value={editingItem.content} maxLength={20000} onChange={(event) => setEditingItem((current) => current ? { ...current, content: event.target.value } : current)} /></label>}
        <button type="button" className="primary-button" onClick={() => void saveItemEdit()} disabled={busy || !editingItem.title.trim()}>{busy ? "Saving..." : "Save changes"}</button>
      </section></div>}
    </section>
  );
}
