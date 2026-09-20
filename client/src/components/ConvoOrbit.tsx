import React, { useEffect, useRef } from "react";
import * as THREE from "three";

type Branch = { from: THREE.Vector3; to: THREE.Vector3 };

function buildTree() {
  const branches: Branch[] = [];
  const leaves: THREE.Vector3[] = [];
  const grow = (from: THREE.Vector3, length: number, angle: number, depth: number) => {
    const to = from.clone().add(new THREE.Vector3(Math.sin(angle) * length, Math.cos(angle) * length, depth * 0.08));
    branches.push({ from, to });
    if (depth <= 0) { leaves.push(to); return; }
    grow(to, length * 0.78, angle - 0.42, depth - 1);
    grow(to, length * 0.72, angle + 0.4, depth - 1);
    if (depth > 2) grow(to, length * 0.6, angle + (depth % 2 ? -0.05 : 0.08), depth - 2);
  };
  grow(new THREE.Vector3(-0.85, -1.55, 0), 0.72, -0.03, 6);
  return { branches, leaves };
}

export function ConvoOrbit() {
  const containerRef = useRef<HTMLDivElement>(null);
  const webglRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const webgl = webglRef.current;
    const paint = paintRef.current;
    if (!container || !webgl || !paint) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.05, 6.1);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: webgl, alpha: true, antialias: true, powerPreference: "low-power" }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene.add(new THREE.HemisphereLight(0xfff4e4, 0x4a3038, 2));
    const light = new THREE.PointLight(0xffbd96, 2.4, 8); light.position.set(1.8, 2.2, 3); scene.add(light);
    const world = new THREE.Group(); scene.add(world);
    const { branches, leaves } = buildTree();
    const branchGeometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    branches.forEach(({ from, to }) => positions.push(from.x, from.y, from.z, to.x, to.y, to.z));
    branchGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const branch = new THREE.LineSegments(branchGeometry, new THREE.LineBasicMaterial({ color: 0x8f5a55, transparent: true, opacity: 0.8 }));
    world.add(branch);
    const leafGeometry = new THREE.IcosahedronGeometry(0.095, 1);
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0xe7a47e, roughness: 0.72, transparent: true, opacity: 0.84 });
    leaves.forEach((point, index) => {
      const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
      leaf.position.copy(point); leaf.scale.set(1 + (index % 3) * 0.25, 0.75 + (index % 2) * 0.18, 0.72); leaf.rotation.z = index * 0.7; world.add(leaf);
    });
    const signalPoints = leaves.filter((_, index) => index % 5 === 0).map((point) => point.clone().add(new THREE.Vector3(0.08, 0.08, 0.22)));
    const signalGeometry = new THREE.BufferGeometry().setFromPoints(signalPoints);
    world.add(new THREE.Points(signalGeometry, new THREE.PointsMaterial({ color: 0xf9dfb4, size: 0.095, transparent: true, opacity: 0.95 })));
    const bridgeGeometry = new THREE.BufferGeometry();
    const bridgePositions: number[] = [];
    signalPoints.forEach((point, index) => { const other = signalPoints[(index + 2) % signalPoints.length]; bridgePositions.push(point.x, point.y, point.z, other.x, other.y, other.z); });
    bridgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bridgePositions, 3));
    world.add(new THREE.LineSegments(bridgeGeometry, new THREE.LineBasicMaterial({ color: 0xd8957b, transparent: true, opacity: 0.3 })));

    const ctx = paint.getContext("2d");
    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => { const rect = paint.getBoundingClientRect(); pointer.x = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5; pointer.y = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5; };
    const onPointerLeave = () => { pointer.x = 0; pointer.y = 0; };
    paint.addEventListener("pointermove", onPointerMove, { passive: true }); paint.addEventListener("pointerleave", onPointerLeave, { passive: true });
    let renderedWidth = 0;
    let renderedHeight = 0;
    const resize = () => { const width = Math.max(1, Math.round(container.clientWidth || 220)); const height = Math.max(1, Math.round(container.clientHeight || 180)); if (width === renderedWidth && height === renderedHeight) return; renderedWidth = width; renderedHeight = height; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); const scale = Math.min(window.devicePixelRatio, 2); paint.width = Math.max(1, Math.floor(width * scale)); paint.height = Math.max(1, Math.floor(height * scale)); ctx?.setTransform(scale, 0, 0, scale, 0, 0); };
    resize(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null; observer?.observe(container);
    let isVisible = true;
    const visibilityObserver = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => { isVisible = entry.isIntersecting; }, { threshold: 0.01 })
      : null;
    visibilityObserver?.observe(container);
    let frame = 0;
    const animate = (time: number) => {
      if (!isVisible) { frame = requestAnimationFrame(animate); return; }
      const t = time * 0.001;
      if (!reducedMotion) { world.rotation.y += (pointer.x * 0.1 - world.rotation.y) * 0.035; world.rotation.x += (-pointer.y * 0.07 - world.rotation.x) * 0.035; world.position.y = Math.sin(t * 0.34) * 0.035; }
      if (ctx) { const width = paint.clientWidth || 220; const height = paint.clientHeight || 180; ctx.clearRect(0, 0, width, height); const glow = ctx.createRadialGradient(width * 0.58, height * 0.46, 1, width * 0.58, height * 0.46, width * 0.56); glow.addColorStop(0, "rgba(246,185,145,.2)"); glow.addColorStop(1, "rgba(246,185,145,0)"); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = "rgba(255,238,213,.23)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(width * 0.58, height * 0.48, width * 0.42, height * 0.2, -0.16, 0, Math.PI * 2); ctx.stroke(); }
      renderer.render(scene, camera); frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); visibilityObserver?.disconnect(); paint.removeEventListener("pointermove", onPointerMove); paint.removeEventListener("pointerleave", onPointerLeave); renderer.dispose(); branchGeometry.dispose(); leafGeometry.dispose(); signalGeometry.dispose(); bridgeGeometry.dispose(); (world.children as THREE.Object3D[]).forEach((child) => { if ("material" in child && child.material instanceof THREE.Material) child.material.dispose(); }); };
  }, []);

  return <div ref={containerRef} className="convo-orbit" aria-hidden="true"><canvas ref={webglRef} /><canvas ref={paintRef} className="convo-orbit-paint" /></div>;
}
