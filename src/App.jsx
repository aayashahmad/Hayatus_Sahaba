import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VOLUMES, audioUrl, scanUrl, scanUrlHd, splitSentences, textUrl } from "./book.js";
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
          {player.voices.length > 1 && (
            <select
              value={player.voiceName}
              onChange={(e) => player.setVoiceName(e.target.value)}
              aria-label="Voice"
            >
              {player.voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {player.note && <p className="note">{player.note}</p>}
      {!player.canPlay && hasText && (
        <p className="note">
          🔇 Listen is not available for this page.{" "}
          {player.voices.length === 0
            ? "Your browser has no Urdu voice — open in Microsoft Edge or Android Chrome."
            : "This page's audio recording is not ready yet."}
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
                  {block.items.map(({ s, i }) => (
                    <span
                      key={i}
                      className={player.current === i ? "speaking" : ""}
                      onClick={() => player.playFrom(i)}
                    >
                      {s.split(" ").map((w, k) => (
                        <span
                          key={k}
                          className={
                            player.current === i && player.word === k
                              ? "word"
                              : ""
                          }
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

// Plays a recorded recitation (public/audio/volN/NNNN.mp3) when one exists,
// otherwise reads the page text with the device's Urdu voice.
function usePlayer(loc, sentences, onPageEnd) {
  const [state, setState] = useState("idle"); // 'idle' | 'playing' | 'paused'
  const [current, setCurrent] = useState(-1);
  const [word, setWord] = useState(-1);
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const [hasAudio, setHasAudio] = useState(false);
  const [timing, setTiming] = useState(null); // [{s, d}] per sentence
  const [note, setNote] = useState("");
  const audioRef = useRef(null);
  const runRef = useRef(0);
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

  useEffect(() => {
    if (!synth) return;
    const load = () => {
      const ur = synth
        .getVoices()
        .filter((v) => v.lang.toLowerCase().startsWith("ur"));
      setVoices(ur);
      setVoiceName((n) => n || ur[0]?.name || "");
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [synth]);

  const stop = useCallback(() => {
    runRef.current++;
    synth?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
    setCurrent(-1);
    setWord(-1);
    setNote("");
  }, [synth]);

  // Stop on page change and look for a recording of the new page.
  useEffect(() => {
    stop();
    setNote("");
    setHasAudio(false);
    setTiming(null);
    let cancelled = false;
    const mp3 = audioUrl(loc.vol, loc.page);
    fetch(mp3, { method: "HEAD" })
      .then((r) => {
        if (cancelled) return;
        const ok = r.ok && (r.headers.get("content-type") || "").startsWith("audio");
        setHasAudio(ok);
        if (ok) {
          // Try to load sentence-timing JSON alongside the MP3.
          const timingUrl = mp3.replace(/\.mp3$/, ".json");
          fetch(timingUrl)
            .then((r2) => r2.ok ? r2.json() : null)
            .then((t) => { if (!cancelled) setTiming(t); })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loc, stop]);

  useEffect(() => stop, [stop]);

  const speakFrom = useCallback(
    (start) => {
      if (sentences.length === 0) return;
      const voice = voices.find((v) => v.name === voiceName) ?? voices[0];
      if (!synth || !voice) {
        setNote(
          "This device has no Urdu voice. Open the app in Microsoft Edge or Android Chrome, or add a recording for this page.",
        );
        return;
      }
      stop();
      const run = runRef.current;
      setState("playing");
      // One utterance per sentence: long utterances get cut off in Chrome.
      const next = (i) => {
        if (run !== runRef.current) return;
        if (i >= sentences.length) { stop(); onPageEnd?.(); return; }
        setCurrent(i);
        setWord(-1);
        const u = new SpeechSynthesisUtterance(sentences[i]);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = rate;
        // Word boundaries arrive as character offsets into the sentence.
        u.onboundary = (e) => {
          if (run !== runRef.current || (e.name && e.name !== "word")) return;
          setWord(sentences[i].slice(0, e.charIndex).split(" ").length - 1);
        };
        u.onend = () => next(i + 1);
        u.onerror = () => run === runRef.current && stop();
        synth.speak(u);
      };
      next(start);
    },
    [synth, voices, voiceName, rate, sentences, stop, onPageEnd],
  );

  const play = useCallback(() => {
    if (!hasAudio) return speakFrom(0);
    stop();
    const a = new Audio(audioUrl(loc.vol, loc.page));
    a.playbackRate = rate;
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
          const total = charCounts.reduce((a, b) => a + b, 0);
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
  }, [hasAudio, speakFrom, stop, loc, rate, timing, sentences, onPageEnd]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (state === "playing") {
      a ? a.pause() : synth.pause();
      setState("paused");
    } else {
      a ? a.play() : synth.resume();
      setState("playing");
    }
  }, [state, synth]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  return {
    state,
    current,
    word,
    rate,
    setRate,
    voices,
    voiceName,
    setVoiceName,
    note,
    canPlay: hasAudio || (sentences.length > 0 && voices.length > 0),
    play,
    playFrom: (i) => !hasAudio && speakFrom(i),
    toggle,
    stop,
  };
}
