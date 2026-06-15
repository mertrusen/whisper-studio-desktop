/* desktop-app.js — loaded AFTER main.js.
   main.js defines its functions with `function` declarations (mutable bindings),
   so here we override the Premiere-specific ones with file-based desktop versions.
   All the pure logic (smart split, exports, karaoke, clean-up, settings) is reused
   from main.js untouched. */

(function () {
  const { ipcRenderer } = require("electron");
  const fsD   = require("fs");
  const pathD = require("path");
  const osD   = require("os");
  const { spawn: spawnD } = require("child_process");

  // ── Desktop state ─────────────────────────────────────────────────────────
  let mediaPath = null;       // currently loaded video/audio file
  let mediaEl   = null;       // <video> used for preview + playback

  const MEDIA_EXTS = ["mp4","mov","m4v","mkv","webm","avi","mp3","wav","m4a","aac","flac","ogg","wmv"];

  function fileUrl(p) {
    // Cross-platform file:// URL (Windows needs forward slashes + leading slash)
    let n = p.replace(/\\/g, "/");
    if (!n.startsWith("/")) n = "/" + n;
    return "file://" + encodeURI(n).replace(/#/g, "%23");
  }

  // Python discovery is handled by main.js's findPython() — now cross-platform
  // (probes `py`/`python`/`python3` + common Windows install paths). No override here.

  // extDir → the app directory injected by the shim (where scripts/ lives)
  extDir = function () { return window.__APP_DIR__; };

  // No ExtendScript in desktop
  loadHostJSX = function () { return Promise.resolve(); };
  evalScript  = function () { return Promise.resolve({ success: false, error: "Not available in desktop mode" }); };

  // ── File pickers (via main process dialogs) ───────────────────────────────
  async function pickMedia() {
    const res = await ipcRenderer.invoke("dialog:openMedia");
    if (res && res.filePath) loadMedia(res.filePath);
  }

  function loadMedia(p) {
    mediaPath = p;
    if (mediaEl) {
      mediaEl.src = fileUrl(p);
      mediaEl.style.display = "block";
      mediaEl.load();
    }
    const name = p.split(/[\\/]/).pop();
    const lbl = document.getElementById("media-name");
    if (lbl) lbl.textContent = name;
    setStatus("Loaded: " + name + " — click Transcribe", "success");
    const tb = document.getElementById("transcribe-btn");
    if (tb) tb.disabled = false;
  }

  // Drag & drop onto the window
  function wireDragDrop() {
    document.addEventListener("dragover", e => { e.preventDefault(); });
    document.addEventListener("drop", e => {
      e.preventDefault();
      if (!e.dataTransfer.files.length) return;
      const f = e.dataTransfer.files[0];
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (MEDIA_EXTS.includes(ext)) loadMedia(f.path);
      else if (ext === "srt") { try { _loadSRTData(fsD.readFileSync(f.path, "utf8"), f.name); } catch (er) {} }
      else showToast("Unsupported file type: ." + ext, "error");
    });
  }

  // ── Transcription (file-based, reuses main.js helpers) ────────────────────
  startTranscription = async function () {
    if (isRunning) return;
    if (!mediaPath) { showToast("Open a video/audio file first", "info", 2500); pickMedia(); return; }
    isRunning = true;
    const transcribeBtn = document.getElementById("transcribe-btn");
    const sendBtn = document.getElementById("send-btn");
    if (transcribeBtn) transcribeBtn.disabled = true;
    const actionsBar = document.getElementById("actions-bar");
    if (actionsBar) actionsBar.style.display = "none";
    hideError();

    const model    = document.getElementById("model-select").value;
    const language = document.getElementById("lang-select").value;

    try {
      const engLabel = { whisperx:"WhisperX", mlx:"mlx-whisper", openai:"openai-whisper", auto:"Whisper" }[settings.engine] || "Whisper";
      setStatus(`Transcribing with ${engLabel}… (first run may download the model)`, "info");
      showProgress(true);

      const txRes = await runPython("transcribe.py",
        [mediaPath, model, language, settings.engine, settings.diarize ? "1" : "0"],
        stderr => { if (/download/i.test(stderr)) setStatus("Downloading model… (one-time)", "info"); });

      if (!txRes.success) { handleError(txRes.error || "Transcription failed."); return; }

      lastLanguage = txRes.language || (language !== "auto" ? language : "");
      seqInTime = 0;

      let segs;
      try {
        segs = (txRes.segments || [])
          .filter(s => s != null && s.start != null && s.end != null)
          .map((s, i) => ({
            id: i, start: Number(s.start) || 0, end: Number(s.end) || 0,
            text: (s.text == null ? "" : String(s.text)),
            words: (s.words || []).filter(w => w != null && w.start != null && w.end != null),
            speaker: s.speaker || null,
          }));
        if (settings.autoSplit) segs = applySmartSplit(segs, settings);
      } catch (procErr) {
        console.error("[Desktop] processing failed:", procErr);
        segs = (txRes.segments || []).filter(s => s && s.start != null).map((s, i) => ({
          id: i, start: Number(s.start)||0, end: Number(s.end)||0, text: String(s.text||""), words: [], speaker: s.speaker||null,
        }));
      }

      // No timeline offset on desktop
      segments = segs.map(s => ({ ...s, seqStart: s.start, seqEnd: s.end }));
      renderSegments();

      if (segments.length === 0) {
        setStatus("No speech detected. Try another model/language.", "warning");
      } else {
        const lang = txRes.language ? ` · ${txRes.language}` : "";
        const note = (txRes.notes && txRes.notes.length) ? ` · ${txRes.notes[0]}` : "";
        setStatus(`Done — ${segments.length} segment(s)${lang}${note}`, "success");
        if (actionsBar) actionsBar.style.display = "flex";
        updateSegCount();
        if (settings.diarize && !segments.some(s => s.speaker))
          showToast("Speaker labels need a HuggingFace token (Settings).", "info", 6000);
        if (settings.autoPunctuate) await fixPunctuation({ silent: true, auto: true });
        if (settings.autoCleanup) {
          const d = applyDictionary({ silent:true }), f = removeFillers({ silent:true });
          renderSegments(); reselect();
          if (d + f > 0) showToast(`Auto clean-up: ${d} dict · ${f} fillers`, "info", 4000);
        }
      }
    } catch (e) {
      console.error("[Desktop] transcription error:", e);
      handleError(e && e.message ? e.message : String(e));
    } finally {
      isRunning = false;
      showProgress(false);
      if (transcribeBtn) transcribeBtn.disabled = false;
      if (sendBtn) sendBtn.disabled = segments.length === 0;
    }
  };

  // ── Playback (HTML5 media element) ────────────────────────────────────────
  playPause = async function () {
    const btn = document.getElementById("playpause-btn");
    if (!mediaEl || !mediaPath) { showToast("Open a file first", "info", 2000); return; }
    if (mediaEl.paused) { await mediaEl.play().catch(()=>{}); }
    else mediaEl.pause();
    if (btn) {
      const playing = !mediaEl.paused;
      btn.innerHTML = playing ? "⏸&nbsp; Pause" : "▶&nbsp; Play";
      btn.classList.toggle("playing", playing);
    }
  };

  seekToSegment = async function (idx) {
    const seg = segments[idx];
    if (!seg) return;
    selectSegment(idx);
    if (mediaEl && mediaPath) {
      mediaEl.currentTime = seg.seqStart;
      await mediaEl.play().catch(()=>{});
      const btn = document.getElementById("playpause-btn");
      if (btn) { btn.innerHTML = "⏸&nbsp; Pause"; btn.classList.add("playing"); }
    }
  };

  // ── Export → "Send" becomes "Save SRT" (export menu also available) ───────
  sendToPremiere = async function () {
    if (segments.length === 0) return;
    await desktopExport("srt");
  };

  // Override exportAs to use a native save dialog
  exportAs = async function (fmt) {
    const menu = document.getElementById("export-menu");
    if (menu) menu.style.display = "none";
    if (segments.length === 0) { showToast("Nothing to export yet", "info", 2000); return; }
    await desktopExport(fmt);
  };

  async function desktopExport(fmt) {
    const builders = { srt: segmentsToSRT, vtt: segmentsToVTT, ass: segmentsToASS, txt: segmentsToTXT };
    const builder = builders[fmt];
    if (!builder) return;
    const content = builder();
    const base = mediaPath ? mediaPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "captions";
    const res = await ipcRenderer.invoke("dialog:saveFile", { defaultName: `${base}.${fmt}`, ext: fmt });
    if (!res || !res.filePath) return;
    try {
      fsD.writeFileSync(res.filePath, content, "utf8");
      setStatus(`Exported ${fmt.toUpperCase()} → ${res.filePath}`, "success");
      showToast(`Saved ${fmt.toUpperCase()}`, "success");
    } catch (e) {
      showToast("Export failed: " + e.message, "error", 5000);
    }
  }

  // ── Audio enhancement (file in → file out) ────────────────────────────────
  enhanceAudio = async function () {
    if (!mediaPath) { showToast("Open a file first", "info", 2000); return; }
    const btn = document.getElementById("enhance-btn");
    if (btn) btn.disabled = true;
    setStatus("Enhancing audio (denoise + normalize)…", "info");
    showProgress(true);
    try {
      const res = await ipcRenderer.invoke("dialog:saveFile",
        { defaultName: baseName() + "_enhanced.wav", ext: "wav" });
      if (!res || !res.filePath) { setStatus("Cancelled", "info"); return; }
      const enh = await runPython("enhance_audio.py",
        [mediaPath, res.filePath, settings.audioDenoise ? "1":"0", settings.audioNormalize ? "1":"0"]);
      if (!enh.success) { handleError(enh.error || "Enhancement failed."); return; }
      setStatus(`✓ Enhanced audio saved → ${res.filePath}`, "success");
      showToast("Enhanced audio saved", "success");
    } catch (e) { handleError(e.message); }
    finally { showProgress(false); if (btn) btn.disabled = false; }
  };

  // ── Silence cut (produces a trimmed media file) ───────────────────────────
  cutSilences = async function () {
    if (!mediaPath) { showToast("Open a file first", "info", 2000); return; }
    const btn = document.getElementById("silence-cut-btn");
    if (btn) btn.disabled = true;
    setSilenceStatus("Detecting silences…", "info");
    showSilenceProgress(true);
    try {
      // 1) Detect silence ranges on the source file
      const det = await runPython("detect_silence.py",
        [mediaPath, String(settings.silenceThreshold), String(settings.silenceMinDur)]);
      if (!det.success) { setSilenceStatus(det.error || "Detection failed", "error"); return; }
      const silences = det.silences || [];
      if (!silences.length) { setSilenceStatus("No silences found.", "warning"); showToast("No silences found", "info"); return; }

      // 2) Total duration from the media element (fallback: last silence end + 1)
      let dur = (mediaEl && isFinite(mediaEl.duration) && mediaEl.duration > 0)
        ? mediaEl.duration : (silences[silences.length - 1].end + 1);

      // 3) Compute KEEP (speech) ranges = complement of silences, with padding
      const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
      const cuts = silences.map(s => [Math.min(dur, s.start + pad), Math.max(0, s.end - pad)])
                           .filter(([a, b]) => b - a > 0.08);
      const keep = [];
      let cursor = 0;
      for (const [a, b] of cuts) {
        if (a > cursor) keep.push([cursor, a]);
        cursor = Math.max(cursor, b);
      }
      if (cursor < dur) keep.push([cursor, dur]);
      const kept = keep.filter(([a, b]) => b - a > 0.05);
      if (!kept.length) { setSilenceStatus("Nothing left after cutting — lower padding.", "warning"); return; }

      const removed = dur - kept.reduce((s, [a, b]) => s + (b - a), 0);
      if (!confirm(`Remove ${cuts.length} silent gap(s) (~${removed.toFixed(1)}s) and export a trimmed file?`)) {
        setSilenceStatus("Cancelled.", "info"); return;
      }

      // 4) Output file + run the ffmpeg trim/concat script
      const inExt = (mediaPath.split(".").pop() || "mp4").toLowerCase();
      const isAudio = ["mp3","wav","m4a","aac","flac","ogg"].includes(inExt);
      const outExt = isAudio ? inExt : "mp4";
      const res = await ipcRenderer.invoke("dialog:saveFile",
        { defaultName: baseName() + "_cut." + outExt, ext: outExt });
      if (!res || !res.filePath) { setSilenceStatus("Cancelled", "info"); return; }

      setSilenceStatus(`Cutting ${cuts.length} gap(s)…`, "info");
      const cut = await runPython("cut_media.py",
        [mediaPath, res.filePath, JSON.stringify(kept)]);
      if (!cut.success) { setSilenceStatus(cut.error || "Cut failed", "error"); showToast("Cut failed", "error", 5000); return; }
      setSilenceStatus(`✓ Trimmed file saved → ${res.filePath}`, "success");
      showToast("Silences cut — trimmed file saved", "success", 5000);
    } catch (e) {
      setSilenceStatus(e.message, "error");
    } finally {
      showSilenceProgress(false);
      if (btn) btn.disabled = false;
    }
  };

  // detectSilences (marker version) is Premiere-only → no-op on desktop
  detectSilences = function () {
    showToast("Use “Cut Silences” on desktop — markers are Premiere-only.", "info", 4000);
  };

  function baseName() {
    return mediaPath ? mediaPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "output";
  }

  // ── DOM tweaks: relabel & inject desktop-specific controls ────────────────
  function tweakUI() {
    document.title = "Subsper (Desktop)";
    // Tagline shows "Desktop" — DON'T touch the status-indicator dot.
    const tag = document.querySelector(".brand-tagline");
    if (tag) tag.textContent = "Desktop";

    // Open-media button + media preview, injected at top of the transcribe controls
    const controls = document.querySelector("#panel-tx-work .controls");
    if (controls) {
      const openBtn = document.createElement("button");
      openBtn.className = "btn-transcribe";
      openBtn.style.cssText = "margin-top:0;margin-bottom:10px;background:var(--bg3);border:1px solid var(--border2);box-shadow:none;color:var(--text)";
      openBtn.innerHTML = '<span class="ic">' + (typeof icon === "function" ? icon("folder") : "") + '</span><span>Open Video / Audio File</span>';
      openBtn.setAttribute("data-tip", "Bilgisayardan bir video/ses dosyası seç (pencereye sürükle-bırak da olur)");
      openBtn.onclick = pickMedia;

      const nameRow = document.createElement("div");
      nameRow.style.cssText = "font-size:10px;color:var(--text3);margin-bottom:10px;text-align:center;word-break:break-all";
      nameRow.innerHTML = '<span id="media-name">No file loaded — drag a file here</span>';

      mediaEl = document.createElement("video");
      mediaEl.id = "media-preview";
      mediaEl.controls = true;
      mediaEl.style.cssText = "width:100%;max-height:220px;background:#000;border-radius:8px;margin-bottom:10px;display:none";

      controls.insertBefore(openBtn, controls.firstChild);
      controls.insertBefore(mediaEl, controls.children[1]);
      controls.insertBefore(nameRow, controls.children[2]);
    }

    // Transcribe button: disabled until a file is loaded (label comes from i18n)
    const tb = document.getElementById("transcribe-btn");
    if (tb) tb.disabled = true;

    // Hide "Send to Premiere" → desktop uses the export menu
    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) sendBtn.style.display = "none";

    // Edit tab: hide marker detect (Premiere-only) and the whole Auto Zoom tool
    // (Auto Zoom needs Premiere's Motion keyframes). Cut Silences stays → file export.
    hideToolCard("silence-btn", false);     // keep its card, just hide the button
    const markBtn = document.getElementById("silence-btn");
    if (markBtn) markBtn.style.display = "none";
    hideToolCard("zoom-btn", true);         // hide Auto Zoom card + section
    hideToolCard("set-zoomamt", true);      // hide Auto Zoom settings card + section

    // Subtitles settings: hide "Send to Premiere" (caption track / MOGRT) — Premiere-only
    hideToolCard("set-sendmode", true);

    // Keyboard: spacebar toggles playback when not typing
    document.addEventListener("keydown", e => {
      if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) {
        e.preventDefault(); playPause();
      }
    });
  }

  // Hide a tool's card (its .setting-item); optionally hide the preceding section title.
  function hideToolCard(id, withTitle) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.closest(".setting-item");
    if (!card) return;
    if (id !== "silence-btn") card.style.display = "none";   // silence-btn shares a card with Cut
    if (withTitle) {
      const prev = card.previousElementSibling;
      if (prev && prev.classList.contains("setup-section-title")) prev.style.display = "none";
    }
  }

  // Desktop wording (file-based, no Premiere) — patch the shared i18n table.
  function patchDesktopI18N() {
    if (typeof I18N === "undefined") return;
    Object.assign(I18N.en, {
      btn_transcribe: "Transcribe File",
      tip_transcribe: "Transcribe the loaded video/audio file",
      empty_p: "Open a video or audio file, then click Transcribe.",
      status_ready: "Open a video or audio file to begin",
      btn_cut: "Cut Silences (export trimmed file)",
      tip_cut: "Finds silent gaps and exports a trimmed copy with them removed (great for CapCut)",
      hint_cut: "Exports a trimmed copy of your file with the silent gaps removed.",
      ed_intro: "Silence cutting for the loaded file. Open a file first.",
      au_intro: "Audio tools for the loaded file. Open a file first.",
      tip_enhance: "Cleans the loaded file's audio (denoise + normalize) and saves a new WAV",
      tip_play: "Play / pause the preview player (Space). Clicking a segment jumps there",
      tip_send: "Export the subtitles as an .srt file",
    });
    Object.assign(I18N.tr, {
      btn_transcribe: "Dosyayı Yazıya Dök",
      tip_transcribe: "Yüklü video/ses dosyasını yazıya döker",
      empty_p: "Bir video/ses dosyası aç, sonra Transcribe'a bas.",
      status_ready: "Başlamak için bir video/ses dosyası aç",
      btn_cut: "Sessizlikleri Kes (kırpılmış dosya)",
      tip_cut: "Sessiz boşlukları bulup kırpılmış bir kopya çıkarır (CapCut için ideal)",
      hint_cut: "Dosyanın sessiz boşlukları çıkarılmış kırpılmış kopyasını kaydeder.",
      ed_intro: "Yüklü dosya için sessizlik kesme. Önce bir dosya aç.",
      au_intro: "Yüklü dosya için ses araçları. Önce bir dosya aç.",
      tip_enhance: "Yüklü dosyanın sesini temizler (gürültü+seviye) ve yeni bir WAV kaydeder",
      tip_play: "Önizleme oynatıcıyı oynat/duraklat (Space). Segmente tıklayınca o ana gider",
      tip_send: "Altyazıyı .srt dosyası olarak dışa aktar",
    });
  }

  patchDesktopI18N();
  tweakUI();
  if (typeof applyLanguage === "function") applyLanguage();
  wireDragDrop();
  setStatus(typeof t === "function" ? t("status_ready") : "Open a video or audio file to begin", "info");

  // Re-run the setup check now that findPython() is Windows-aware (main.js ran the
  // first check before our override loaded).
  try {
    runPython("check_setup.py", []).then(data => {
      if (typeof diagData !== "undefined") diagData = data;
      const ind = document.getElementById("setup-indicator");
      const badge = document.getElementById("setup-badge");
      if (!ind) return;
      if (!data || !data._ready) { ind.className = "setup-indicator warn"; if (badge) badge.style.display = "inline-flex"; }
      else { ind.className = "setup-indicator ok"; if (badge) badge.style.display = "none"; }
    }).catch(() => {});
  } catch (e) {}
})();
