import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN = 1;
const MAX = 5;
const STEP = 1.4;
const ASPECT = 953 / 1348;
const clampZoom = (z) => Math.min(MAX, Math.max(MIN, z));

export default function ScanViewer({ src, hdSrc, alt }) {
  const wrapRef = useRef(null);
  const viewRef = useRef(null);
  const anchor = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const drag = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [hdReady, setHdReady] = useState(false);
  const [full, setFull] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const view = viewRef.current;
    const ro = new ResizeObserver(() => setBox({ w: view.clientWidth, h: view.clientHeight }));
    ro.observe(view);
    return () => ro.disconnect();
  }, []);

  // In full screen the whole page should fit; inline it fills the column width.
  const fitWidth = full && box.h ? Math.min(box.w, box.h * ASPECT) : box.w;

  // Zoom keeping the point (cx, cy) inside the viewport fixed.
  const zoomTo = useCallback((next, cx, cy) => {
    const view = viewRef.current;
    setZoom((prev) => {
      const z = clampZoom(next);
      if (view && z !== prev) {
        const x = cx ?? view.clientWidth / 2;
        const y = cy ?? view.clientHeight / 2;
        anchor.current = { x, y, ratio: z / prev, left: view.scrollLeft, top: view.scrollTop };
      }
      return z;
    });
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const a = anchor.current;
    if (!view || !a) return;
    view.scrollLeft = (a.left + a.x) * a.ratio - a.x;
    view.scrollTop = (a.top + a.y) * a.ratio - a.y;
    anchor.current = null;
  }, [zoom]);

  // Only fetch the sharper image once the reader actually zooms in.
  useEffect(() => {
    if (hdReady || (zoom < 1.2 && !full)) return;
    const img = new Image();
    img.onload = () => setHdReady(true);
    img.src = hdSrc;
  }, [zoom, full, hdSrc, hdReady]);

  // Trackpad pinch and Ctrl/Cmd + scroll. Needs a non-passive listener to stop the page zooming.
  useEffect(() => {
    const view = viewRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      setZoom((z) => {
        const next = clampZoom(z * Math.exp(-e.deltaY * 0.01));
        if (next !== z) anchor.current = { x: e.clientX - r.left, y: e.clientY - r.top, ratio: next / z, left: view.scrollLeft, top: view.scrollTop };
        return next;
      });
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const local = (e) => {
    const r = viewRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      drag.current = null;
    } else if (e.pointerType === "mouse" && zoom > 1) {
      const view = viewRef.current;
      drag.current = { x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomTo(pinch.current.zoom * (dist / pinch.current.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (drag.current) {
      const view = viewRef.current;
      view.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
      view.scrollTop = drag.current.top - (e.clientY - drag.current.y);
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  const onDoubleClick = (e) => {
    const p = local(e);
    zoomTo(zoom > 1.05 ? 1 : 2.5, p.x, p.y);
  };

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen?.();
  };

  const zoomed = zoom > 1.001;

  return (
    <div ref={wrapRef} className={`scan-viewer${full ? " is-full" : ""}`}>
      <div className="zoom-bar">
        <button className="zbtn" onClick={() => zoomTo(zoom / STEP)} disabled={zoom <= MIN} aria-label="Zoom out">−</button>
        <button className="zpct" onClick={() => zoomTo(1)} title="Fit page">{Math.round(zoom * 100)}%</button>
        <button className="zbtn" onClick={() => zoomTo(zoom * STEP)} disabled={zoom >= MAX} aria-label="Zoom in">+</button>
        {document.fullscreenEnabled && (
          <button className="zbtn zfull" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"}>
            {full ? "✕" : "⛶"}
          </button>
        )}
        <span className="zhint">{zoomed ? "Drag to move · double-click to fit" : "Pinch, Ctrl + scroll or double-click to zoom"}</span>
      </div>
      <div
        ref={viewRef}
        className={`scan-viewport${zoomed ? " zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img
          className="scan"
          src={hdReady ? hdSrc : src}
          alt={alt}
          draggable={false}
          style={fitWidth ? { width: `${fitWidth * zoom}px` } : undefined}
        />
      </div>
    </div>
  );
}
