import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VOLUMES, arabicFlags, audioUrl, scanUrl, scanUrlHd, splitSentences, textUrl } from "./book.js";
import ScanViewer from "./ScanViewer.jsx";

const STORE_KEY = "hayatus-sahaba:last";

function readLocation() {
  const m = window.location.hash.match(/^#\/(\d)\/(\d+)/);
  if (m) return clamp(Number(m[1]), Number(m[2]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) return clamp(saved.vol, saved.page);
  } catch {}
  return { vol: 1, page: 95 };
}

function clamp(vol, page) {
  const v = VOLUMES.find((x) => x.id === vol) ?? VOLUMES[0];
  return { vol: v.id, page: Math.min(Math.max(page || 0, 0), v.pages - 1) };
}

export default function App() {
  const [loc, setLoc] = useState(readLocation);
  const [mode, setMode] = useState("text"); // 'text' | 'scan'
  const [available, setAvailable] = useState(null);
  const [paragraphs, setParagraphs] = useState(null);
  const [proofread, setProofread] = useState(true);
  const [footnotes, setFootnotes] = useState([]);
  const volume = VOLUMES.find((v) => v.id === loc.vol);

  const go = useCallback((vol, page) => setLoc(clamp(vol, page)), []);

  useEffect(() => {
    const onHash = () => setLoc(readLocation());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const hash = `#/${loc.vol}/${loc.page}`;
    if (window.location.hash !== hash)
      window.history.replaceState(null, "", hash);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(loc));
    } catch {}
  }, [loc]);

  useEffect(() => {
    fetch("/text/index.json")
      .then((r) => r.json())
      .then(setAvailable)
      .catch(() => setAvailable({}));
  }, []);

  const hasText = !!available?.[loc.vol]?.includes(loc.page);
  const textPages = available?.[loc.vol] ?? [];
  const prevText = textPages.filter((p) => p < loc.page).pop();
  const nextText = textPages.find((p) => p > loc.page);

  useEffect(() => {
    setParagraphs(null);
    if (!hasText) return;
    let cancelled = false;
    fetch(textUrl(loc.vol, loc.page))
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setParagraphs(d.paragraphs);
        setProofread(d.proofread !== false);
        setFootnotes(d.footnotes ?? []);
      })
      .catch(() => !cancelled && setParagraphs(null));
    return () => {
      cancelled = true;
    };
  }, [loc, hasText]);

  // Sentences are numbered across the whole page so the player can highlight them.
  const blocks = useMemo(() => {
    let i = 0;
    // A paragraph starting with "# " is a heading.
    return (paragraphs ?? []).map((p) => {
      const heading = p.startsWith("# ");
      const items = splitSentences(heading ? p.slice(2) : p).map((s) => ({
        s,
        i: i++,
        ayah: arabicFlags(s.split(" ")),
      }));
      return { heading, items };
    });
  }, [paragraphs]);
  const sentences = useMemo(
    () => blocks.flatMap((b) => b.items.map((x) => x.s)),
    [blocks],
  );

  const onPageEnd = useCallback(() => {
    go(loc.vol, loc.page + 1);
  }, [go, loc]);

  const player = usePlayer(loc, sentences, onPageEnd);
  const showScan = mode === "scan" || !hasText;

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Hayatus Sahaba <span>Maulana Muhammad Yusuf Kandhlawi (Rah)</span>
        </h1>
        <nav className="volumes">
          {VOLUMES.map((v) => (
            <button
              key={v.id}
              className={v.id === loc.vol ? "on" : ""}
              onClick={() => go(v.id, 0)}
            >
              {v.name}
            </button>
          ))}
        </nav>
      </header>

      <div className="toolbar">
        <div className="group">
          <button
            className={`btn ${!showScan ? "on" : ""}`}
            onClick={() => setMode("text")}
            disabled={!hasText}
          >
            📖 Read
          </button>
          <button
            className={`btn ${showScan ? "on" : ""}`}
            onClick={() => setMode("scan")}
          >
            📄 Original page
          </button>
        </div>

        <div className="group">
          {player.state === "idle" ? (
            <button
              className="btn listen"
              onClick={player.play}
              disabled={!player.canPlay}
            >
              🔊 Listen
            </button>
          ) : (
            <>
              <button className="btn listen on" onClick={player.toggle}>
                {player.state === "playing" ? "⏸ Pause" : "▶ Resume"}
              </button>
              <button className="btn" onClick={player.stop}>
                ⏹ Stop
              </button>
            </>
          )}
          <select
            value={player.rate}
            onChange={(e) => player.setRate(Number(e.target.value))}
            aria-label="Speed"
          >
            {[0.75, 0.9, 1, 1.15, 1.3].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </div>
      </div>

      {player.noAudio && hasText && (
        <p className="note">
          🔇 Listen is not available for this page. This page's audio
          recording is not ready yet.
        </p>
      )}

      <main className="page">
        <div key={`${loc.vol}-${loc.page}`} className="page-content">
        {showScan ? (
          <>
            {!hasText && available && (
              <p className="note">
                There is no typed text for this page — showing the original
                page.
              </p>
            )}
            <ScanViewer
              key={`${loc.vol}-${loc.page}`}
              src={scanUrl(loc.vol, loc.page)}
              hdSrc={scanUrlHd(loc.vol, loc.page)}
              alt={`${volume.name}, page ${loc.page}`}
            />
          </>
        ) : (
          <>
            <article className="text" lang="ur" dir="rtl">
              {blocks.map((block, b) => (
                <p key={b} className={block.heading ? "heading" : ""}>
                  {block.items.map(({ s, i, ayah }) => (
                    <span
                      key={i}
                      className={player.current === i ? "speaking" : ""}
                      onClick={() => player.playFrom(i)}
                    >
                      {s.split(" ").map((w, k) => (
                        <span
                          key={k}
                          className={[
                            ayah[k] ? "ayah" : "",
                            player.current === i && player.word === k ? "word" : "",
                          ].join(" ").trim()}
                        >
                          {w}{" "}
                        </span>
                      ))}
                    </span>
                  ))}
                </p>
              ))}
              {footnotes.length > 0 && (
                <footer className="footnotes">
                  {footnotes.map((f, k) => (
                    <p key={k}>{f}</p>
                  ))}
                </footer>
              )}
            </article>
            {!proofread && (
              <p className="note small">
                This text was transcribed from the original page and has not
                been proofread yet.
              </p>
            )}
          </>
        )}
        </div>
      </main>

      <footer className="pager">
        <button
          className="btn"
          onClick={() => go(loc.vol, loc.page - 1)}
          disabled={loc.page <= 0}
        >
          ← Previous
        </button>
        <label>
          Page
          <input
            type="number"
            min="0"
            max={volume.pages - 1}
            value={loc.page}
            onChange={(e) => go(loc.vol, Number(e.target.value))}
          />
          / {volume.pages - 1}
        </label>
        <button
          className="btn"
          onClick={() => go(loc.vol, loc.page + 1)}
          disabled={loc.page >= volume.pages - 1}
        >
          Next →
        </button>
      </footer>
    </div>
  );
}

