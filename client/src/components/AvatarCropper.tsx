import React, { useEffect, useMemo, useState } from "react";
import { Check, Move, RotateCcw, X } from "lucide-react";

type Props = { file: File; onComplete: (file: File) => void; onCancel: () => void };

export function AvatarCropper({ file, onComplete, onCancel }: Props) {
  const source = useMemo(() => typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "", [file]);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => () => { if (source && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(source); }, [source]);

  const saveCrop = () => {
    const image = new Image();
    image.onload = () => {
      const output = 640;
      const scale = Math.max(output / image.width, output / image.height) * zoom;
      const canvas = document.createElement("canvas");
      canvas.width = output;
      canvas.height = output;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#f2dfc8";
      context.fillRect(0, 0, output, output);
      context.drawImage(image, (output - image.width * scale) / 2 + offsetX * 2, (output - image.height * scale) / 2 + offsetY * 2, image.width * scale, image.height * scale);
      canvas.toBlob((blob) => { if (blob) onComplete(new File([blob], "convo-avatar.jpg", { type: "image/jpeg" })); }, "image/jpeg", .9);
    };
    image.src = source;
  };

  return <div className="cropper-shell" role="dialog" aria-label="Crop your avatar">
    <div className="cropper-heading"><span><Move size={15} /> Frame your avatar</span><button className="cropper-icon" onClick={onCancel} aria-label="Cancel crop"><X size={16} /></button></div>
    <div className="cropper-stage"><img src={source || undefined} alt="Avatar crop preview" style={{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoom})` }} /><span className="cropper-ring" /></div>
    <label className="cropper-control"><span>Zoom</span><input type="range" min="1" max="2.5" step=".05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
    <label className="cropper-control"><span>Horizontal</span><input type="range" min="-80" max="80" value={offsetX} onChange={(event) => setOffsetX(Number(event.target.value))} /></label>
    <label className="cropper-control"><span>Vertical</span><input type="range" min="-80" max="80" value={offsetY} onChange={(event) => setOffsetY(Number(event.target.value))} /></label>
    <div className="cropper-actions"><button className="switch-auth" onClick={() => { setZoom(1); setOffsetX(0); setOffsetY(0); }}><RotateCcw size={13} /> Reset</button><button className="primary-button" onClick={saveCrop}><Check size={15} /> Use this crop</button></div>
  </div>;
}
