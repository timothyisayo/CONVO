import React, { useEffect, useRef } from "react";
import * as THREE from "three";

type Props = { nickname?: string; onDone: () => void };

export function ConvoSuccessCelebration({ nickname, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = threeRef.current;
    if (!canvas || !host) return;
    let frame = 0;
    let disposed = false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const context = canvas.getContext("2d");
    const particles = Array.from({ length: reduce ? 12 : 32 }, (_, index) => ({ angle: index * 0.72, radius: 40 + (index % 7) * 19, speed: 0.006 + (index % 4) * 0.002, size: 1.5 + (index % 3), tone: index % 2 ? "#7A5538" : "#C39A5B" }));
    const confetti = Array.from({ length: reduce ? 0 : 42 }, (_, index) => ({ x: (index * 37) % 100, y: -10 - (index % 8) * 9, velocity: 0.22 + (index % 5) * 0.045, drift: Math.sin(index * 1.7) * 0.18, width: 3 + (index % 3), height: 7 + (index % 4) * 2, rotation: index * 0.6, spin: 0.025 + (index % 4) * 0.012, tone: ["#7A5538", "#C39A5B", "#1F5A3A", "#B98B72"][index % 4] }));
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let group: THREE.Group | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      host.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
      camera.position.z = 5.8;
      group = new THREE.Group();
      scene.add(group);
      const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0x7a5538, transparent: true, opacity: 0.9 });
      const nodeGeometry = new THREE.SphereGeometry(0.075, 12, 12);
      const nodes: THREE.Vector3[] = [];
      for (let index = 0; index < 9; index += 1) {
        const point = new THREE.Vector3(Math.cos(index * 0.75) * (1.3 + (index % 3) * 0.18), Math.sin(index * 0.75) * (0.85 + (index % 2) * 0.2), (index % 3 - 1) * 0.25);
        nodes.push(point);
        const mesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        mesh.position.copy(point);
        group.add(mesh);
      }
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0xefe6d2, transparent: true, opacity: 0.28 });
      for (let index = 0; index < nodes.length; index += 1) {
        const next = nodes[(index + 1) % nodes.length];
        const geometry = new THREE.BufferGeometry().setFromPoints([nodes[index], next]);
        group.add(new THREE.Line(geometry, lineMaterial));
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: 0x7a5538, transparent: true, opacity: 0.5 }));
      ring.rotation.x = Math.PI / 2.8;
      group.add(ring);
    } catch {
      renderer = null;
    }

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * Math.min(window.devicePixelRatio || 1, 2));
      canvas.height = Math.floor(height * Math.min(window.devicePixelRatio || 1, 2));
      if (context) context.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0, Math.min(window.devicePixelRatio || 1, 2), 0, 0);
      if (renderer && camera) { renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
    };
    const animate = (time: number) => {
      if (disposed) return;
      const rect = host.getBoundingClientRect();
      if (context) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = rect.width;
        const height = rect.height;
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = "lighter";
        particles.forEach((particle) => {
          const angle = particle.angle + time * particle.speed;
          const x = width / 2 + Math.cos(angle) * particle.radius;
          const y = height / 2 + Math.sin(angle * 1.2) * particle.radius * 0.64;
          context.beginPath(); context.fillStyle = particle.tone; context.globalAlpha = 0.35; context.arc(x, y, particle.size, 0, Math.PI * 2); context.fill();
        });
        confetti.forEach((piece) => {
          piece.y += piece.velocity;
          piece.x += piece.drift;
          piece.rotation += piece.spin;
          if (piece.y > 112) { piece.y = -8; piece.x = (piece.x + 31) % 100; }
          context.save();
          context.translate((piece.x / 100) * width, (piece.y / 100) * height);
          context.rotate(piece.rotation);
          context.fillStyle = piece.tone;
          context.globalAlpha = Math.max(0, Math.min(0.9, 1 - piece.y / 125));
          context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
          context.restore();
        });
        context.globalAlpha = 1; context.globalCompositeOperation = "source-over";
        void dpr;
      }
      if (renderer && scene && camera && group) { group.rotation.y = reduce ? 0 : time * 0.00018; group.rotation.x = reduce ? 0 : Math.sin(time * 0.0003) * 0.08; renderer.render(scene, camera); }
      frame = window.requestAnimationFrame(animate);
    };
    resize();
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(animate);
    const doneTimer = window.setTimeout(() => doneRef.current(), reduce ? 900 : 1900);
    return () => { disposed = true; window.cancelAnimationFrame(frame); window.clearTimeout(doneTimer); window.removeEventListener("resize", resize); renderer?.dispose(); renderer?.domElement.remove(); group?.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose()); else if (mesh.material) mesh.material.dispose(); }); };
  }, []);

  return <div className="convo-success-celebration" role="status" aria-live="polite"><div ref={threeRef} className="celebration-three" /><canvas ref={canvasRef} className="celebration-canvas" aria-hidden="true" /><div className="celebration-copy"><span className="celebration-mark">✦</span><small>CONVO · MTU COMMUNITY</small><strong>{nickname ? `Welcome, ${nickname}.` : "Your space is ready."}</strong><span>Profile complete. Let the conversations begin.</span></div></div>;
}
