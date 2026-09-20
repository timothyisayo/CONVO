import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Props = {
  nickname: string;
  college: string;
  programme: string;
  level: string;
  avatarUrl?: string;
};

export function ConvoProfilePreview({ nickname, college, programme, level, avatarUrl }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = sceneRef.current;
    if (!host) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let renderer: THREE.WebGLRenderer | null = null;
    let frame = 0;
    let disposed = false;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.z = 4.8;
      const group = new THREE.Group();
      scene.add(group);
      const orbMaterial = new THREE.MeshBasicMaterial({ color: 0xe9a16e, transparent: true, opacity: 0.65 });
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 24), orbMaterial);
      orb.position.set(0.95, 0.2, -0.15);
      group.add(orb);
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xf4d9b1, transparent: true, opacity: 0.42 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.018, 8, 72), ringMaterial);
      ring.rotation.x = Math.PI / 2.6;
      ring.position.copy(orb.position);
      group.add(ring);
      const resize = () => { const rect = host.getBoundingClientRect(); renderer?.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height); camera.updateProjectionMatrix(); };
      const animate = (time: number) => { if (disposed) return; group.rotation.y = reduce ? 0 : time * 0.00022; group.rotation.x = reduce ? 0 : Math.sin(time * 0.00045) * 0.05; renderer?.render(scene, camera); frame = window.requestAnimationFrame(animate); };
      resize(); window.addEventListener("resize", resize); frame = window.requestAnimationFrame(animate);
      return () => { disposed = true; window.cancelAnimationFrame(frame); window.removeEventListener("resize", resize); renderer?.dispose(); renderer?.domElement.remove(); group.traverse((object) => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose()); else mesh.material?.dispose(); }); };
    } catch { return () => { renderer?.dispose(); renderer?.domElement.remove(); }; }
  }, []);

  const publicName = nickname.trim() || "Your nickname";
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [springing, setSpringing] = useState(false);
  const pointerStart = useRef({ x: 0, y: 0 });
  const springFrame = useRef<number | null>(null);
  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTilt({ x: ((event.clientY - rect.top) / rect.height - 0.5) * -7, y: ((event.clientX - rect.left) / rect.width - 0.5) * 7 });
    }
    if (dragging) {
      const nextX = event.clientX - pointerStart.current.x;
      const nextY = event.clientY - pointerStart.current.y;
      const limit = 112;
      setOffset({ x: Math.max(-limit, Math.min(limit, nextX)), y: Math.max(-limit, Math.min(limit, nextY)) });
    }
  };
  const springBack = () => {
    if (springFrame.current !== null) window.cancelAnimationFrame(springFrame.current);
    if (Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5) { setOffset({ x: 0, y: 0 }); setSpringing(false); return; }
    setSpringing(true);
    let position = { ...offset };
    const tick = () => {
      position = { x: position.x * 0.72, y: position.y * 0.72 };
      if (Math.abs(position.x) < 0.5 && Math.abs(position.y) < 0.5) { setOffset({ x: 0, y: 0 }); setSpringing(false); springFrame.current = null; return; }
      setOffset(position);
      springFrame.current = window.requestAnimationFrame(tick);
    };
    springFrame.current = window.requestAnimationFrame(tick);
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => { if (event.button !== 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return; if (springFrame.current !== null) window.cancelAnimationFrame(springFrame.current); setSpringing(false); pointerStart.current = { x: event.clientX - offset.x, y: event.clientY - offset.y }; event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(true); };
  const stopDragging = (event?: React.PointerEvent<HTMLElement>) => { if (event) event.currentTarget.releasePointerCapture?.(event.pointerId); setDragging(false); setTilt({ x: 0, y: 0 }); springBack(); };
  useEffect(() => () => { if (springFrame.current !== null) window.cancelAnimationFrame(springFrame.current); }, []);
  return <aside className={`public-profile-preview ${dragging ? "is-dragging" : ""} ${springing ? "is-springing" : ""}`} aria-label="Public profile preview" onPointerMove={handlePointerMove} onPointerLeave={() => { if (!dragging) setTilt({ x: 0, y: 0 }); }} onPointerDown={handlePointerDown} onPointerUp={stopDragging} onPointerCancel={stopDragging} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}><div className="public-preview-scene" ref={sceneRef} aria-hidden="true" /><div className="public-preview-content"><div className="preview-kicker"><span className="preview-live-dot" /> What other students will see</div><div className="preview-profile-row">{avatarUrl ? <img src={avatarUrl} alt="" className="preview-avatar" /> : <div className="preview-avatar preview-avatar-fallback">{publicName.charAt(0).toUpperCase()}</div>}<div><strong>{publicName}</strong><span>{level || "Level not set"}</span></div><span className="preview-status">new here</span></div><div className="preview-facts"><span>{programme || "Your programme"}</span><span>{college || "Your college"}</span></div><p className="preview-note">Your full name and bio stay private until you choose to share more.</p></div></aside>;
}
