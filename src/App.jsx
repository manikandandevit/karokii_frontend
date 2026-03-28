import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/api";

const STEM_OPTIONS = [
  { key: "vocals", label: "Vocals" },
  { key: "drums", label: "Drums" },
  { key: "bass", label: "Bass" },
  { key: "other", label: "Other" },
  { key: "instrumental", label: "Instrumental (No Vocals)" },
  { key: "music", label: "Music (Alias of Instrumental)" },
];
 
/** Align every preview to the same timestamp (seconds), clamped per file. */
function syncAllPeers(sourceEl, time, syncTimeRef, registry) {
  const tRaw = Math.max(0, time);
  syncTimeRef.current = tRaw;
  for (const el of registry) {
    if (el === sourceEl) continue;
    if (!Number.isFinite(el.duration) || el.duration <= 0) continue;
    const clamped = Math.min(tRaw, Math.max(0, el.duration - 0.001));
    if (Math.abs(el.currentTime - clamped) > 0.02) {
      el.currentTime = clamped;
    }
  }
}

/** Apply timeline to all elements; optionally skip one node (e.g. while user drags its slider). */
function syncRegistryToTime(tRaw, syncTimeRef, registry, skipEl = null) {
  const t = Math.max(0, tRaw);
  syncTimeRef.current = t;
  for (const el of registry) {
    if (skipEl && el === skipEl) continue;
    if (!Number.isFinite(el.duration) || el.duration <= 0) continue;
    const clamped = Math.min(t, Math.max(0, el.duration - 0.001));
    if (Math.abs(el.currentTime - clamped) > 0.03) {
      el.currentTime = clamped;
    }
  }
}

/** Shared timeline (seconds) + registry so Vocals / Instrumental / Music stay aligned. */
function SyncedAudio({ src, syncTimeRef, audioRegistryRef }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const reg = audioRegistryRef.current;
    reg.add(el);
    return () => reg.delete(el);
  }, [src, audioRegistryRef]);

  const handlePlay = (e) => {
    const el = e.target;
    for (const other of audioRegistryRef.current) {
      if (other !== el) {
        other.pause();
      }
    }
    let maxT = 1e9;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      maxT = Math.max(0, el.duration - 0.02);
    }
    const t = Math.min(syncTimeRef.current, maxT);
    if (Math.abs(el.currentTime - t) > 0.03) {
      el.currentTime = t;
    }
    syncAllPeers(el, el.currentTime, syncTimeRef, audioRegistryRef.current);
  };

  const handleSeeking = (e) => {
    const el = e.target;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    const clamped = Math.min(el.currentTime, Math.max(0, el.duration - 0.001));
    syncRegistryToTime(clamped, syncTimeRef, audioRegistryRef.current, el);
  };

  const handleSeeked = (e) => {
    syncAllPeers(e.target, e.target.currentTime, syncTimeRef, audioRegistryRef.current);
  };

  const handlePause = (e) => {
    syncAllPeers(e.target, e.target.currentTime, syncTimeRef, audioRegistryRef.current);
  };

  const handleLoadedMetadata = (e) => {
    const el = e.target;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    const t = Math.min(syncTimeRef.current, Math.max(0, el.duration - 0.02));
    if (Math.abs(el.currentTime - t) > 0.03) {
      el.currentTime = t;
    }
  };

  return (
    <audio
      ref={audioRef}
      controls
      src={src}
      preload="auto"
      onPlay={handlePlay}
      onSeeking={handleSeeking}
      onSeeked={handleSeeked}
      onPause={handlePause}
      onLoadedMetadata={handleLoadedMetadata}
    />
  );
}

