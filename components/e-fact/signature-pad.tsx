"use client";

import * as React from "react";
import { Eraser, Upload, Pen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A realistic hand-signature pad.
 *
 * The "real pen" feel comes from velocity-variable stroke width: fast moves
 * taper thin, slow moves swell — the way ink behaves under a fountain pen.
 * Strokes are rendered as densely interpolated dots (robust and smooth across
 * pointer devices) on a high-DPI canvas, and exported as a transparent PNG so
 * the signature sits directly on the document paper. The dashed baseline and
 * placeholder are pure CSS overlays, so they never leak into the export.
 */

type Pt = { x: number; y: number; t: number };

const INKS = [
  { label: "Encre noire", value: "#0f172a" },
  { label: "Encre bleue", value: "#1d4ed8" },
];

const MIN_W = 0.7;
const MAX_W = 3.3;
const VELOCITY_FACTOR = 1.7;

export function SignaturePad({
  value,
  onChange,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const drawing = React.useRef(false);
  const points = React.useRef<Pt[]>([]);
  const lastWidth = React.useRef((MIN_W + MAX_W) / 2);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [ink, setInk] = React.useState(INKS[0].value);
  const [hasInk, setHasInk] = React.useState(Boolean(value));
  const [justSaved, setJustSaved] = React.useState(false);

  const drawImageDataUrl = React.useCallback((url: string, w: number, h: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      // Fit the image within the pad, preserving aspect ratio.
      const scale = Math.min(w / img.width, h / img.height, 1);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    img.src = url;
  }, []);

  /** (Re)configure the backing store for the current size & DPI, keeping ink. */
  const setupCanvas = React.useCallback(
    (preserve: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctxRef.current = ctx;
      if (preserve) drawImageDataUrl(preserve, rect.width, rect.height);
    },
    [drawImageDataUrl],
  );

  // Initial setup + keep crisp on resize (restoring the current drawing).
  React.useEffect(() => {
    setupCanvas(value);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const url = hasInk ? canvas.toDataURL("image/png") : "";
      setupCanvas(url);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
    // Intentionally run once: subsequent value changes come from this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointFrom = (e: React.PointerEvent): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
  };

  const dot = (x: number, y: number, r: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.35, r), 0, Math.PI * 2);
    ctx.fill();
  };

  const strokeTo = (p: Pt) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.fillStyle = ink;
    const prev = points.current[points.current.length - 1];
    points.current.push(p);
    if (!prev) {
      dot(p.x, p.y, lastWidth.current / 2);
      return;
    }
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
    const dt = Math.max(1, p.t - prev.t);
    const velocity = dist / dt;
    const target = Math.max(MIN_W, MAX_W - velocity * VELOCITY_FACTOR);
    const width = lastWidth.current * 0.55 + target * 0.45;
    const steps = Math.max(1, Math.ceil(dist / 1.6));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const r = (lastWidth.current + (width - lastWidth.current) * t) / 2;
      dot(prev.x + (p.x - prev.x) * t, prev.y + (p.y - prev.y) * t, r);
    }
    lastWidth.current = width;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    points.current = [];
    lastWidth.current = (MIN_W + MAX_W) / 2;
    setHasInk(true);
    setJustSaved(false);
    strokeTo(pointFrom(e));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    // Coalesced events give buttery-smooth curves on high-refresh pointers.
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const rect = canvasRef.current!.getBoundingClientRect();
    for (const ev of evs) {
      strokeTo({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, t: ev.timeStamp });
    }
  };

  const commit = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL("image/png"));
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1400);
    }
  };

  const clear = () => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasInk(false);
    setJustSaved(false);
    onChange("");
  };

  const onImport = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      drawImageDataUrl(String(reader.result), rect.width, rect.height);
      setHasInk(true);
      // Let the image paint before exporting.
      window.setTimeout(() => onChange(canvas.toDataURL("image/png")), 80);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Pen className="size-3.5" /> Votre signature
        </span>
        <div className="flex items-center gap-1.5">
          {INKS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setInk(k.value)}
              aria-label={k.label}
              title={k.label}
              className={cn(
                "size-5 rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                ink === k.value ? "ring-foreground" : "ring-transparent",
              )}
              style={{ background: k.value }}
            />
          ))}
        </div>
      </div>

      <div className="group relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-white to-slate-50 shadow-inner dark:from-slate-100 dark:to-slate-200">
        {/* Signature baseline (CSS only — never exported) */}
        <div className="pointer-events-none absolute inset-x-6 bottom-7 border-b border-dashed border-slate-300" />
        <span className="pointer-events-none absolute bottom-4 left-6 text-[10px] font-semibold uppercase tracking-widest text-slate-300">
          ✕
        </span>

        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm italic text-slate-300">Signez ici avec la souris ou le doigt…</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="relative block h-44 w-full touch-none"
          style={{ cursor: "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commit}
          onPointerLeave={commit}
          onPointerCancel={commit}
        />

        {justSaved && (
          <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="size-3" /> Signée
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload /> Importer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={clear}
          disabled={!hasInk}
          className="text-muted-foreground"
        >
          <Eraser /> Effacer
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onImport(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
