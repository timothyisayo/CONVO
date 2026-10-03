import React from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  Eye,
  FlipHorizontal,
  Italic,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Smile,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { STATUS_MEDIA_MAX_BYTES, type MtuStatus, type MtuStatusDraft } from "@/lib/supabase";
import { useMtuStatuses } from "@/hooks/useMtuStatuses";
import "./status-stories.css";

type TextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  background: string;
  opacity: number;
  font: string;
  bold: boolean;
  italic: boolean;
  rotation: number;
  align: "left" | "center" | "right";
};
type Stroke = { points: Array<{ x: number; y: number }>; color: string; width: number };
type EditorState = {
  media: File | null;
  kind: "text" | "image" | "video";
  text: string;
  background: string;
  textFont: string;
  textSize: number;
  textBold: boolean;
  textItalic: boolean;
  textAlignment: "left" | "center" | "right";
  filter: string;
  fit: "cover" | "contain";
  zoom: number;
  rotation: number;
  panX: number;
  panY: number;
  layers: TextLayer[];
  strokes: Stroke[];
  activeTool: "select" | "draw" | "erase";
  brushColor: string;
  brushSize: number;
};
type StatusStoriesProps = { currentUserId: string; displayName: string; avatarUrl?: string };

const emptyEditor = (): EditorState => ({
  media: null,
  kind: "text",
  text: "",
  background: "#594149",
  textFont: fontChoices[0].value,
  textSize: 42,
  textBold: true,
  textItalic: false,
  textAlignment: "center",
  filter: "none",
  fit: "cover",
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  layers: [],
  strokes: [],
  activeTool: "select",
  brushColor: "#ffffff",
  brushSize: 5,
});

const fontChoices = [
  { label: "Editorial", value: "Georgia, serif" },
  { label: "Modern", value: "Arial, sans-serif" },
  { label: "Rounded", value: "Trebuchet MS, sans-serif" },
  { label: "Mono", value: "monospace" },
];
const filters: Array<{ label: string; value: string }> = [
  { label: "Original", value: "none" },
  { label: "Bright", value: "brightness(1.13) saturate(1.08)" },
  { label: "Warm", value: "sepia(.22) saturate(1.12)" },
  { label: "Cool", value: "hue-rotate(12deg) saturate(.9)" },
  { label: "B&W", value: "grayscale(1)" },
  { label: "Vintage", value: "sepia(.36) contrast(.94) saturate(.8)" },
];
const emojiOptions = ["✨", "❤️", "😂", "🌿", "🎉", "☀️", "📚", "🙌"];

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function makeTextLayer(text = "Your words") : TextLayer {
  return { id: crypto.randomUUID(), text, x: 50, y: 50, size: 32, color: "#ffffff", background: "transparent", opacity: 1, font: fontChoices[0].value, bold: true, italic: false, rotation: 0, align: "center" };
}

function StatusMediaOverlays({ layers, strokes }: { layers: TextLayer[]; strokes: Stroke[] }) {
  return (
    <div className="status-media-overlays" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">{strokes.map((stroke, index) => <polyline key={index} points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.width / 3} strokeLinecap="round" strokeLinejoin="round" />)}</svg>
      {layers.map((layer) => <span key={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, color: layer.color, background: layer.background, fontFamily: layer.font, fontSize: `clamp(15px, ${layer.size / 3.6}vw, ${layer.size}px)`, fontWeight: layer.bold ? 700 : 400, fontStyle: layer.italic ? "italic" : "normal", opacity: layer.opacity, textAlign: layer.align, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}>{layer.text}</span>)}
    </div>
  );
}

function StatusPreview({ status, onNext }: { status: MtuStatus; onNext: () => void }) {
  const metadata = status.metadata || {};
  const advanced = React.useRef(false);
  const background = typeof metadata.background === "string" ? metadata.background : "#594149";
  const style = metadata.text_style && typeof metadata.text_style === "object" ? metadata.text_style as Record<string, unknown> : {};
  const layers = Array.isArray(metadata.layers) ? metadata.layers.filter((layer): layer is TextLayer => typeof layer === "object" && layer !== null && "text" in layer) : [];
  const strokes = Array.isArray(metadata.strokes) ? metadata.strokes.filter((stroke): stroke is Stroke => typeof stroke === "object" && stroke !== null && "points" in stroke) : [];
  const filter = typeof metadata.filter === "string" ? metadata.filter : undefined;
  const rotation = typeof metadata.rotation === "number" ? metadata.rotation : 0;
  const zoom = typeof metadata.zoom === "number" ? metadata.zoom : 1;
  const panX = typeof metadata.pan_x === "number" ? metadata.pan_x : 0;
  const panY = typeof metadata.pan_y === "number" ? metadata.pan_y : 0;
  const fit = metadata.fit === "contain" ? "contain" : "cover";
  const clipStart = typeof metadata.clip_start === "number" ? metadata.clip_start : 0;
  const clipEnd = typeof metadata.clip_end === "number" ? metadata.clip_end : 0;
  const advance = (video: HTMLVideoElement) => {
    if (advanced.current) return;
    advanced.current = true;
    video.pause();
    onNext();
  };
  return (
    <div className="status-viewer-media">
      {status.media_url ? status.status_type === "video"
        ? <video src={status.media_url} autoPlay muted playsInline controls preload="metadata" style={{ filter, objectFit: fit, objectPosition: `${50 + panX}% ${50 + panY}%`, transform: `rotate(${rotation}deg) scale(${zoom})` }} onLoadedMetadata={(event) => { advanced.current = false; if (clipStart > 0) event.currentTarget.currentTime = clipStart; }} onTimeUpdate={(event) => { if (clipEnd > clipStart && event.currentTarget.currentTime >= clipEnd) advance(event.currentTarget); }} onEnded={(event) => advance(event.currentTarget)} />
        : <img src={status.media_url} alt="" />
        : <div className="status-text-slide" style={{ background, color: typeof style.color === "string" ? style.color : "#fff", fontFamily: typeof style.font === "string" ? style.font : "Georgia, serif", fontSize: typeof style.size === "number" ? `${style.size}px` : undefined, fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : undefined, textAlign: typeof style.align === "string" ? style.align as React.CSSProperties["textAlign"] : "center" }}>{status.text_content}</div>}
      {status.status_type === "video" && <StatusMediaOverlays layers={layers} strokes={strokes} />}
      {status.media_url && status.text_content && <p className="status-viewer-caption">{status.text_content}</p>}
    </div>
  );
}