function StemPlayer({ label, url, enabled, syncTimeRef, audioRegistryRef }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loadState, setLoadState] = useState("idle");

  useEffect(() => {
    if (!enabled || !url) {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setLoadState("idle");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load audio");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [url, enabled]);

  if (!enabled) return null;

  return (
    <div className="stem-player">
      <div className="stem-player-head">
        <span className="stem-player-label">{label}</span>
        {loadState === "ready" && <span className="stem-ready-dot" title="Ready" />}
      </div>
      {loadState === "loading" && (
        <div className="stem-preview-skeleton" aria-hidden>
          <div className="stem-skel-bar" />
          <div className="stem-skel-bar stem-skel-bar--short" />
        </div>
      )}
      {loadState === "error" && <span className="stem-player-hint stem-player-hint--err">Preview unavailable</span>}
      {blobUrl && <SyncedAudio src={blobUrl} syncTimeRef={syncTimeRef} audioRegistryRef={audioRegistryRef} />}
    </div>
  );
}

const PROCESSING_MESSAGES = [
  "Uploading your audio…",
  "Running AI stem separation (Demucs)…",
  "Splitting vocals, drums, bass & more…",
  "Rendering instrumental & mixes…",
  "Almost there — finalizing…",
];

function ProcessingOverlay({ messageIndex }) {
  return (
    <div className="processing-overlay" role="alertdialog" aria-busy="true" aria-live="polite" aria-label="Processing audio">
      <div className="processing-backdrop" />
      <div className="processing-card">
        <div className="processing-visual" aria-hidden>
          <div className="processing-ring" />
          <div className="eq-bars">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} className="eq-bar" style={{ animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
        </div>
        <h2 className="processing-title">Working on your stems</h2>
        <p className="processing-message">{PROCESSING_MESSAGES[messageIndex % PROCESSING_MESSAGES.length]}</p>
        <div className="processing-progress" aria-hidden>
          <div className="processing-progress-indeterminate" />
        </div>
        <p className="processing-hint">First run may download models — hang tight.</p>
      </div>
    </div>
  );
}

function App() {
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processingMsgIndex, setProcessingMsgIndex] = useState(0);
  const [mixBusy, setMixBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedStems, setSelectedStems] = useState(["vocals", "instrumental"]);
  const [mixPreviewUrl, setMixPreviewUrl] = useState(null);
  const syncTimeRef = useRef(0);
  const previewAudioRegistryRef = useRef(new Set());

  const downloadUrl = useMemo(() => {
    if (!job?.id) return null;
    return (stem) => `${API_BASE}/jobs/${job.id}/download/${stem}/`;
  }, [job]);

  useEffect(() => {
    if (!loading) {
      setProcessingMsgIndex(0);
      return;
    }
    const id = setInterval(() => {
      setProcessingMsgIndex((i) => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2600);
    return () => clearInterval(id);
  }, [loading]);

  const onUpload = async () => {
    if (!file) return;
    setError("");
    setLoading(true);
    setProcessingMsgIndex(0);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch(`${API_BASE}/jobs/`, { method: "POST", body: data });
      if (!response.ok) throw new Error("Upload or separation failed");
      const json = await response.json();
      setJob(json);
      if (json.status === "failed") {
        setError(json.error_message || "Separation failed");
      }
    } catch (uploadError) {
      setError(uploadError.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (mixPreviewUrl) URL.revokeObjectURL(mixPreviewUrl);
    };
  }, [mixPreviewUrl]);

  useEffect(() => {
    if (job?.id) {
      syncTimeRef.current = 0;
    }
  }, [job?.id]);

  /** One master player runs the clock; followers are nudged every frame (tight sync). */
  useEffect(() => {
    if (job?.status !== "completed") return;
    let raf = 0;
    const tick = () => {
      const reg = previewAudioRegistryRef.current;
      if (reg.size > 0) {
        const els = Array.from(reg);
        const playing = els.filter((e) => !e.paused && !e.ended);
        if (playing.length > 0) {
          const master = playing[0];
          const t = master.currentTime;
          syncTimeRef.current = t;
          for (const el of els) {
            if (el === master) continue;
            if (!Number.isFinite(el.duration) || el.duration <= 0) continue;
            const c = Math.min(t, Math.max(0, el.duration - 0.001));
            if (Math.abs(el.currentTime - c) > 0.03) {
              el.currentTime = c;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [job?.status, job?.id]);

  const onMixDownload = async () => {
    if (!job?.id || selectedStems.length === 0) return;
    setError("");
    setMixBusy(true);
    try {
      const response = await fetch(`${API_BASE}/jobs/${job.id}/mix/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stems: selectedStems,
          output_name: `mix_${Date.now()}`,
        }),
      });
      if (!response.ok) throw new Error("Mix generation failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `custom_mix.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (mixError) {
      setError(mixError.message || "Mix failed");
    } finally {
      setMixBusy(false);
    }
  };

  const onMixPlayPreview = async () => {
    if (!job?.id || selectedStems.length === 0) return;
    setError("");
    setMixBusy(true);
    try {
      const response = await fetch(`${API_BASE}/jobs/${job.id}/mix/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stems: selectedStems,
          output_name: `mix_preview_${Date.now()}`,
        }),
      });
      if (!response.ok) throw new Error("Mix preview failed");
      const blob = await response.blob();
      setMixPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(e.message || "Mix preview failed");
    } finally {
      setMixBusy(false);
    }
  };

  const toggleStem = (stem) => {
    setSelectedStems((prev) => {
      if (prev.includes(stem)) return prev.filter((s) => s !== stem);
      return [...prev, stem];
    });
  };

  return (
    <div className="app-shell">
      {loading && <ProcessingOverlay messageIndex={processingMsgIndex} />}

      <header className="site-header">
        <div className="brand-mark" aria-hidden>
          <span className="brand-icon" />
        </div>
        <div>
          <h1 className="site-title">Syngrid Technology</h1>
          <p className="site-subtitle">Split vocals &amp; instruments — preview, sync, and export.</p>
        </div>
      </header>

      <main className="container">
        <section className="card card--upload">
          <div className="card-head">
            <span className="card-kicker">Step 1</span>
            <h2 className="card-title">Upload track</h2>
            <p className="card-desc">MP3, WAV, or FLAC. Processing runs on the server .</p>
          </div>
          <label className="file-drop" htmlFor="file">
            <input id="file" className="file-input" type="file" accept=".mp3,.wav,.flac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="file-drop-icon" aria-hidden />
            <span className="file-drop-text">{file ? file.name : "Choose a file or drop here"}</span>
            <span className="file-drop-hint">Max practical size depends on your server</span>
          </label>
          <button className="btn btn--primary btn--lg" type="button" onClick={onUpload} disabled={loading || !file}>
            {loading ? (
              <>
                <span className="btn-spinner" aria-hidden />
                Processing…
              </>
            ) : (
              <>
                <span className="btn-ico" aria-hidden />
                Upload &amp; separate stems
              </>
            )}
          </button>
        </section>

        {error && (
          <div className="alert alert--error" role="alert">
            <span className="alert-ico" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {job && (
          <section className="card card--result">
            <div className="result-head">
              <h2 className="card-title">Result</h2>
              <span className={`status-pill status-pill--${job.status}`}>{job.status}</span>
            </div>
            {job.status === "failed" && job.error_message && (
              <p className="error-inline">{job.error_message}</p>
            )}

            {job.status === "completed" && (
              <>
                <div className="section-block">
                  <h3 className="section-title">
                    <span className="section-ico section-ico--wave" aria-hidden />
                    Listen (preview)
                  </h3>
                  <p className="section-desc">Players stay time-synced. Only one plays at a time.</p>
                  <div className="stem-players">
                    <StemPlayer label="Vocals" url={downloadUrl("vocals")} enabled syncTimeRef={syncTimeRef} audioRegistryRef={previewAudioRegistryRef} />
                    <StemPlayer label="Instrumental" url={downloadUrl("instrumental")} enabled syncTimeRef={syncTimeRef} audioRegistryRef={previewAudioRegistryRef} />
                    <StemPlayer label="Music" url={downloadUrl("music")} enabled syncTimeRef={syncTimeRef} audioRegistryRef={previewAudioRegistryRef} />
                  </div>
                </div>

                <div className="section-block">
                  <h3 className="section-title">
                    <span className="section-ico section-ico--dl" aria-hidden />
                    Download stems
                  </h3>
                  <div className="downloads">
                    <a className="dl-link" href={downloadUrl("vocals")} download target="_blank" rel="noreferrer">
                      Vocals
                    </a>
                    <a className="dl-link" href={downloadUrl("instrumental")} download target="_blank" rel="noreferrer">
                      Instrumental
                    </a>
                    <a className="dl-link" href={downloadUrl("music")} download target="_blank" rel="noreferrer">
                      Music
                    </a>
                  </div>
                </div>
              </>
            )}

            {job.status === "completed" && (
              <div className="section-block section-block--mix">
                <h3 className="section-title">
                  <span className="section-ico section-ico--mix" aria-hidden />
                  Custom mix
                </h3>
                <p className="section-desc">Choose stems, then preview or download a mixed file.</p>
                <div className="stems">
                  {STEM_OPTIONS.map((stem) => (
                    <label key={stem.key} className={`stem-chip ${selectedStems.includes(stem.key) ? "stem-chip--on" : ""}`}>
                      <input type="checkbox" checked={selectedStems.includes(stem.key)} onChange={() => toggleStem(stem.key)} />
                      <span>{stem.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mix-actions">
                  <button className="btn btn--secondary" type="button" onClick={onMixPlayPreview} disabled={selectedStems.length === 0 || mixBusy}>
                    {mixBusy ? <span className="btn-spinner btn-spinner--dark" aria-hidden /> : null}
                    Play mix
                  </button>
                  <button className="btn btn--primary" type="button" onClick={onMixDownload} disabled={selectedStems.length === 0 || mixBusy}>
                    {mixBusy ? <span className="btn-spinner" aria-hidden /> : null}
                    Download mix
                  </button>
                </div>
                {mixPreviewUrl && (
                  <div className="stem-player stem-player--mix">
                    <div className="stem-player-head">
                      <span className="stem-player-label">Custom mix</span>
                      <span className="stem-ready-dot" title="Ready" />
                    </div>
                    <SyncedAudio src={mixPreviewUrl} syncTimeRef={syncTimeRef} audioRegistryRef={previewAudioRegistryRef} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span>Syngrid Technology</span>
        <span className="footer-dot" />
      </footer>
    </div>
  );
}

export default App;
