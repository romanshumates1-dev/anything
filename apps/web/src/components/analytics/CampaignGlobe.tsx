'use client';

/**
 * Self-contained 3D-style campaign globe (canvas, orthographic projection — no
 * three.js/globe.gl dependency, so nothing to install and a tiny footprint).
 * Rotatable (drag) + gentle auto-rotate (disabled under prefers-reduced-motion).
 * Glowing dots at APPROXIMATE prospect regions (area-code centroids), colored
 * per campaign, pulsing on recent activity. Back-facing points are hidden.
 */
import { useEffect, useRef, useState } from 'react';

export interface GlobePoint { lat: number; lng: number; region: string; count: number; active: boolean }
export interface GlobeCampaign { id: string; name: string; color: string; points: GlobePoint[] }

export default function CampaignGlobe({ campaigns }: { campaigns: GlobeCampaign[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rot = useRef({ lng: 0, dragging: false, lastX: 0, vel: 0.15 });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const size = 380;
    canvas.width = size * DPR;
    canvas.height = size * DPR;
    ctx.scale(DPR, DPR);
    const cx = size / 2, cy = size / 2, R = size / 2 - 24;

    // Flatten points once; cap for perf.
    const flat: Array<GlobePoint & { color: string }> = [];
    for (const c of campaigns) for (const p of c.points) flat.push({ ...p, color: c.color });
    const capped = flat.slice(0, 400);

    let raf = 0;
    let t = 0;

    const project = (lat: number, lng: number) => {
      const phi = (lat * Math.PI) / 180;
      const lam = ((lng + rot.current.lng) * Math.PI) / 180;
      const x = Math.cos(phi) * Math.sin(lam);
      const y = Math.sin(phi);
      const z = Math.cos(phi) * Math.cos(lam);
      return { sx: cx + x * R, sy: cy - y * R, z };
    };

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      // Ocean sphere
      const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.2, cx, cy, R);
      grad.addColorStop(0, '#1e3a5f');
      grad.addColorStop(1, '#0b1a2e');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Graticule (lat/lng grid) — gives the rotating-3D read.
      ctx.strokeStyle = 'rgba(120,160,200,0.18)';
      ctx.lineWidth = 1;
      for (let latLine = -60; latLine <= 60; latLine += 30) {
        ctx.beginPath();
        let started = false;
        for (let lng = -180; lng <= 180; lng += 6) {
          const { sx, sy, z } = project(latLine, lng);
          if (z < 0) { started = false; continue; }
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      for (let lngLine = -180; lngLine < 180; lngLine += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 6) {
          const { sx, sy, z } = project(lat, lngLine);
          if (z < 0) { started = false; continue; }
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }

      // Glowing prospect dots (front hemisphere only).
      for (const p of capped) {
        const { sx, sy, z } = project(p.lat, p.lng);
        if (z <= 0) continue;
        const pulse = p.active ? 1 + 0.4 * Math.sin(t / 18) : 1;
        const r = (3 + Math.min(4, Math.log2(p.count + 1))) * pulse * (0.5 + z / 2);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
        glow.addColorStop(0, p.color);
        glow.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(sx, sy, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.globalAlpha = p.active ? 0.55 : 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }

      if (!reducedMotion && !rot.current.dragging) rot.current.lng += rot.current.vel;
      t += 1;
      raf = requestAnimationFrame(draw);
    };
    draw();

    // Drag to rotate.
    const onDown = (e: PointerEvent) => { rot.current.dragging = true; rot.current.lastX = e.clientX; };
    const onMove = (e: PointerEvent) => {
      if (!rot.current.dragging) return;
      rot.current.lng += (e.clientX - rot.current.lastX) * 0.5;
      rot.current.lastX = e.clientX;
    };
    const onUp = () => { rot.current.dragging = false; };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [campaigns, reducedMotion]);

  const totalPoints = campaigns.reduce((n, c) => n + c.points.length, 0);

  return (
    <div className="flex flex-col md:flex-row gap-4 items-center">
      <canvas
        ref={canvasRef}
        style={{ width: 380, height: 380, cursor: 'grab', touchAction: 'none' }}
        aria-label="Rotatable globe of approximate prospect regions"
      />
      <div className="text-sm">
        <div className="font-medium text-gray-700 mb-2">Campaigns {reducedMotion && <span className="text-xs text-gray-400">(motion reduced)</span>}</div>
        {campaigns.length === 0 ? (
          <p className="text-gray-400 text-xs">No campaign activity yet — dots appear as prospects are messaged.</p>
        ) : (
          <ul className="space-y-1">
            {campaigns.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-gray-700 truncate max-w-[160px]">{c.name}</span>
                <span className="text-gray-400 text-xs shrink-0">· {c.points.length} region{c.points.length !== 1 ? 's' : ''}</span>
              </li>
            ))}
            {campaigns.length > 8 && (
              <li className="text-xs text-gray-400 pl-5">+{campaigns.length - 8} more campaign{campaigns.length - 8 !== 1 ? 's' : ''}</li>
            )}
          </ul>
        )}
        <p className="text-[11px] text-gray-400 mt-3 max-w-[220px]">
          {totalPoints} region marker{totalPoints !== 1 ? 's' : ''}. Locations are <strong>approximate</strong>
          {' '}(from phone area code, region-level) — not precise addresses. Drag to rotate.
        </p>
      </div>
    </div>
  );
}