export function StatusStories({ currentUserId, displayName, avatarUrl = "" }: StatusStoriesProps) {
  const { statuses, loading, error, refresh, publish, remove, markViewed } = useMtuStatuses(currentUserId);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [viewerItems, setViewerItems] = React.useState<MtuStatus[]>([]);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewersOpen, setViewersOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState("");
  const [deletingStatus, setDeletingStatus] = React.useState(false);
  const [editor, setEditor] = React.useState<EditorState>(emptyEditor);
  const [editorBusy, setEditorBusy] = React.useState(false);
  const [mediaUrl, setMediaUrl] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [selectedLayer, setSelectedLayer] = React.useState("");
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [clipStart, setClipStart] = React.useState(0);
  const [clipEnd, setClipEnd] = React.useState(0);
  const [videoPlaying, setVideoPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(true);
  const [volume, setVolume] = React.useState(0.8);
  const [showPreview, setShowPreview] = React.useState(false);
  const [exportedMedia, setExportedMedia] = React.useState<File | null>(null);
  const [processingLabel, setProcessingLabel] = React.useState("");
  const [undoStack, setUndoStack] = React.useState<EditorState[]>([]);
  const [redoStack, setRedoStack] = React.useState<EditorState[]>([]);
  const [drawing, setDrawing] = React.useState<Stroke | null>(null);
  const [showEmojiTools, setShowEmojiTools] = React.useState(false);
  const mediaInput = React.useRef<HTMLInputElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const dragStart = React.useRef<{ state: EditorState; x: number; y: number } | null>(null);
  const mediaDragStart = React.useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const objectUrlRef = React.useRef("");
  const previewUrlRef = React.useRef("");
  const pointerDownRef = React.useRef(false);

  React.useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);
  React.useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = volume;
    videoRef.current.muted = muted;
  }, [volume, muted, mediaUrl]);

  const resetEditor = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    objectUrlRef.current = "";
    previewUrlRef.current = "";
    setMediaUrl("");
    setPreviewUrl("");
    setEditor(emptyEditor());
    setUndoStack([]);
    setRedoStack([]);
    setSelectedLayer("");
    setShowPreview(false);
    setExportedMedia(null);
    setProcessingLabel("");
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
    setEditorOpen(false);
  };

  const updateEditor = (patch: Partial<EditorState>, track = true) => {
    setEditor((current) => {
      if (track) {
        setUndoStack((stack) => [...stack.slice(-39), current]);
        setRedoStack([]);
      }
      return { ...current, ...patch };
    });
    setExportedMedia(null);
    setShowPreview(false);
  };

  const undo = () => {
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setRedoStack((redo) => [...redo, editor]);
      setEditor(previous);
      setExportedMedia(null);
      return stack.slice(0, -1);
    });
  };
  const redo = () => {
    setRedoStack((stack) => {
      const next = stack.at(-1);
      if (!next) return stack;
      setUndoStack((undoItems) => [...undoItems, editor]);
      setEditor(next);
      setExportedMedia(null);
      return stack.slice(0, -1);
    });
  };

  const openEditor = () => {
    setEditor(emptyEditor());
    setUndoStack([]);
    setRedoStack([]);
    setShowEmojiTools(false);
    setEditorOpen(true);
  };

  const selectMedia = (file?: File) => {
    if (!file) return;
    const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
    if (!kind) { toast.error("Choose a JPG, PNG, WebP, MP4, WebM, or QuickTime file."); return; }
    if (file.size > STATUS_MEDIA_MAX_BYTES) { toast.error("Choose an image or video smaller than 25 MB."); return; }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setMediaUrl(url);
    setEditor((current) => ({ ...current, media: file, kind, layers: current.layers }));
    setShowPreview(false);
    setExportedMedia(null);
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
  };

  const addLayer = (text = "Your words") => {
    const layer = makeTextLayer(text);
    updateEditor({ layers: [...editor.layers, layer] });
    setSelectedLayer(layer.id);
  };
  const patchLayer = (id: string, patch: Partial<TextLayer>, track = true) => {
    updateEditor({ layers: editor.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer) }, track);
  };
  const selectedTextLayer = editor.layers.find((layer) => layer.id === selectedLayer);
  const deleteSelectedLayer = () => {
    if (!selectedTextLayer) return;
    updateEditor({ layers: editor.layers.filter((layer) => layer.id !== selectedLayer) });
    setSelectedLayer("");
  };

  const undoStroke = () => updateEditor({ strokes: editor.strokes.slice(0, -1), activeTool: "select" });
  const clearDrawing = () => updateEditor({ strokes: [], activeTool: "select" });
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editor.activeTool === "select") {
      if (!editor.media || (event.target instanceof HTMLVideoElement)) return;
      mediaDragStart.current = { x: event.clientX, y: event.clientY, panX: editor.panX, panY: editor.panY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
    if (editor.activeTool === "erase") {
      updateEditor({ strokes: editor.strokes.filter((stroke) => !stroke.points.some((strokePoint) => Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) < 5)) });
      return;
    }
    pointerDownRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing({ points: [point], color: editor.brushColor, width: editor.brushSize });
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mediaDragStart.current && stageRef.current) {
      const bounds = stageRef.current.getBoundingClientRect();
      const panX = Math.max(-50, Math.min(50, mediaDragStart.current.panX + (event.clientX - mediaDragStart.current.x) / bounds.width * 100));
      const panY = Math.max(-50, Math.min(50, mediaDragStart.current.panY + (event.clientY - mediaDragStart.current.y) / bounds.height * 100));
      setEditor((current) => ({ ...current, panX, panY }));
      return;
    }
    if (editor.activeTool === "erase") {
      const rect = event.currentTarget.getBoundingClientRect();
      const point = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
      updateEditor({ strokes: editor.strokes.filter((stroke) => !stroke.points.some((strokePoint) => Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) < 5)) }, false);
      return;
    }
    if (!pointerDownRef.current || !drawing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
    setDrawing((stroke) => stroke ? { ...stroke, points: [...stroke.points, point] } : null);
  };
  const finishDrawing = () => {
    mediaDragStart.current = null;
    if (!drawing) return;
    pointerDownRef.current = false;
    updateEditor({ strokes: [...editor.strokes, drawing], activeTool: "select" });
    setDrawing(null);
  };

  const handleTextPointerDown = (event: React.PointerEvent<HTMLButtonElement>, layer: TextLayer) => {
    event.stopPropagation();
    if (editor.activeTool !== "select") return;
    setSelectedLayer(layer.id);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStart.current = { state: editor, x: layer.x, y: layer.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!dragStart.current || !stageRef.current) return;
      const bounds = stageRef.current.getBoundingClientRect();
      const x = Math.max(7, Math.min(93, (moveEvent.clientX - bounds.left) / bounds.width * 100));
      const y = Math.max(5, Math.min(95, (moveEvent.clientY - bounds.top) / bounds.height * 100));
      setEditor((current) => ({ ...current, layers: current.layers.map((item) => item.id === layer.id ? { ...item, x, y } : item) }));
    };
    const up = () => {
      if (dragStart.current) {
        setUndoStack((stack) => [...stack.slice(-39), dragStart.current!.state]);
        setRedoStack([]);
      }
      dragStart.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const currentMediaStyle = { filter: editor.filter, transform: `rotate(${editor.rotation}deg) scale(${editor.zoom})`, objectPosition: `${50 + editor.panX}% ${50 + editor.panY}%`, objectFit: editor.fit as React.CSSProperties["objectFit"] };

  const drawOverlays = (context: CanvasRenderingContext2D, width: number, height: number, videoMode = false) => {
    editor.strokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      context.beginPath();
      context.moveTo(stroke.points[0].x / 100 * width, stroke.points[0].y / 100 * height);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x / 100 * width, point.y / 100 * height));
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width * width / 360;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    });
    editor.layers.forEach((layer) => {
      const x = layer.x / 100 * width;
      const y = layer.y / 100 * height;
      const fontSize = layer.size * width / 360;
      context.save();
      context.globalAlpha = layer.opacity;
      context.translate(x, y);
      context.rotate(layer.rotation * Math.PI / 180);
      context.font = `${layer.italic ? "italic " : ""}${layer.bold ? "bold " : ""}${fontSize}px ${layer.font}`;
      context.textAlign = layer.align;
      context.textBaseline = "middle";
      const lines = layer.text.split("\n");
      const lineHeight = fontSize * 1.2;
      const widest = Math.max(...lines.map((line) => context.measureText(line).width), 0);
      if (layer.background !== "transparent") {
        context.fillStyle = layer.background;
        const highlightX = layer.align === "left" ? -12 : layer.align === "right" ? -widest - 12 : -widest / 2 - 12;
        context.fillRect(highlightX, -lineHeight * lines.length / 2 - 6, widest + 24, lineHeight * lines.length + 12);
      }
      context.fillStyle = layer.color;
      lines.forEach((line, index) => context.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight, width * 0.88));
      context.restore();
    });
    if (!videoMode && editor.kind === "text" && editor.text) {
      context.fillStyle = editor.brushColor;
      context.font = `${editor.textItalic ? "italic " : ""}${editor.textBold ? "bold " : ""}${editor.textSize * width / 360}px ${editor.textFont}`;
      context.textAlign = editor.textAlignment;
      context.textBaseline = "middle";
      const textX = editor.textAlignment === "left" ? width * 0.1 : editor.textAlignment === "right" ? width * 0.9 : width / 2;
      editor.text.split("\n").forEach((line, index, lines) => context.fillText(line, textX, height / 2 + (index - (lines.length - 1) / 2) * editor.textSize * width / 360 * 1.2, width * 0.84));
    }
  };

  const exportImage = async () => {
    if (!editor.media || !mediaUrl) throw new Error("Choose an image before previewing.");
    const image = new Image();
    image.src = mediaUrl;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The selected image could not be opened.")); });
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process images.");
    context.fillStyle = editor.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = editor.filter;
    const rotated = editor.rotation % 180 !== 0;
    const fitWidth = rotated ? image.height : image.width;
    const fitHeight = rotated ? image.width : image.height;
    const fitScale = editor.fit === "cover" ? Math.max(canvas.width / fitWidth, canvas.height / fitHeight) : Math.min(canvas.width / fitWidth, canvas.height / fitHeight);
    const scale = fitScale * editor.zoom;
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(editor.rotation * Math.PI / 180);
    context.drawImage(image, -drawWidth / 2 + editor.panX / 100 * canvas.width, -drawHeight / 2 + editor.panY / 100 * canvas.height, drawWidth, drawHeight);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.filter = "none";
    drawOverlays(context, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The edited image could not be exported.")), "image/webp", 0.9));
    if (blob.size > 25 * 1024 * 1024) throw new Error("The edited image is too large to post.");
    return new File([blob], "convo-status.webp", { type: "image/webp" });
  };

  const exportVideo = async () => {
    const original = editor.media;
    if (!original || !mediaUrl || !videoRef.current) throw new Error("Choose a video before previewing.");
    const video = videoRef.current;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) throw new Error("Wait for the video to finish loading, then try again.");
    if (duration > 60) throw new Error("Status videos must be 60 seconds or shorter.");
    const startAt = Math.max(0, Math.min(clipStart, Math.max(0, duration - 0.25)));
    const endAt = Math.min(duration, Math.max(startAt + 0.25, Math.min(clipEnd || Math.min(duration, 30), duration)));
    if (endAt - startAt > 60) throw new Error("Trim the video to 60 seconds or less.");
    setClipStart(startAt);
    setClipEnd(endAt);
    return original;
  };

  const createPreview = async () => {
    setEditorBusy(true);
    setProcessingLabel(editor.kind === "video" ? "Preparing video preview…" : editor.kind === "image" ? "Rendering image edits…" : "");
    try {
      if (editor.kind === "video") {
        const file = await exportVideo();
        setExportedMedia(file);
        setPreviewUrl(mediaUrl);
      } else if (editor.kind === "image") {
        const file = await exportImage();
        setExportedMedia(file);
        const url = URL.createObjectURL(file);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      } else if (!editor.text.trim()) {
        throw new Error("Add a little text before previewing.");
      }
      setShowPreview(true);
    } catch (caught) {
      toast.error("Couldn’t prepare your preview", { description: asErrorMessage(caught) });
    } finally {
      setEditorBusy(false);
      setProcessingLabel("");
    }
  };

  const postStatus = async () => {
    setEditorBusy(true);
    setProcessingLabel("Uploading your edited Status…");
    try {
      let draft: MtuStatusDraft;
      if (editor.kind === "image") {
        const media = exportedMedia || await exportImage();
        draft = { status_type: "image", text_content: editor.text.trim(), media, metadata: { filter: editor.filter, fit: editor.fit, zoom: editor.zoom, rotation: editor.rotation, pan_x: editor.panX, pan_y: editor.panY, layers: editor.layers, strokes: editor.strokes } };
      } else if (editor.kind === "video") {
        const media = exportedMedia || await exportVideo();
        draft = { status_type: "video", text_content: editor.text.trim(), media, metadata: { filter: editor.filter, fit: editor.fit, zoom: editor.zoom, rotation: editor.rotation, pan_x: editor.panX, pan_y: editor.panY, clip_start: clipStart, clip_end: clipEnd, layers: editor.layers, strokes: editor.strokes } };
      } else {
        draft = { status_type: "text", text_content: editor.text.trim(), metadata: { background: editor.background, text_style: { font: editor.textFont, size: editor.textSize, color: editor.brushColor, bold: editor.textBold, italic: editor.textItalic, align: editor.textAlignment } } };
      }
      const result = await publish(draft);
      if (result.error) throw new Error(result.error);
      toast.success("Status posted", { description: "It will be available for 24 hours." });
      resetEditor();
    } catch (caught) {
      toast.error("Couldn’t post your Status", { description: asErrorMessage(caught) });
    } finally {
      setEditorBusy(false);
      setProcessingLabel("");
    }
  };

  const groupStatuses = React.useMemo(() => {
    const active = statuses.filter((status) => Date.parse(status.expires_at) > Date.now());
    const grouped = new Map<string, MtuStatus[]>();
    active.forEach((status) => grouped.set(status.user_id, [...(grouped.get(status.user_id) || []), status]));
    return Array.from(grouped.entries()).map(([userId, items]) => ({ userId, items, latest: items.at(-1)! }));
  }, [statuses]);

  const openViewer = (items: MtuStatus[], startIndex = 0) => {
    setViewerItems(items);
    setViewerIndex(startIndex);
    setViewersOpen(false);
    setDeleteTarget("");
  };
  const currentStatus = viewerItems[viewerIndex];
  React.useEffect(() => {
    if (!currentStatus || currentStatus.user_id === currentUserId) return;
    void markViewed(currentStatus.status_id).then((result) => {
      if (!result.ok) toast.error("Couldn’t record this Status view", { description: result.error });
    });
  }, [currentStatus?.status_id, currentStatus?.user_id, currentUserId, markViewed]);

  React.useEffect(() => {
    if (!currentStatus || currentStatus.status_type === "video") return;
    const timer = window.setTimeout(() => setViewerIndex((index) => Math.min(index + 1, viewerItems.length - 1)), 5500);
    return () => window.clearTimeout(timer);
  }, [currentStatus?.status_id, currentStatus?.status_type, viewerItems.length]);

  const navigateViewer = (direction: -1 | 1) => {
    setViewersOpen(false);
    setViewerIndex((index) => Math.max(0, Math.min(index + direction, viewerItems.length - 1)));
  };
  const deleteStatus = async () => {
    if (!currentStatus || currentStatus.user_id !== currentUserId) return;
    setDeletingStatus(true);
    try {
      const result = await remove(currentStatus.status_id);
      if (!result.ok) {
        toast.error("Couldn’t delete Status", { description: result.error || "Please try again." });
        return;
      }
      const remaining = viewerItems.filter((item) => item.status_id !== currentStatus.status_id);
      setDeleteTarget("");
      setViewersOpen(false);
      if (!remaining.length) {
        setViewerItems([]);
      } else {
        setViewerItems(remaining);
        setViewerIndex((index) => Math.min(index, remaining.length - 1));
      }
      toast.success("Status deleted");
      if (result.error) toast.error("Status deleted, but media cleanup failed", { description: result.error });
    } catch (caught) {
      toast.error("Couldn’t delete Status", { description: asErrorMessage(caught) });
    } finally {
      setDeletingStatus(false);
    }
  };
  const ownStatuses = groupStatuses.find((group) => group.userId === currentUserId)?.items || [];
  const otherGroups = groupStatuses.filter((group) => group.userId !== currentUserId);

  const addSticker = (emoji: string) => addLayer(emoji);
  const copySelectedText = async () => {
    if (!selectedTextLayer) return;
    try {
      await navigator.clipboard.writeText(selectedTextLayer.text);
      toast.success("Text copied");
    } catch {
      toast.error("Couldn’t copy text", { description: "Select and copy the text manually." });
    }
  };
  const pasteText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) addLayer(text.slice(0, 180));
    } catch {
      toast.error("Clipboard access is unavailable. Add a text layer and paste into its text field.");
    }
  };
  const mediaPosition = (value: number) => `${duration ? value / duration * 100 : 0}%`;

  return (
    <>
      <section className="status-stories" aria-label="Status updates">
        <div className="status-stories-rail">
          <button type="button" className="status-story status-story-mine" aria-label={ownStatuses.length ? `Open your Status, ${ownStatuses.length} updates` : "Add your Status"} title={ownStatuses.length ? "Open your Status" : "Add your Status"} onClick={() => ownStatuses.length ? openViewer(ownStatuses, ownStatuses.length - 1) : openEditor()}>
            <span className={`status-avatar-wrap ${ownStatuses.length ? "has-status" : ""}`}>
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="status-avatar-fallback">{displayName.slice(0, 2).toUpperCase()}</span>}
              {!ownStatuses.length && <span className="status-add-mark"><Plus size={12} /></span>}
            </span>
            <span className="status-story-name">{displayName || "Your status"}</span>
          </button>
          {ownStatuses.length > 0 && <button type="button" className="status-story status-story-create" aria-label="Create Status" title="Create Status" onClick={openEditor}><span className="status-avatar-wrap status-create-avatar"><Plus size={17} /></span><span className="status-story-name">Add</span></button>}
          {otherGroups.map(({ userId, items, latest }) => (
            <button type="button" className={`status-story ${items.some((item) => !item.viewed_by_me) ? "is-unseen" : "is-seen"}`} key={userId} aria-label={`View ${latest.display_name} Status`} title={`View ${latest.display_name} Status`} onClick={() => { const firstUnseen = items.findIndex((item) => !item.viewed_by_me); openViewer(items, firstUnseen < 0 ? items.length - 1 : firstUnseen); }}>
              <span className="status-avatar-wrap">{latest.avatar_url ? <img src={latest.avatar_url} alt="" /> : <span className="status-avatar-fallback">{latest.display_name.slice(0, 2).toUpperCase()}</span>}</span>
              <span className="status-story-name">{latest.display_name}</span>
            </button>
          ))}
        </div>
        {error && <div className="status-load-error" role="status"><span>{error}</span><button type="button" onClick={() => void refresh()}>Try again</button></div>}
      </section>

      {editorOpen && createPortal(
        <div className="status-editor-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !editorBusy) resetEditor(); }}>
          <section className="status-editor" role="dialog" aria-modal="true" aria-label={showPreview ? "Preview Status" : "Create Status"}>
            <header className="status-editor-header">
              <button type="button" className="status-icon-button" aria-label="Back to messages" onClick={resetEditor}><ArrowLeft size={17} /></button>
              <div><span className="eyebrow dark">Your moment</span><h2>{showPreview ? "Preview Status" : "Create Status"}</h2></div>
              {showPreview
                ? <button type="button" className="status-action-button" onClick={postStatus} disabled={editorBusy}>{editorBusy ? "Posting…" : "Post"} <Check size={14} /></button>
                : <button type="button" className="status-action-button" onClick={() => void createPreview()} disabled={editorBusy}>{editorBusy ? "Preparing…" : "Preview"} <Eye size={14} /></button>}
            </header>
            {editorBusy && <div className="status-processing" role="status"><span>{processingLabel || "Working…"}</span></div>}

            {showPreview ? (
              <div className="status-preview-layout">
                <div className="status-preview-canvas" style={{ background: editor.background }}>
                  {editor.kind === "image" && previewUrl && <img src={previewUrl} alt="Edited Status preview" />}
                  {editor.kind === "video" && previewUrl && <video src={previewUrl} controls playsInline preload="metadata" style={currentMediaStyle} onLoadedMetadata={(event) => { if (clipStart > 0) event.currentTarget.currentTime = clipStart; }} onTimeUpdate={(event) => { if (clipEnd && event.currentTarget.currentTime >= clipEnd) event.currentTarget.pause(); }} />}
                  {editor.kind === "video" && <StatusMediaOverlays layers={editor.layers} strokes={editor.strokes} />}
                  {editor.kind === "text" && <p>{editor.text}</p>}
                </div>
                {editor.text.trim() && editor.kind !== "text" && <p className="status-preview-caption">{editor.text}</p>}
                <div className="status-editor-footer"><button type="button" className="status-secondary-button" onClick={() => setShowPreview(false)} disabled={editorBusy}><ArrowLeft size={14} /> Back to edit</button><button type="button" className="status-action-button" onClick={postStatus} disabled={editorBusy}>{editorBusy ? "Posting…" : "Post status"} <Check size={14} /></button></div>
              </div>
            ) : (
              <div className="status-editor-body">
                <div className="status-stage-column">
                  <div className={`status-editor-stage ${editor.kind === "text" ? "is-text-only" : ""}`} ref={stageRef} style={{ background: editor.background }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishDrawing} onPointerCancel={finishDrawing}>
                    {editor.kind === "image" && mediaUrl && <img className="status-stage-media" src={mediaUrl} alt="Status canvas" style={currentMediaStyle} />}
                    {editor.kind === "video" && mediaUrl && <video ref={videoRef} className="status-stage-media" src={mediaUrl} playsInline muted={muted} controls preload="metadata" style={currentMediaStyle} onLoadedMetadata={(event) => { const length = event.currentTarget.duration; setDuration(length); setClipEnd(Math.min(length, 30)); }} onTimeUpdate={(event) => { setCurrentTime(event.currentTarget.currentTime); if (clipEnd && event.currentTarget.currentTime >= clipEnd) { event.currentTarget.pause(); setVideoPlaying(false); } }} onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} />}
                    {editor.kind === "text" && <textarea className="status-text-canvas-input" value={editor.text} maxLength={700} style={{ color: editor.brushColor, fontFamily: editor.textFont, fontSize: `clamp(18px, ${editor.textSize / 3.6}vw, ${editor.textSize}px)`, fontWeight: editor.textBold ? 700 : 400, fontStyle: editor.textItalic ? "italic" : "normal", textAlign: editor.textAlignment }} onChange={(event) => updateEditor({ text: event.target.value }, false)} placeholder="Share a thought…" aria-label="Status text" />}
                    {editor.kind !== "text" && editor.layers.map((layer) => (
                      <button type="button" className={`status-text-layer ${selectedLayer === layer.id ? "is-selected" : ""}`} key={layer.id} onPointerDown={(event) => handleTextPointerDown(event, layer)} onDoubleClick={() => setSelectedLayer(layer.id)} style={{ left: `${layer.x}%`, top: `${layer.y}%`, color: layer.color, background: layer.background, fontFamily: layer.font, fontSize: `clamp(15px, ${layer.size / 3.6}vw, ${layer.size}px)`, fontWeight: layer.bold ? 700 : 400, fontStyle: layer.italic ? "italic" : "normal", opacity: layer.opacity, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }} aria-label={`Text layer: ${layer.text}`}>{layer.text}</button>
                    ))}
                    {editor.kind !== "text" && <svg className="status-drawing-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Drawing layer">{[...editor.strokes, ...(drawing ? [drawing] : [])].map((stroke, index) => <polyline key={index} points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.width / 3} strokeLinecap="round" strokeLinejoin="round" />)}</svg>}
                    {!editor.media && editor.kind !== "text" && <button type="button" className="status-select-media" onClick={() => mediaInput.current?.click()}><Plus size={18} /> Choose {editor.kind}</button>}
                    {editor.kind === "image" && !showPreview && <span className="status-canvas-hint">9:16 story canvas · {editor.fit === "cover" ? "Fill" : "Fit"}</span>}
                  </div>
                  {editor.kind === "video" && <div className="status-video-controls">
                    <div className="status-timeline-head"><span><Scissors size={13} /> Trim clip</span><small>{currentTime.toFixed(1)}s / {duration.toFixed(1)}s · {Math.max(0, clipEnd - clipStart).toFixed(1)}s selected</small></div>
                    <div className="status-range-wrap" style={{ "--clip-start": mediaPosition(clipStart), "--clip-end": mediaPosition(clipEnd) } as React.CSSProperties}>
                      <span className="status-range-track" />
                      <input type="range" min="0" max={duration || 1} step="0.1" value={clipStart} aria-label="Trim start time" onChange={(event) => { const next = Number(event.target.value); setClipStart(Math.min(next, clipEnd - 0.25)); }} />
                      <input type="range" min="0" max={duration || 1} step="0.1" value={clipEnd} aria-label="Trim end time" onChange={(event) => { const next = Number(event.target.value); setClipEnd(Math.max(next, clipStart + 0.25)); }} />
                    </div>
                    <div className="status-video-control-row"><button type="button" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) { video.currentTime = clipStart; void video.play(); } else video.pause(); }} aria-label={videoPlaying ? "Pause video" : "Play video"}>{videoPlaying ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute video" : "Mute video"}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button><input type="range" min="0" max="1" step="0.05" value={volume} aria-label="Video volume" onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (videoRef.current) videoRef.current.volume = next; }} /><button type="button" className="status-secondary-button status-small-button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = clipStart; }}>Start</button><button type="button" className="status-secondary-button status-small-button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = clipEnd; }}>End</button></div>
                    {duration > 60 && <p className="status-inline-warning">Trim your selection to 60 seconds or less.</p>}
                  </div>}
                </div>

                <div className="status-tools">
                  <div className="status-tool-row">
                    <button type="button" className="status-secondary-button" onClick={() => mediaInput.current?.click()}><Plus size={14} /> {editor.media ? "Change media" : "Add media"}</button>
                    <input ref={mediaInput} hidden type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(event) => { selectMedia(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                    <button type="button" className="status-secondary-button" onClick={() => addLayer()} disabled={editor.kind === "text"}><span className="status-aa">Aa</span> Text</button>
                    <button type="button" className={`status-secondary-button ${showEmojiTools ? "is-active" : ""}`} onClick={() => setShowEmojiTools((value) => !value)} disabled={editor.kind === "text"}><Smile size={14} /> Emoji</button>
                    <button type="button" className={`status-secondary-button ${editor.activeTool === "draw" ? "is-active" : ""}`} onClick={() => updateEditor({ activeTool: editor.activeTool === "draw" ? "select" : "draw" })} disabled={editor.kind === "text"}><Pencil size={14} /> Draw</button>
                    <button type="button" className={`status-secondary-button ${editor.activeTool === "erase" ? "is-active" : ""}`} onClick={() => updateEditor({ activeTool: editor.activeTool === "erase" ? "select" : "erase" })} disabled={editor.kind === "text"}><Eraser size={14} /> Erase</button>
                  </div>
                  {showEmojiTools && editor.kind !== "text" && <div className="status-emoji-tools" aria-label="Choose a sticker">{emojiOptions.map((emoji) => <button type="button" key={emoji} aria-label={`Add ${emoji} sticker`} onClick={() => { addSticker(emoji); setShowEmojiTools(false); }}>{emoji}</button>)}</div>}
                  <div className="status-tool-row status-history-row">
                    <button type="button" className="status-icon-button" aria-label="Undo" onClick={undo} disabled={!undoStack.length}><Undo2 size={14} /></button>
                    <button type="button" className="status-icon-button" aria-label="Redo" onClick={redo} disabled={!redoStack.length}><Redo2 size={14} /></button>
                    {editor.kind !== "text" && <><button type="button" className="status-icon-button" aria-label="Rotate media" onClick={() => updateEditor({ rotation: (editor.rotation + 90) % 360 })}><RotateCcw size={14} /></button><button type="button" title="Crop, fit, or fill the story frame" className={`status-secondary-button ${editor.fit === "cover" ? "is-active" : ""}`} onClick={() => updateEditor({ fit: editor.fit === "cover" ? "contain" : "cover" })}><FlipHorizontal size={14} /> Crop / Fit</button></>}
                    <button type="button" className="status-icon-button" aria-label="Clear drawing" onClick={clearDrawing} disabled={!editor.strokes.length}><Eraser size={14} /></button>
                  </div>
                  {editor.kind === "text" && <div className="status-text-tools">
                    <div className="status-tool-row status-color-row"><span>Background</span>{["#594149", "#1f5a3a", "#7a5538", "#c39a5b", "#26333c"].map((color) => <button type="button" key={color} className={`status-color-swatch ${editor.background === color ? "is-selected" : ""}`} style={{ background: color }} aria-label={`Use ${color} background`} onClick={() => updateEditor({ background: color })} />)}</div>
                    <label className="status-inline-field">Text color <input type="color" aria-label="Text color" value={editor.brushColor} onChange={(event) => updateEditor({ brushColor: event.target.value }, false)} /></label>
                    <div className="status-tool-row"><select aria-label="Font" value={editor.textFont} onChange={(event) => updateEditor({ textFont: event.target.value })}>{fontChoices.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select><button type="button" className={`status-icon-button ${editor.textBold ? "is-active" : ""}`} aria-label="Bold text" onClick={() => updateEditor({ textBold: !editor.textBold })}><Bold size={14} /></button><button type="button" className={`status-icon-button ${editor.textItalic ? "is-active" : ""}`} aria-label="Italic text" onClick={() => updateEditor({ textItalic: !editor.textItalic })}><Italic size={14} /></button></div>
                    <label className="status-range-label">Size <input type="range" min="20" max="56" value={editor.textSize} aria-label="Text size" onChange={(event) => updateEditor({ textSize: Number(event.target.value) }, false)} /></label>
                    <div className="status-tool-row status-align-row">{(["left", "center", "right"] as const).map((align) => <button type="button" key={align} className={`status-secondary-button status-small-button ${editor.textAlignment === align ? "is-active" : ""}`} onClick={() => updateEditor({ textAlignment: align })}>{align}</button>)}</div>
                    <small>{editor.text.length}/700</small>
                  </div>}
                  {editor.kind !== "text" && <div className="status-image-tools">
                  <label className="status-caption-field">Caption <textarea aria-label="Status caption" value={editor.text} maxLength={700} onChange={(event) => updateEditor({ text: event.target.value }, false)} placeholder="Add a caption…" /></label>
                    <div className="status-tool-row status-filter-row" aria-label="Image filters">{filters.map((filter) => <button type="button" key={filter.value} className={editor.filter === filter.value ? "is-active" : ""} onClick={() => updateEditor({ filter: filter.value })}>{filter.label}</button>)}</div>
                    <label className="status-range-label">Zoom <input type="range" min="0.8" max="2.2" step="0.05" value={editor.zoom} onChange={(event) => updateEditor({ zoom: Number(event.target.value) }, false)} /></label>
                    <div className="status-tool-row status-draw-tools"><label>Pen <input type="color" aria-label="Pen color" value={editor.brushColor} onChange={(event) => updateEditor({ brushColor: event.target.value }, false)} /></label><label>Size <input type="range" min="1" max="18" value={editor.brushSize} aria-label="Brush size" onChange={(event) => updateEditor({ brushSize: Number(event.target.value) }, false)} /></label><button type="button" className="status-icon-button" aria-label="Undo drawing stroke" onClick={undoStroke} disabled={!editor.strokes.length}><Undo2 size={14} /></button></div>
                    {selectedTextLayer && <div className="status-layer-controls">
                      <div className="status-layer-header"><b>Text layer</b><button type="button" className="status-icon-button" aria-label="Delete selected text layer" onClick={deleteSelectedLayer}><Trash2 size={14} /></button></div>
                      <textarea aria-label="Edit text layer" value={selectedTextLayer.text} maxLength={180} onChange={(event) => patchLayer(selectedLayer, { text: event.target.value }, false)} />
                      <div className="status-tool-row"><select aria-label="Font" value={selectedTextLayer.font} onChange={(event) => patchLayer(selectedLayer, { font: event.target.value })}>{fontChoices.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select><input aria-label="Layer text color" type="color" value={selectedTextLayer.color} onChange={(event) => patchLayer(selectedLayer, { color: event.target.value })} /><button type="button" className={`status-icon-button ${selectedTextLayer.bold ? "is-active" : ""}`} aria-label="Bold text" onClick={() => patchLayer(selectedLayer, { bold: !selectedTextLayer.bold })}><Bold size={14} /></button><button type="button" className={`status-icon-button ${selectedTextLayer.italic ? "is-active" : ""}`} aria-label="Italic text" onClick={() => patchLayer(selectedLayer, { italic: !selectedTextLayer.italic })}><Italic size={14} /></button></div>
                      <div className="status-tool-row"><label>Size <input type="range" min="16" max="64" value={selectedTextLayer.size} aria-label="Text size" onChange={(event) => patchLayer(selectedLayer, { size: Number(event.target.value) }, false)} /></label><label>Opacity <input type="range" min="0.2" max="1" step="0.05" value={selectedTextLayer.opacity} aria-label="Text opacity" onChange={(event) => patchLayer(selectedLayer, { opacity: Number(event.target.value) }, false)} /></label></div>
                      <div className="status-tool-row status-align-row">{(["left", "center", "right"] as const).map((align) => <button type="button" key={align} className={`status-secondary-button status-small-button ${selectedTextLayer.align === align ? "is-active" : ""}`} onClick={() => patchLayer(selectedLayer, { align })}>{align}</button>)}</div>
                      <div className="status-tool-row"><label>Highlight <input type="color" aria-label="Text highlight color" value={selectedTextLayer.background === "transparent" ? "#594149" : selectedTextLayer.background} onChange={(event) => patchLayer(selectedLayer, { background: event.target.value })} /></label><button type="button" className="status-secondary-button status-small-button" onClick={() => patchLayer(selectedLayer, { background: selectedTextLayer.background === "transparent" ? "#594149" : "transparent" })}>{selectedTextLayer.background === "transparent" ? "Add highlight" : "Remove highlight"}</button><button type="button" className="status-icon-button" aria-label="Rotate text layer" onClick={() => patchLayer(selectedLayer, { rotation: (selectedTextLayer.rotation + 15) % 360 })}><RotateCcw size={14} /></button></div>
                      <div className="status-tool-row"><button type="button" className="status-secondary-button status-small-button" onClick={copySelectedText}><Copy size={12} /> Copy</button><button type="button" className="status-secondary-button status-small-button" onClick={pasteText}>Paste</button><button type="button" className="status-icon-button" aria-label="Make text smaller" onClick={() => patchLayer(selectedLayer, { size: Math.max(16, selectedTextLayer.size - 4) })}><Minus size={13} /></button><button type="button" className="status-icon-button" aria-label="Make text larger" onClick={() => patchLayer(selectedLayer, { size: Math.min(64, selectedTextLayer.size + 4) })}><Plus size={13} /></button></div>
                    </div>}
                    {!!editor.layers.length && <div className="status-layer-list" role="group" aria-label="Text layers">{editor.layers.map((layer, index) => <button type="button" key={layer.id} className={selectedLayer === layer.id ? "is-active" : ""} onClick={() => setSelectedLayer(layer.id)}>{index + 1}. {layer.text.slice(0, 18) || "Empty text"}</button>)}</div>}
                  </div>}
                  <p className="status-editor-note">{editor.kind === "video" ? "Video keeps its original quality. Trim, crop, filters, and text are saved with it; keep it under 25 MB." : editor.kind === "image" ? "Your edited image is processed and uploaded; the original stays on your device." : "Only active MTU students can view your Status."}</p>
                </div>
              </div>
            )}
          </section>
        </div>,
        document.body,
      )}

      {currentStatus && createPortal(
        <div className="status-viewer-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setViewerItems([]); }}>
          <section className="status-viewer" role="dialog" aria-modal="true" aria-label={`${currentStatus.display_name} Status`}>
            <div className="status-viewer-progress" aria-hidden="true">{viewerItems.map((status, index) => <span key={status.status_id} className={index <= viewerIndex ? "is-filled" : ""} />)}</div>
            <header className="status-viewer-header">
              <span className="status-viewer-person">{currentStatus.avatar_url ? <img src={currentStatus.avatar_url} alt="" /> : <span>{currentStatus.display_name.slice(0, 2).toUpperCase()}</span>}<b>{currentStatus.display_name}</b><small>{new Date(currentStatus.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></span>
              {currentStatus.user_id === currentUserId && <span className="status-owner-views"><Eye size={13} /> {currentStatus.view_count}</span>}
              {currentStatus.user_id === currentUserId && <button type="button" className="status-icon-button status-delete-button" aria-label="Delete this Status" onClick={() => setDeleteTarget(currentStatus.status_id)}><Trash2 size={15} /></button>}
              <button type="button" className="status-icon-button" aria-label="Close Status viewer" onClick={() => setViewerItems([])}><X size={17} /></button>
            </header>
            <StatusPreview status={currentStatus} onNext={() => navigateViewer(1)} />
            <button type="button" className="status-viewer-nav status-viewer-prev" aria-label="Previous Status" onClick={() => navigateViewer(-1)} disabled={viewerIndex === 0}><ChevronLeft size={24} /></button>
            <button type="button" className="status-viewer-nav status-viewer-next" aria-label="Next Status" onClick={() => navigateViewer(1)} disabled={viewerIndex === viewerItems.length - 1}><ChevronRight size={24} /></button>
            {currentStatus.user_id === currentUserId && <footer className="status-viewer-footer">
              <button type="button" className="status-view-count" aria-label={`Show ${currentStatus.view_count} Status viewers`} onClick={() => setViewersOpen(true)}><Eye size={16} /><strong>{currentStatus.view_count}</strong><span>{currentStatus.view_count === 1 ? "view" : "views"}</span></button>
            </footer>}
            {viewersOpen && currentStatus.user_id === currentUserId && <div className="status-viewers-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setViewersOpen(false); }}>
              <section className="status-viewers-panel" role="dialog" aria-modal="true" aria-label={`${currentStatus.view_count} Status viewers`}>
                <header><div><span className="eyebrow dark">Your audience</span><h3><Eye size={16} /> {currentStatus.view_count} {currentStatus.view_count === 1 ? "view" : "views"}</h3></div><button type="button" className="status-icon-button" aria-label="Close viewers" onClick={() => setViewersOpen(false)}><X size={15} /></button></header>
                {currentStatus.viewers.length ? <ul>{currentStatus.viewers.map((viewer) => <li key={viewer.user_id}>
                  {viewer.avatar_url ? <img src={viewer.avatar_url} alt="" /> : <span className="status-viewer-avatar-fallback">{viewer.display_name.slice(0, 2).toUpperCase()}</span>}
                  <strong>{viewer.display_name || "MTU student"}</strong><time>{new Date(viewer.viewed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>
                </li>)}</ul> : <p className="status-viewers-empty">No one has viewed this Status yet.</p>}
              </section>
            </div>}
            {deleteTarget === currentStatus.status_id && <div className="status-viewers-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !deletingStatus) setDeleteTarget(""); }}>
              <section className="status-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="status-delete-title" aria-describedby="status-delete-description">
                <span className="status-delete-icon"><Trash2 size={17} /></span><h3 id="status-delete-title">Delete this Status?</h3><p id="status-delete-description">This update and its viewers list will be permanently removed.</p>
                <div><button type="button" className="status-secondary-button" onClick={() => setDeleteTarget("")} disabled={deletingStatus}>Keep Status</button><button type="button" className="status-action-button status-danger-button" onClick={() => void deleteStatus()} disabled={deletingStatus}>{deletingStatus ? "Deleting…" : "Delete Status"}</button></div>
              </section>
            </div>}
            {currentStatus.status_type === "video" && <button type="button" className="status-audio-toggle" onClick={(event) => { const video = event.currentTarget.parentElement?.querySelector("video"); if (video) { video.muted = !video.muted; setMuted(video.muted); } }}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />} Sound</button>}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