// Plays the page's OmniVoice recording (public/audio/volN/NNNN.mp3 + NNNN.json sentence timing).
// There is no device-voice fallback: pages without a recording have no Listen.
function usePlayer(loc, sentences, onPageEnd) {
  const [state, setState] = useState("idle"); // 'idle' | 'playing' | 'paused'
  const [current, setCurrent] = useState(-1);
  const [word, setWord] = useState(-1);
  const [rate, setRate] = useState(1);
  const [hasAudio, setHasAudio] = useState(null); // null while checking
  const [timing, setTiming] = useState(null); // [{s, d}] per sentence
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
    setCurrent(-1);
    setWord(-1);
  }, []);

  // Stop on page change and look for a recording of the new page.
  useEffect(() => {
    stop();
    setHasAudio(null);
    setTiming(null);
    let cancelled = false;
    const mp3 = audioUrl(loc.vol, loc.page);
    fetch(mp3, { method: "HEAD" })
      .then((r) => {
        if (cancelled) return;
        const ok = r.ok && (r.headers.get("content-type") || "").startsWith("audio");
        setHasAudio(ok);
        if (ok) {
          // Sentence timing JSON alongside the MP3, for highlighting and tap-to-play.
          fetch(mp3.replace(/\.mp3$/, ".json"))
            .then((r2) => (r2.ok ? r2.json() : null))
            .then((t) => { if (!cancelled) setTiming(t); })
            .catch(() => {});
        }
      })
      .catch(() => { if (!cancelled) setHasAudio(false); });
    return () => {
      cancelled = true;
    };
  }, [loc, stop]);

  useEffect(() => stop, [stop]);

  // Play from sentence `start` (0 = top of the page).
  const play = useCallback((start = 0) => {
    if (!hasAudio) return;
    stop();
    const a = new Audio(audioUrl(loc.vol, loc.page));
    a.playbackRate = rate;
    if (start > 0 && timing?.[start]) a.currentTime = timing[start].s;
    a.onended = () => { stop(); onPageEnd?.(); };
    // Word-level highlighting using sentence timing JSON.
    if (timing && timing.length > 0) {
      a.ontimeupdate = () => {
        const t = a.currentTime;
        // Find the current sentence.
        let si = timing.length - 1;
        for (let i = 0; i < timing.length; i++) {
          if (t < timing[i].s + timing[i].d) { si = i; break; }
        }
        setCurrent(si);
        // Estimate word position proportionally within the sentence.
        const entry = timing[si];
        const words = sentences[si]?.split(" ").filter(Boolean) ?? [];
        if (words.length > 1 && entry.d > 0) {
          const relT = Math.max(0, t - entry.s);
          // Weight each word by its character count — longer words take more time.
          const charCounts = words.map((w) => Math.max(1, w.length));
          const total = charCounts.reduce((x, y) => x + y, 0);
          let cum = 0;
          let wi = words.length - 1;
          for (let j = 0; j < words.length; j++) {
            const wordEnd = ((cum + charCounts[j]) / total) * entry.d;
            if (relT < wordEnd) { wi = j; break; }
            cum += charCounts[j];
          }
          setWord(wi);
        } else {
          setWord(0);
        }
      };
    }
    audioRef.current = a;
    a.play()
      .then(() => setState("playing"))
      .catch(stop);
  }, [hasAudio, stop, loc, rate, timing, sentences, onPageEnd]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (state === "playing") {
      a.pause();
      setState("paused");
    } else {
      a.play();
      setState("playing");
    }
  }, [state]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  return {
    state,
    current,
    word,
    rate,
    setRate,
    canPlay: hasAudio === true,
    noAudio: hasAudio === false,
    play: () => play(0),
    playFrom: (i) => play(i),
    toggle,
    stop,
  };
}
