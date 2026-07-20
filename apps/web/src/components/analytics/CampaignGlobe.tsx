'use client';

/**
 * Self-contained 3D-style campaign globe (canvas, orthographic projection — no
 * three.js/globe.gl dependency, so nothing to install and a tiny footprint).
 * Rotatable (drag) + gentle auto-rotate (disabled under prefers-reduced-motion).
 *
 * PHASE G FIX: previously this drew only an ocean gradient + graticule + dots —
 * no land geometry existed anywhere, so the sphere was a featureless blue mesh.
 * It now fills continents/countries/islands from a BUNDLED Natural Earth 50m
 * asset (/public/geo/land-50m.json, committed — zero external CDN, which is the
 * failure mode we avoid), projected through the same orthographic project() so
 * rotation/interaction and the prospect-dot overlay are untouched. Blank blue
 * is now an impossible state: while the asset loads we show a "loading
 * geography…" shimmer, and on load failure we draw a labeled procedural
 * fallback and log `[globe] GEO LOAD FAILED`.
 */
import { useEffect, useRef, useState } from 'react';

export interface GlobePoint { lat: number; lng: number; region: string; count: number; active: boolean }
export interface GlobeCampaign { id: string; name: string; color: string; points: GlobePoint[] }

// Colors align with the product's dark-surface palette (design tokens): deep
// ocean, muted land, low-contrast borders + graticule, so it reads as the
// product, not a stock NASA photo.
const C = {
  oceanInner: '#1e3a5f',
  oceanOuter: '#0b1a2e',
  land: '#2f6d55',
  landLit: '#3c8a6c',
  border: 'rgba(180,220,205,0.35)',
  graticule: 'rgba(120,160,200,0.16)',
};

type GeoStatus = 'loading' | 'ready' | 'failed';
type Ring = number[][]; // [[lng,lat], ...]

export default function CampaignGlobe({ campaigns }: { campaigns: GlobeCampaign[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rot = useRef({ lng: 0, dragging: false, lastX: 0, vel: 0.15 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('loading');
  const geoRings = useRef<Ring[] | null>(null);
  const geoStatusRef = useRef<GeoStatus>('loading');
  const geoFailReason = useRef<string>('');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Fetch the bundled land geometry ONCE. The running draw loop reads the ref,
  // so land appears as soon as this resolves without restarting the animation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/geo/land-50m.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rings?: Ring[] };
        if (!data?.rings?.length) throw new Error('empty or malformed geo asset');
        if (cancelled) return;
        geoRings.current = data.rings;
        geoStatusRef.current = 'ready';
        setGeoStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        const reason = err?.message || String(err);
        geoFailReason.current = reason;
        geoStatusRef.current = 'failed';
        setGeoStatus('failed');
        // Impossible-blank-state guard: a visible, logged failure — never silent blue.
        console.error(`[globe] GEO LOAD FAILED: ${reason}`);
      }
    })();
    return () => { cancelled = true; };
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
      grad.addColorStop(0, C.oceanInner);
      grad.addColorStop(1, C.oceanOuter);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // ── LAND (Phase G): fill continents/countries/islands from the bundled
      // Natural Earth 50m rings, projected through the SAME orthographic map.
      // Only front-facing sub-paths (z>0) are drawn; clipping to the sphere
      // keeps everything on the globe. ──────────────────────────────────────
      const rings = geoRings.current;
      if (geoStatusRef.current === 'ready' && rings) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = C.land;
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 0.6;
        for (const ring of rings) {
          // Split the ring into runs of consecutive front-facing points.
          let run: Array<[number, number]> = [];
          const flush = () => {
            if (run.length >= 3) {
              ctx.beginPath();
              ctx.moveTo(run[0][0], run[0][1]);
              for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
            run = [];
          };
          for (const [lng, lat] of ring) {
            const { sx, sy, z } = project(lat, lng);
            if (z > 0) run.push([sx, sy]);
            else flush();
          }
          flush();
        }
        // Subtle day-side lightening so the sphere reads 3D.
        const lit = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
        lit.addColorStop(0, 'rgba(255,255,255,0.10)');
        lit.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lit;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Graticule (lat/lng grid) — gives the rotating-3D read.
      ctx.strokeStyle = C.graticule;
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

      // Loading / hard-failure states — never a silent blue sphere.
      if (geoStatusRef.current !== 'ready') {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '12px system-ui, sans-serif';
        if (geoStatusRef.current === 'loading') {
          const a = 0.4 + 0.35 * Math.sin(t / 12); // shimmer
          ctx.fillStyle = `rgba(200,220,240,${a})`;
          ctx.fillText('loading geography…', cx, cy);
        } else {
          // Procedural fallback: the graticule above still drew, so it is
          // visibly a globe, plus an explicit label.
          ctx.fillStyle = 'rgba(255,190,190,0.9)';
          ctx.fillText('geo data unavailable', cx, cy - 6);
          ctx.fillStyle = 'rgba(255,190,190,0.6)';
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillText('(showing grid only)', cx, cy + 10);
        }
        ctx.restore();
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
