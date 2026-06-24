// ImageCropper — a small, dependency-free pan + zoom image cropper modal.
//
// Used wherever the app accepts an image the academy wants framed nicely:
// the payment QR upload (square, PNG for crisp scanning) and the student
// photo (square, JPEG). The picked file is read to a data URL, handed in as
// `src`, and the user drags to pan and uses the slider (or wheel / pinch) to
// zoom. On confirm a freshly cropped data URL is produced via canvas at a
// bounded output size, so what gets uploaded matches the on-screen frame.
//
// Touch + mouse aware. Dark + light aware via the shared utility classes.
//
// Usage:
//   <ImageCropper
//     src={pickedDataUrl}
//     aspect={1}
//     round                       // circular preview mask (output stays square)
//     mime="image/png"            // 'image/jpeg' (default) keeps photos small
//     outputSize={640}            // longest output edge in px
//     title="Crop payment QR"
//     hint="Keep the whole QR inside the frame."
//     onCancel={() => setSrc('')}
//     onConfirm={(dataUrl) => { upload(dataUrl); setSrc(''); }}
//   />

import { useEffect, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Check, X } from 'lucide-react';

const BOX = 288;       // crop frame longest edge, px (matches w-72)
const MAX_ZOOM = 4;

export default function ImageCropper({
  src,
  aspect = 1,
  round = false,
  mime = 'image/jpeg',
  quality = 0.9,
  outputSize = 640,
  title = 'Crop image',
  hint = '',
  onCancel,
  onConfirm,
}) {
  const imgRef = useRef(null);
  const frameRef = useRef(null);
  const natural = useRef({ w: 0, h: 0 });
  const drag = useRef(null);     // { x, y, ox, oy } while dragging
  const pinch = useRef(null);    // { dist, zoom } while two-finger pinch

  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Frame dimensions. Landscape aspects keep the full width; portrait keep
  // the full height, so the frame always fits inside the BOX square.
  const frameW = aspect >= 1 ? BOX : Math.round(BOX * aspect);
  const frameH = aspect >= 1 ? Math.round(BOX / aspect) : BOX;

  // Scale that makes the image fully cover the frame at zoom = 1.
  const baseScale = () => {
    const { w, h } = natural.current;
    if (!w || !h) return 1;
    return Math.max(frameW / w, frameH / h);
  };

  // Keep the image covering the frame: clamp the pan offset to the overflow.
  const clamp = useCallback((off, z) => {
    const s = baseScale() * z;
    const maxX = Math.max(0, (natural.current.w * s - frameW) / 2);
    const maxY = Math.max(0, (natural.current.h * s - frameH) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, off.x)),
      y: Math.min(maxY, Math.max(-maxY, off.y)),
    };
  }, [frameW, frameH]);

  const onImgLoad = () => {
    const el = imgRef.current;
    natural.current = { w: el.naturalWidth, h: el.naturalHeight };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setReady(true);
  };

  const applyZoom = (next) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    setZoom(z);
    setOffset((o) => clamp(o, z));
  };

  // ---- Pointer / touch drag ----
  const pointFromEvent = (e) => {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  };

  const onDown = (e) => {
    if (e.touches && e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch.current = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
      drag.current = null;
      return;
    }
    const p = pointFromEvent(e);
    drag.current = { x: p.x, y: p.y, ox: offset.x, oy: offset.y };
  };

  const onMove = (e) => {
    if (pinch.current && e.touches && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      applyZoom(pinch.current.zoom * (dist / pinch.current.dist));
      return;
    }
    if (!drag.current) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    setOffset(clamp({ x: drag.current.ox + (p.x - drag.current.x), y: drag.current.oy + (p.y - drag.current.y) }, zoom));
  };

  const onUp = () => { drag.current = null; pinch.current = null; };

  // Desktop wheel-to-zoom.
  const onWheel = (e) => {
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.92));
  };

  // Esc closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const confirm = () => {
    const el = imgRef.current;
    if (!el || !natural.current.w) return;
    const s = baseScale() * zoom;
    const { w, h } = natural.current;
    // Source point shown at the frame centre, then the source rect the frame covers.
    const srcCx = w / 2 - offset.x / s;
    const srcCy = h / 2 - offset.y / s;
    const cropW = frameW / s;
    const cropH = frameH / s;
    const sx = Math.max(0, srcCx - cropW / 2);
    const sy = Math.max(0, srcCy - cropH / 2);

    const outW = aspect >= 1 ? outputSize : Math.round(outputSize * aspect);
    const outH = aspect >= 1 ? Math.round(outputSize / aspect) : outputSize;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    // White matte so any transparent PNG edges read cleanly once flattened.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(el, sx, sy, Math.min(cropW, w - sx), Math.min(cropH, h - sy), 0, 0, outW, outH);
    onConfirm?.(canvas.toDataURL(mime, quality));
  };

  const s = baseScale() * zoom;
  const renderedW = natural.current.w * s;
  const renderedH = natural.current.h * s;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onCancel} className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Crop frame */}
          <div className="flex justify-center">
            <div
              ref={frameRef}
              className="relative overflow-hidden bg-gray-100 dark:bg-gray-900 touch-none select-none cursor-move"
              style={{ width: frameW, height: frameH, borderRadius: round ? '9999px' : '0.75rem' }}
              onMouseDown={onDown}
              onMouseMove={(e) => drag.current && onMove(e)}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={onDown}
              onTouchMove={onMove}
              onTouchEnd={onUp}
              onWheel={onWheel}
            >
              {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
              <img
                ref={imgRef}
                src={src}
                alt="To crop"
                onLoad={onImgLoad}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: frameW / 2 - renderedW / 2 + offset.x,
                  top: frameH / 2 - renderedH / 2 + offset.y,
                  width: renderedW || 'auto',
                  height: renderedH || 'auto',
                  maxWidth: 'none',
                  visibility: ready ? 'visible' : 'hidden',
                }}
              />
              {/* Faint rule-of-thirds guide */}
              <div className="pointer-events-none absolute inset-0 ring-1 ring-white/40" style={{ borderRadius: round ? '9999px' : '0.75rem' }} />
            </div>
          </div>

          {hint && <p className="text-xs text-gray-500 dark:text-gray-400 text-center">{hint}</p>}

          {/* Zoom control */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => applyZoom(zoom - 0.2)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </button>
            <input
              type="range"
              min="1"
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              onChange={(e) => applyZoom(parseFloat(e.target.value))}
              className="flex-1 accent-indigo-600"
              aria-label="Zoom"
            />
            <button type="button" onClick={() => applyZoom(zoom + 0.2)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
          <button onClick={confirm} disabled={!ready} className="btn-primary btn-sm disabled:opacity-50">
            <Check className="w-4 h-4" /> Use photo
          </button>
        </div>
      </div>
    </div>
  );
}
