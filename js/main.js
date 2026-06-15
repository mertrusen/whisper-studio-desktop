/* Whisper Studio – main.js */

// ── Node.js (CEP --enable-nodejs) ─────────────────────────────────────────
const _req      = window.require || (window.cep_node && window.cep_node.require);
const fs        = _req("fs");
const path      = _req("path");
const os        = _req("os");
const { spawn } = _req("child_process");

// ── CEP ───────────────────────────────────────────────────────────────────
const csInterface = new CSInterface();

// ── State ─────────────────────────────────────────────────────────────────
let segments = [], seqInTime = 0, isRunning = false, selectedIndex = -1, toastTimer = null;
let lastLanguage = "";

// ── Settings (persisted to localStorage) ──────────────────────────────────
const DEFAULT_SETTINGS = {
    engine:          "auto",      // try whisperx → mlx → openai; works with whatever is installed
    diarize:         false,
    autoPunctuate:   false,
    autoSplit:       true,
    maxCharsPerLine: 42,
    maxLines:        2,
    maxCps:          17,
    maxDur:          7.0,
    gapFill:         false,
    gapMax:          2.0,
    stylePreset:     "clean",
    karaoke:         false,
    karaokeHi:       "FFE000",   // highlight (spoken word) colour for karaoke .ass
    silenceThreshold: -30,
    silenceMinDur:    0.6,
    silencePad:       0.05,       // seconds kept around speech when ripple-cutting
    customStyle:      null,
    uiLang:           "en",       // interface language: en | tr
    // ── Transcript clean-up ──
    customDict:      "",          // one "wrong=right" rule per line
    autoCleanup:     false,       // apply dictionary + fillers automatically after transcribe
    fillerWords:     "",          // extra fillers (comma/newline separated); blank = built-in only
    fillerOn:        true,        // include built-in filler list
    profanityList:   "",          // extra profanity words
    profanityMode:   "asterisk",  // asterisk | remove
    // ── Audio enhancement ──
    audioDenoise:    true,
    audioNormalize:  true,
    // ── Send to Premiere ──
    sendMode:        "caption",   // caption (SRT track) | graphics (MOGRT text)
    mogrtPath:       "",          // chosen .mogrt template for styled graphics
    // ── Edit automation ──
    zoomAmount:      8,           // % push-in per clip
    zoomStyle:       "alternate", // alternate | in
};

// Built-in filler words (Turkish + English). Phrases first so they match before single words.
const BUILTIN_FILLERS = [
    "you know", "i mean", "sort of", "kind of",
    "ee", "eee", "ııı", "ıı", "ı ı", "şey", "yani", "hani", "işte", "falan",
    "aa", "ee", "mmm", "hmm", "ııh", "ee ", "um", "uh", "uhm", "erm", "er", "like",
];

// Built-in profanity (kept mild/partial; users extend in Settings). Matched word-boundary, case-insensitive.
const BUILTIN_PROFANITY = [
    "amk", "aq", "oç", "piç", "siktir", "orospu", "yarrak", "göt", "amına", "amcık", "sik", "pezevenk",
    "fuck", "shit", "bitch", "asshole", "bastard", "dick", "cunt", "motherfucker",
];

const DEFAULT_CUSTOM_STYLE = {
    font: "Arial", size: 54, primary: "FFFFFF", outline: "000000",
    outlineW: 3, shadow: 1, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96
};

let settings = loadSettings();

// ── Subtitle style presets ─────────────────────────────────────────────────
const STYLE_PRESETS = {
    clean:       { label: "Clean White",   font: "Arial",   size: 54, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    bold_yellow: { label: "Bold Yellow",   font: "Arial",   size: 60, primary: "FFE000", outline: "000000", outlineW: 4, shadow: 1, bold: true,  align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    tiktok:      { label: "Boxed (TikTok)",font: "Arial",   size: 62, primary: "FFFFFF", outline: "000000", outlineW: 0, shadow: 0, bold: true,  align: 2, box: true,  boxColor: "000000", boxAlpha: 40 },
    cinematic:   { label: "Cinematic",     font: "Georgia", size: 48, primary: "F5F5DC", outline: "000000", outlineW: 2, shadow: 2, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    outline:     { label: "Heavy Outline", font: "Arial",   size: 56, primary: "FFFFFF", outline: "000000", outlineW: 5, shadow: 0, bold: true,  align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    top:         { label: "Top White",     font: "Arial",   size: 52, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, align: 8, box: false, boxColor: "000000", boxAlpha: 96 },
    custom:      { label: "Custom",        font: "Arial",   size: 54, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
};

function getActivePreset() {
    if (settings.stylePreset === "custom") {
        return { ...DEFAULT_CUSTOM_STYLE, ...(settings.customStyle || {}), label: "Custom" };
    }
    return STYLE_PRESETS[settings.stylePreset] || STYLE_PRESETS.clean;
}

function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem("ws_settings") || "{}")); }
    catch { return Object.assign({}, DEFAULT_SETTINGS); }
}
function saveSettings() {
    try { localStorage.setItem("ws_settings", JSON.stringify(settings)); } catch {}
}
function onSettingChange(key, value) {
    settings[key] = value;
    saveSettings();
    if (key === "autoSplit") {
        const sub = document.getElementById("autosplit-sub");
        if (sub) sub.style.display = value ? "block" : "none";
    }
}

// ── Internationalization (EN / TR) ─────────────────────────────────────────
const I18N = {
  en: {
    // header / tabs
    tagline: "AI Subtitles", status_ready: "Ready — set In/Out points and click Transcribe",
    tab_transcribe: "Subtitles", tab_silence: "Silence", tab_setup: "Setup",
    sub_work_tx: "Edit", sub_settings: "Settings", sub_detect: "Detect",
    // transcribe controls
    lbl_model: "Model", lbl_language: "Language", opt_auto: "Auto detect",
    btn_transcribe: "Transcribe In/Out Selection", btn_loadsrt: "Load SRT",
    btn_play: "Play", btn_pause: "Pause",
    btn_enhance: "Enhance Audio — denoise + normalize",
    empty_p: "Set In (I) and Out (O) points on your timeline, then click Transcribe.",
    empty_hint: "Click a word to split there · double-click text to edit.",
    // find / replace
    find_ph: "Find…", replace_ph: "Replace with… (optional)",
    btn_close: "Close", btn_replaceall: "Replace All",
    // actions
    act_clear: "Clear", act_send: "Send to Premiere",
    clean_title: "Clean up…", clean_dict: "Apply Dictionary", clean_filler: "Remove Fillers",
    clean_prof: "Censor Profanity", clean_all: "Clean All",
    export_title: "Export as…", export_srt: "SubRip", export_vtt: "WebVTT",
    export_ass: "Advanced SSA", export_txt: "Plain text",
    // settings sections
    sec_engine: "Transcription Engine", sec_cleanup: "Transcript Clean-up",
    sec_audio: "Audio Enhancement", sec_quality: "Subtitle Quality",
    sec_style: "Subtitle Style", sec_karaoke: "Karaoke", sec_timing: "Subtitle Timing",
    sec_interface: "Interface", lbl_uilang: "Language", sec_modellang: "Model & Language",
    // settings items
    nm_engine: "Engine", ds_engine: "WhisperX gives the most accurate word timing + speaker labels",
    nm_diar: "Speaker Labels", ds_diar: "Tags who is speaking. WhisperX only — needs a free HuggingFace token.",
    nm_autopunct: "Auto-punctuation", ds_autopunct: "Restore punctuation & casing right after transcribing",
    nm_autocleanup: "Auto clean-up", ds_autocleanup: "Apply dictionary & remove fillers when transcription finishes",
    lbl_dict: "Custom dictionary", hint_dict: "Fixes names, brands & mis-hearings. Format: wrong=right (whole word, case-insensitive).",
    nm_filler: "Filler words", ds_filler: "Include the built-in list (ee, ıı, şey, um, uh…)",
    lbl_extrafiller: "Extra fillers to remove",
    nm_prof: "Profanity filter", ds_prof: "How to handle matched words",
    lbl_extraprof: "Extra words to censor", hint_cleanrun: "Run any of these from the clean-up menu on the Subtitles tab.",
    nm_denoise: "Denoise", ds_denoise: "High-pass + FFT noise reduction (removes hiss/hum)",
    nm_normalize: "Loudness normalize", ds_normalize: "EBU R128 to −16 LUFS — consistent, social-ready volume",
    hint_enhance: "Run 🎚 Enhance Audio on the Subtitles tab. The cleaned WAV is imported to a “Whisper Audio” bin.",
    nm_autoformat: "Auto-format subtitles", ds_autoformat: "Split long / over-fast subtitles to broadcast standards",
    lbl_cpl: "Max characters per line", lbl_lines: "Max lines",
    lbl_cps: "Max reading speed (chars/sec)", lbl_maxdur: "Max subtitle duration",
    hint_split: "Subtitles longer than this (or too fast to read) are split at word boundaries.",
    lbl_textcolor: "Text color", lbl_outlinecolor: "Outline color", lbl_size: "Size",
    lbl_outlinew: "Outline width", lbl_bold: "Bold", lbl_box: "Box bg",
    opt_bottom: "Bottom", opt_top: "Top", opt_center: "Center",
    hint_style: "Applies to .ass exports. SRT / Premiere captions carry no styling.",
    nm_karaoke: "Word-by-word highlight", ds_karaoke: "Each word lights up as spoken. Exports as karaoke .ass (needs word timing).",
    lbl_hicolor: "Highlight colour", hint_karaoke: "Open the .ass in CapCut, VLC or Premiere. Spoken words switch to the highlight colour.",
    nm_continuous: "Continuous subtitles", ds_continuous: "Extend each subtitle to the next, filling short gaps",
    lbl_maxgap: "Max gap to fill", hint_gap: "Gaps larger than this stay separate.",
    // silence
    sil_intro: "Analyzes the In/Out audio. Mark places markers; Cut ripple-deletes silent gaps and shifts clips left. Set In/Out first.",
    btn_mark: "Detect & Mark Silences", btn_cut: "Cut Silences (ripple delete)",
    hint_cut: "Cut is experimental — best on simple single-camera timelines. Undo with Ctrl/Cmd+Z.",
    sec_detect: "Detection Settings",
    lbl_silthr: "Silence threshold", lbl_sildur: "Min silence length", lbl_silpad: "Cut padding (keep around speech)",
    hint_sil: "Lower dB = only deeper silences count. Raise length to skip brief pauses. Padding leaves breath when cutting.",
    sil_status: "Detect silences in your In/Out selection",
    // setup
    sec_syscheck: "System Check", sec_models: "Whisper Models", sec_install: "Install Notes",
    btn_recheck: "Re-check", btn_reload: "Reload Extension",
    // tooltips
    tip_tab_transcribe: "Auto-generate and edit subtitles from your video",
    tip_tab_silence: "Find, mark or cut silent gaps",
    tip_tab_setup: "System check — are Python, ffmpeg and Whisper installed?",
    tip_sub_tx_work: "Transcription & segment editing screen",
    tip_sub_tx_settings: "Engine, auto-format, style, karaoke and clean-up settings",
    tip_sub_sl_work: "Detect, mark or ripple-cut silences",
    tip_sub_sl_settings: "Threshold (dB), minimum length and cut padding",
    tip_model: "Whisper model: turbo = fast & accurate (recommended), large = best but slower, small/base = fast but less accurate",
    tip_lang: "Spoken language. 'Auto detect' finds it — but picking it gives more accurate results",
    tip_transcribe: "Transcribes the audio in the In (I) / Out (O) range on your timeline",
    tip_loadsrt: "Load an existing .srt subtitle file and edit it here",
    tip_play: "Play / pause in Premiere. Clicking a segment also jumps there and plays",
    tip_enhance: "Cleans the In/Out audio: reduces noise + balances loudness (−16 LUFS). Imports the clean WAV to the project",
    tip_case: "Case-sensitive search",
    tip_findprev: "Previous match (Shift+Enter)", tip_findnext: "Next match (Enter)",
    tip_replaceinput: "Text to replace the match with. Leave empty to delete the word",
    tip_replaceall: "Replace all matches",
    tip_segcount: "Total number of segments (subtitle lines)",
    tip_find: "Find & replace text", tip_punct: "Auto-fix punctuation & capitalization",
    tip_clean: "Clean-up menu: dictionary, fillers, profanity filter",
    tip_clean_dict: "Apply your wrong=right rules from Settings",
    tip_clean_filler: "Remove filler words (ee, ıı, şey, um, uh…)",
    tip_clean_prof: "Censor profanity (asterisk or remove)",
    tip_clean_all: "Apply dictionary + fillers + profanity at once",
    tip_export: "Export subtitles to a file",
    tip_export_srt: "Most common subtitle format. CapCut, YouTube, Premiere all open it",
    tip_export_vtt: "Web / HTML5 video subtitle format",
    tip_export_ass: "Styled / karaoke subtitle. Carries colour, font, box, word highlight",
    tip_export_txt: "Plain text without timestamps (transcript)",
    tip_clear: "Delete all segments and start over",
    tip_send: "Send the subtitle to the Premiere timeline as a caption track",
    tip_engine: "Which AI engine transcribes. WhisperX = word-level timing + speaker labels (needed for karaoke). mlx = fastest on Apple Silicon. openai = most compatible.",
    tip_diar: "Labels who is speaking (Speaker 1, 2…). WhisperX only. Needs a free HuggingFace token.",
    tip_autopunct: "Auto-fixes punctuation & capitalization right after transcribing",
    tip_autocleanup: "After transcribing, applies dictionary rules and removes filler words automatically",
    tip_filler: "Use the built-in filler list (ee, ıı, şey, yani, um, uh…)",
    tip_profmode: "How to hide profanity: first letter + asterisks (s***) or remove (—)",
    tip_denoise: "Reduces background noise/hum (high-pass + FFT denoise)",
    tip_normalize: "Balances loudness to −16 LUFS — consistent, social/broadcast-ready",
    tip_autoformat: "Auto-splits long/fast subtitles to broadcast standards (per limits below)",
    tip_cpl: "Max characters on one line. Standard: 37–42. More is hard to read",
    tip_lines2: "Max lines shown per subtitle. Standard: 2",
    tip_cps: "Max characters per second (reading speed). Faster than this gets split. Standard: 15–17",
    tip_maxdur: "Max seconds one subtitle stays on screen. Longer ones split at word boundaries",
    tip_stylepreview: "Live preview of the selected style (used in .ass export)",
    tip_stylechips: "Preset subtitle styles. 'Custom' lets you set your own colour/font",
    tip_hicolor: "Highlight colour of the spoken word (unspoken words stay white)",
    tip_karaoke: "Instagram/TikTok style: each word changes colour as spoken. Exports as .ass. Needs word timing (WhisperX/Whisper)",
    tip_continuous: "Extends each subtitle until the next begins — no flicker in short gaps",
    tip_maxgap: "Gaps longer than this are NOT filled — subtitles stay separate",
    tip_mark: "Finds silent gaps and adds orange markers — nothing is deleted, just marked",
    tip_cut: "Ripple-deletes silent gaps and pulls clips left. Experimental — undo with Ctrl/Cmd+Z",
    tip_silthr: "Which level counts as 'silence'. Low (e.g. −45) catches only deep silences; high (e.g. −20) also counts soft pauses",
    tip_sildur: "Minimum silence length to count. Higher skips short breaths/pauses",
    tip_silpad: "Small margin kept around speech when cutting — so word starts/ends aren't clipped",
    tip_maxgap2: "Gaps longer than this aren't filled — subtitles stay separate. Short gaps are merged",
    tip_recheck: "Re-scan the system — press after installing something missing",
    tip_reload: "Reload the panel — applies code updates (without restarting Premiere)",
    tip_uilang: "Interface & tooltip language",
    tip_seek: "Jump here and play", tip_edit: "Edit text (double-click also works)",
    tip_split: "Split this segment in half", tip_del: "Delete this segment",
    // send-to-Premiere mode
    sec_send: "Send to Premiere", nm_sendmode: "Send subtitles as",
    ds_sendmode: "Caption track = simple, fast. Styled graphics = editable text clips with your style (like AutoCut/FireCut).",
    opt_caption: "Caption track (SRT)", opt_graphics: "Styled graphics (MOGRT)",
    lbl_mogrt: "Style template (.mogrt)", btn_pickmogrt: "Choose .mogrt…",
    mogrt_none: "No template chosen", act_send_gfx: "Send as Graphics",
    hint_mogrt: "Export a styled text template once from Premiere: Graphics workspace → make a text layer → Export Motion Graphics Template. Then pick it here.",
    tip_sendmode: "How captions land in Premiere: a plain caption track, or editable styled text graphics via a Motion Graphics Template",
    tip_pickmogrt: "Pick the .mogrt template whose style the subtitles will use",
    err_nomogrt_what: "No .mogrt template selected.",
    err_nomogrt_why: "Styled graphics mode places each subtitle using a Motion Graphics Template — you need to pick one first.",
    err_nomogrt_fix: "Export a styled text template from Premiere (Graphics → text layer → Export Motion Graphics Template), then choose it in Settings.",
    // new tabs
    tab_edit: "Edit", tab_audio: "Audio", sub_actions: "Tools",
    tip_tab_edit: "Automated editing — cut silences, fillers, shorten pauses, auto-zoom",
    tip_tab_audio: "Audio tools — clean up, normalize, beep profanity",
    tip_sub_ed_work: "Run the editing tools", tip_sub_au_work: "Run the audio tools",
    ed_intro: "Automated editing for the In/Out selection. Set In/Out points on your timeline first.",
    au_intro: "Audio tools for the In/Out selection. Set In/Out points on your timeline first.",
    sec_silence: "Silence", sec_enhance: "Enhance",
    // auto zoom
    sec_zoom: "Auto Zoom", nm_zoom: "Auto Zoom",
    ds_zoom: "Adds a subtle motion (slow push-in) to each clip in the selection for energy — like AutoCut/FireCut.",
    btn_zoom: "Apply Auto Zoom", lbl_zoomamt: "Zoom amount", lbl_zoomstyle: "Zoom style",
    opt_zoom_alt: "Alternate in / out", opt_zoom_in: "Always push-in", opt_zoom_subtle: "Subtle (gentle)",
    hint_zoom: "Adds Motion → Scale keyframes to clips in the In/Out range. Experimental — undo with Ctrl/Cmd+Z.",
    tip_zoom: "Adds a slow zoom (Motion keyframes) to each clip in the In/Out range for a dynamic, pro feel",
    tip_zoomamt: "How far each clip zooms over its length (e.g. 8% = 100%→108%)",
    tip_zoomstyle: "Alternate = clips zoom in then out; Always push-in = every clip pushes in",
  },
  tr: {
    tagline: "Yapay Zekâ Altyazı", status_ready: "Hazır — In/Out koy ve Transcribe'a bas",
    tab_transcribe: "Altyazı", tab_silence: "Sessizlik", tab_setup: "Kurulum",
    sub_work_tx: "Düzenle", sub_settings: "Ayarlar", sub_detect: "Tespit",
    lbl_model: "Model", lbl_language: "Dil", opt_auto: "Otomatik algıla",
    btn_transcribe: "In/Out Aralığını Yazıya Dök", btn_loadsrt: "SRT Yükle",
    btn_play: "Oynat", btn_pause: "Duraklat",
    btn_enhance: "Sesi İyileştir — gürültü azalt + dengele",
    empty_p: "Timeline'da In (I) ve Out (O) noktalarını koy, sonra Transcribe'a bas.",
    empty_hint: "Bölmek için kelimeye tıkla · düzenlemek için metne çift tıkla.",
    find_ph: "Ara…", replace_ph: "Şununla değiştir… (opsiyonel)",
    btn_close: "Kapat", btn_replaceall: "Tümünü Değiştir",
    act_clear: "Temizle", act_send: "Premiere'e Gönder",
    clean_title: "Temizlik…", clean_dict: "Sözlüğü Uygula", clean_filler: "Dolguları Kaldır",
    clean_prof: "Küfür Sansürle", clean_all: "Hepsini Temizle",
    export_title: "Şu formatta aktar…", export_srt: "SubRip", export_vtt: "WebVTT",
    export_ass: "Advanced SSA", export_txt: "Düz metin",
    sec_engine: "Transkripsiyon Motoru", sec_cleanup: "Metin Temizliği",
    sec_audio: "Ses İyileştirme", sec_quality: "Altyazı Kalitesi",
    sec_style: "Altyazı Stili", sec_karaoke: "Karaoke", sec_timing: "Altyazı Zamanlaması",
    sec_interface: "Arayüz", lbl_uilang: "Dil", sec_modellang: "Model & Dil",
    nm_engine: "Motor", ds_engine: "WhisperX en doğru kelime zamanı + konuşmacı etiketi verir",
    nm_diar: "Konuşmacı Etiketleri", ds_diar: "Kim konuşuyor etiketler. Sadece WhisperX — ücretsiz HuggingFace token gerekir.",
    nm_autopunct: "Otomatik noktalama", ds_autopunct: "Transkripsiyon biter bitmez noktalama ve büyük harfleri düzeltir",
    nm_autocleanup: "Otomatik temizlik", ds_autocleanup: "İş bitince sözlüğü uygular ve dolgu kelimeleri siler",
    lbl_dict: "Özel sözlük", hint_dict: "İsim/marka/yanlış duymaları düzeltir. Format: yanlış=doğru (tam kelime, büyük-küçük fark etmez).",
    nm_filler: "Dolgu kelimeler", ds_filler: "Yerleşik listeyi kullan (ee, ıı, şey, um, uh…)",
    lbl_extrafiller: "Kaldırılacak ekstra dolgular",
    nm_prof: "Küfür filtresi", ds_prof: "Eşleşen kelimeler nasıl gizlensin",
    lbl_extraprof: "Sansürlenecek ekstra kelimeler", hint_cleanrun: "Bunları Altyazı sekmesindeki temizlik menüsünden çalıştır.",
    nm_denoise: "Gürültü azalt", ds_denoise: "High-pass + FFT gürültü azaltma (uğultu/tıslama temizler)",
    nm_normalize: "Ses seviyesi dengele", ds_normalize: "EBU R128 ile −16 LUFS — tutarlı, sosyal medyaya hazır",
    hint_enhance: "Altyazı sekmesindeki 🎚 Enhance Audio'ya bas. Temiz WAV “Whisper Audio” bin'ine eklenir.",
    nm_autoformat: "Altyazıyı otomatik biçimle", ds_autoformat: "Uzun / çok hızlı altyazıları yayın standardına böler",
    lbl_cpl: "Satır başına maks. karakter", lbl_lines: "Maks. satır",
    lbl_cps: "Maks. okuma hızı (kar./sn)", lbl_maxdur: "Maks. altyazı süresi",
    hint_split: "Bundan uzun (veya çok hızlı) altyazılar kelime sınırından bölünür.",
    lbl_textcolor: "Yazı rengi", lbl_outlinecolor: "Kenar rengi", lbl_size: "Boyut",
    lbl_outlinew: "Kenar kalınlığı", lbl_bold: "Kalın", lbl_box: "Kutu zemin",
    opt_bottom: "Alt", opt_top: "Üst", opt_center: "Orta",
    hint_style: ".ass dışa aktarıma uygulanır. SRT / Premiere altyazısı stil taşımaz.",
    nm_karaoke: "Kelime kelime vurgu", ds_karaoke: "Her kelime söylendikçe yanar. Karaoke .ass olarak çıkar (kelime zamanı gerekir).",
    lbl_hicolor: "Vurgu rengi", hint_karaoke: ".ass'i CapCut, VLC veya Premiere'de aç. Söylenen kelimeler vurgu rengine geçer.",
    nm_continuous: "Sürekli altyazı", ds_continuous: "Her altyazıyı bir sonrakine kadar uzatır, kısa boşlukları doldurur",
    lbl_maxgap: "Doldurulacak maks. boşluk", hint_gap: "Bundan uzun boşluklar ayrı kalır.",
    sil_intro: "In/Out sesini analiz eder. Mark marker koyar; Cut sessiz boşlukları keser ve klipleri sola çeker. Önce In/Out koy.",
    btn_mark: "Sessizlikleri Bul & İşaretle", btn_cut: "Sessizlikleri Kes (ripple)",
    hint_cut: "Kesme deneysel — basit tek-kamera timeline'larda en iyi. Ctrl/Cmd+Z ile geri al.",
    sec_detect: "Tespit Ayarları",
    lbl_silthr: "Sessizlik eşiği", lbl_sildur: "Min. sessizlik süresi", lbl_silpad: "Kesim payı (konuşma etrafı)",
    hint_sil: "Düşük dB = sadece derin sessizlikler. Süreyi artırınca kısa duraklamalar atlanır. Pay, keserken nefes bırakır.",
    sil_status: "In/Out seçimindeki sessizlikleri tespit et",
    sec_syscheck: "Sistem Kontrolü", sec_models: "Whisper Modelleri", sec_install: "Kurulum Notları",
    btn_recheck: "Yeniden Tara", btn_reload: "Eklentiyi Yenile",
    tip_tab_transcribe: "Videodan otomatik altyazı oluştur ve düzenle",
    tip_tab_silence: "Sessiz boşlukları bul, işaretle veya kes",
    tip_tab_setup: "Sistem kontrolü — Python, ffmpeg ve Whisper kurulu mu?",
    tip_sub_tx_work: "Yazıya dökme ve segment düzenleme ekranı",
    tip_sub_tx_settings: "Motor, otomatik biçimleme, stil, karaoke ve temizlik ayarları",
    tip_sub_sl_work: "Sessizlikleri tespit et, işaretle veya ripple-delete ile kes",
    tip_sub_sl_settings: "Eşik (dB), minimum süre ve kesim payı ayarları",
    tip_model: "Whisper modeli: turbo = hızlı ve doğru (önerilen), large = en doğru ama yavaş, small/base = hızlı ama daha az isabetli",
    tip_lang: "Konuşmanın dili. 'Otomatik algıla' dili bulur — ama biliyorsan seçmek daha doğru sonuç verir",
    tip_transcribe: "Timeline'da I (giriş) ve O (çıkış) ile işaretlenen aralığın sesini yazıya döker",
    tip_loadsrt: "Hazır bir .srt altyazı dosyasını yükle ve buradan düzenle",
    tip_play: "Premiere'de oynat / duraklat. Bir segmente tıklayınca da o ana gider ve oynar",
    tip_enhance: "In/Out sesini temizler: gürültü azaltır + seviyeyi dengeler (−16 LUFS). Temiz WAV'ı projeye ekler",
    tip_case: "Büyük/küçük harf duyarlı arama",
    tip_findprev: "Önceki eşleşmeye git (Shift+Enter)", tip_findnext: "Sonraki eşleşmeye git (Enter)",
    tip_replaceinput: "Bulunan kelimenin yerine yazılacak metin. Boş bırakırsan kelimeyi siler",
    tip_replaceall: "Bulunan tüm eşleşmeleri değiştir",
    tip_segcount: "Toplam segment (altyazı satırı) sayısı",
    tip_find: "Metin içinde ara ve değiştir", tip_punct: "Noktalama ve büyük harfleri otomatik düzelt",
    tip_clean: "Temizlik menüsü: sözlük, dolgu kelimeler, küfür filtresi",
    tip_clean_dict: "Ayarlardaki yanlış=doğru kurallarını uygula",
    tip_clean_filler: "Dolgu kelimeleri sil (ee, ıı, şey, um, uh…)",
    tip_clean_prof: "Küfürleri sansürle (yıldız veya kaldır)",
    tip_clean_all: "Sözlük + dolgu + küfür temizliğini birden uygula",
    tip_export: "Altyazıyı dosyaya aktar",
    tip_export_srt: "En yaygın altyazı formatı. CapCut, YouTube, Premiere hepsi açar",
    tip_export_vtt: "Web / HTML5 video altyazı formatı",
    tip_export_ass: "Stilli / karaoke altyazı. Renk, font, kutu, kelime vurgusu taşır",
    tip_export_txt: "Zaman damgasız düz metin (transkript)",
    tip_clear: "Tüm segmentleri sil ve baştan başla",
    tip_send: "Altyazıyı Premiere zaman çizelgesine caption track olarak gönder",
    tip_engine: "Hangi yapay zekâ motoru yazıya döksün. WhisperX = kelime kelime zaman + konuşmacı (karaoke için gerekli). mlx = Apple Silicon'da en hızlı. openai = en uyumlu.",
    tip_diar: "Kim konuşuyor diye etiketler (Konuşmacı 1, 2…). Sadece WhisperX. Ücretsiz HuggingFace token gerektirir.",
    tip_autopunct: "Transkripsiyon biter bitmez noktalama ve büyük harfleri otomatik düzeltir",
    tip_autocleanup: "Transkripsiyon bitince sözlük kurallarını uygular ve dolgu kelimeleri otomatik siler",
    tip_filler: "Yerleşik dolgu kelime listesini kullan (ee, ıı, şey, yani, um, uh…)",
    tip_profmode: "Küfür nasıl gizlensin: ilk harf + yıldız (s***) ya da tamamen kaldır (—)",
    tip_denoise: "Arka plan gürültüsünü/uğultusunu azaltır (high-pass + FFT denoise)",
    tip_normalize: "Ses seviyesini −16 LUFS'a dengeler — tutarlı, sosyal medya/yayına hazır",
    tip_autoformat: "Uzun/hızlı altyazıları yayın standartlarına göre otomatik böler (aşağıdaki limitlere göre)",
    tip_cpl: "Bir satırda en fazla kaç karakter. Standart: 37–42. Daha fazlası okunmayı zorlaştırır",
    tip_lines2: "Bir altyazıda en fazla kaç satır. Standart: 2",
    tip_cps: "Saniyede en fazla karakter (okuma hızı). Bunu aşan bölünür. Standart: 15–17",
    tip_maxdur: "Tek altyazı en fazla kaç saniye ekranda kalsın. Aşanlar kelime sınırından bölünür",
    tip_stylepreview: "Seçili stilin canlı önizlemesi (.ass dışa aktarımda kullanılır)",
    tip_stylechips: "Hazır altyazı stilleri. 'Custom' ile kendi rengini/fontunu ayarla",
    tip_hicolor: "Söylenen kelimenin vurgu rengi (henüz söylenmeyenler beyaz kalır)",
    tip_karaoke: "Instagram/TikTok tarzı: her kelime söylendikçe renk değiştirir. .ass olarak çıkar. Kelime zamanı gerekir (WhisperX/Whisper)",
    tip_continuous: "Her altyazıyı bir sonraki başlayana kadar uzatır — kısa boşluklarda titremez",
    tip_maxgap: "Bu süreden uzun boşluklar doldurulmaz — altyazılar ayrı kalır",
    tip_mark: "Sessiz boşlukları bulup turuncu marker koyar — hiçbir şeyi silmez, sadece işaretler",
    tip_cut: "Sessiz boşlukları ripple-delete ile keser, klipleri sola çeker. Deneysel — Ctrl/Cmd+Z ile geri al",
    tip_silthr: "Hangi seviyenin altı 'sessizlik' sayılsın. Düşük (örn. −45) sadece derin sessizlikleri; yüksek (örn. −20) hafif duraklamaları da sayar",
    tip_sildur: "En az kaç saniyelik sessizlik sayılsın. Yüksek tutarsan kısa nefes/duraklamalar atlanır",
    tip_silpad: "Keserken konuşmanın başında/sonunda bırakılan küçük pay — kelime başı/sonu kesilmesin diye",
    tip_maxgap2: "Bu süreden uzun boşluklar doldurulmaz. Kısa boşluklar birleştirilir",
    tip_recheck: "Sistemi yeniden tara — eksik bir şey kurduktan sonra buna bas",
    tip_reload: "Paneli yeniden yükle — kod güncellemelerini devreye alır (Premiere'i kapatmadan)",
    tip_uilang: "Arayüz ve tooltip dili",
    tip_seek: "Bu ana git ve oynat", tip_edit: "Metni düzenle (çift tıklama da olur)",
    tip_split: "Bu segmenti ortadan ikiye böl", tip_del: "Bu segmenti sil",
    sec_send: "Premiere'e Gönderme", nm_sendmode: "Altyazıyı şu şekilde gönder",
    ds_sendmode: "Caption track = basit, hızlı. Stilli grafik = senin stilinle düzenlenebilir metin klipleri (AutoCut/FireCut gibi).",
    opt_caption: "Caption track (SRT)", opt_graphics: "Stilli grafik (MOGRT)",
    lbl_mogrt: "Stil şablonu (.mogrt)", btn_pickmogrt: ".mogrt seç…",
    mogrt_none: "Şablon seçilmedi", act_send_gfx: "Grafik Olarak Gönder",
    hint_mogrt: "Premiere'den bir kez stilli metin şablonu çıkar: Graphics çalışma alanı → bir metin katmanı yap → Export Motion Graphics Template. Sonra buradan seç.",
    tip_sendmode: "Altyazılar Premiere'e nasıl gelsin: düz caption track mi, yoksa MOGRT ile düzenlenebilir stilli metin grafiği mi",
    tip_pickmogrt: "Altyazıların kullanacağı stildeki .mogrt şablonunu seç",
    err_nomogrt_what: "Hiç .mogrt şablonu seçilmedi.",
    err_nomogrt_why: "Stilli grafik modu her altyazıyı bir Motion Graphics Template ile yerleştirir — önce bir tane seçmen gerekir.",
    err_nomogrt_fix: "Premiere'den stilli bir metin şablonu çıkar (Graphics → metin katmanı → Export Motion Graphics Template), sonra Ayarlar'dan seç.",
    tab_edit: "Düzen", tab_audio: "Ses", sub_actions: "İşlemler",
    tip_tab_edit: "Otomatik kurgu — sessizlik/dolgu kes, duraklama kısalt, oto-zoom",
    tip_tab_audio: "Ses araçları — temizle, dengele, küfür bip'le",
    tip_sub_ed_work: "Kurgu araçlarını çalıştır", tip_sub_au_work: "Ses araçlarını çalıştır",
    ed_intro: "In/Out seçimi için otomatik kurgu. Önce timeline'da In/Out noktalarını koy.",
    au_intro: "In/Out seçimi için ses araçları. Önce timeline'da In/Out noktalarını koy.",
    sec_silence: "Sessizlik", sec_enhance: "İyileştir",
    sec_zoom: "Oto Zoom", nm_zoom: "Oto Zoom",
    ds_zoom: "Seçimdeki her klibe hafif bir hareket (yavaş zoom) ekler, video enerjik görünür — AutoCut/FireCut gibi.",
    btn_zoom: "Oto Zoom Uygula", lbl_zoomamt: "Zoom miktarı", lbl_zoomstyle: "Zoom stili",
    opt_zoom_alt: "Dönüşümlü (içeri/dışarı)", opt_zoom_in: "Hep içeri", opt_zoom_subtle: "Hafif (nazik)",
    hint_zoom: "In/Out aralığındaki kliplere Motion → Scale keyframe'i ekler. Deneysel — Ctrl/Cmd+Z ile geri al.",
    tip_zoom: "In/Out aralığındaki her klibe yavaş zoom (Motion keyframe) ekler — dinamik, profesyonel his",
    tip_zoomamt: "Her klip boyunca ne kadar zoom yapsın (örn. %8 = 100%→108%)",
    tip_zoomstyle: "Dönüşümlü = klipler içeri sonra dışarı; Hep içeri = her klip içeri zoom",
  },
};

function t(key) {
    const lang = settings.uiLang === "tr" ? "tr" : "en";
    return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
}

// Apply the active language to all [data-i18n], [data-i18n-tip], [data-i18n-ph] elements
function applyLanguage() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const v = t(el.getAttribute("data-i18n"));
        if (v) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-tip]").forEach(el => {
        el.setAttribute("data-tip", t(el.getAttribute("data-i18n-tip")));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(el => {
        el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    document.documentElement.lang = settings.uiLang === "tr" ? "tr" : "en";
}

function setLanguage(lang) {
    settings.uiLang = (lang === "tr") ? "tr" : "en";
    saveSettings();
    applyLanguage();
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
    // refresh play button label in the active language
    const pp = $("playpause-btn");
    if (pp) pp.innerHTML = (typeof _isPlaying !== "undefined" && _isPlaying)
        ? icon("pause") + "<span>" + t("btn_pause") + "</span>"
        : icon("play")  + "<span>" + t("btn_play")  + "</span>";
    const langSel = $("set-uilang"); if (langSel) langSel.value = settings.uiLang;
    const langSelH = $("header-lang"); if (langSelH) langSelH.value = settings.uiLang;
}

// ── Icon system (clean line icons, no emoji) ───────────────────────────────
// Lucide-style stroke icons. Use inline via icon("name") or declaratively with
// <span class="ic" data-icon="name"></span> + applyIcons().
const ICONS = {
    captions:  '<rect x="3" y="5" width="18" height="14" rx="3"/><line x1="7" y1="11" x2="13" y2="11"/><line x1="7" y1="15" x2="16" y2="15"/>',
    scissors:  '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
    volume:    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mic:       '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    folder:    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    play:      '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause:     '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    search:    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    pilcrow:   '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
    sparkles:  '<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 13l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    send:      '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    zap:       '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    bookmark:  '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    trash:     '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pencil:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    close:     '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    wand:      '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>',
    refresh:   '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    reload:    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    check:     '<polyline points="20 6 9 17 4 12"/>',
    alert:     '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    globe:     '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    sliders:   '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
};

function icon(name) {
    const p = ICONS[name]; if (!p) return "";
    return `<svg class="svg-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

function applyIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(el => {
        const name = el.getAttribute("data-icon");
        if (name && ICONS[name]) el.innerHTML = icon(name);
    });
}

// ── DOM helpers ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const statusBar      = $("status-bar");
const progressBar    = $("progress-bar");
const segmentsWrap   = $("segments-wrap");
const actionsBar     = $("actions-bar");
const segCountEl     = $("seg-count");
const transcribeBtn  = $("transcribe-btn");
const sendBtn        = $("send-btn");
const toastEl        = $("toast");
const setupIndicator = $("setup-indicator");
const setupBadge     = $("setup-badge");

// ── Python discovery (cross-platform, cached) ─────────────────────────────
const IS_WIN = (typeof process !== "undefined" && process.platform === "win32");
let _pythonCache = null;

// Verify a command actually runs (so we never return a python that ENOENTs)
function _pyWorks(cmd) {
    try {
        const { execFileSync } = _req("child_process");
        execFileSync(cmd, ["--version"], { stdio: "ignore", timeout: 6000, env: spawnEnv() });
        return true;
    } catch (e) { return false; }
}

function findPython() {
    if (_pythonCache) return _pythonCache;

    if (IS_WIN) {
        // 1) The `py` launcher (installed to System32 by python.org → always on PATH),
        //    then `python` / `python3` if on PATH. Probe each so we pick one that runs.
        for (const cmd of ["py", "python", "python3"]) {
            if (_pyWorks(cmd)) { _pythonCache = cmd; return cmd; }
        }
        // 2) Common install locations (per-user + system, 3.10–3.13)
        const la = process.env.LOCALAPPDATA || "";
        const pf = process.env.PROGRAMFILES || "C:/Program Files";
        const guesses = [];
        ["313","312","311","310"].forEach(v => {
            if (la) guesses.push(`${la}/Programs/Python/Python${v}/python.exe`);
            guesses.push(`${pf}/Python${v}/python.exe`);
            guesses.push(`C:/Python${v}/python.exe`);
        });
        for (const g of guesses) {
            try { if (fs.existsSync(g)) { _pythonCache = g; return g; } } catch (e) {}
        }
        _pythonCache = "py";
        return _pythonCache;
    }

    // macOS / Linux
    const candidates = [
        "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
        "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",
        "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
    ];
    for (const p of candidates) {
        try { if (fs.existsSync(p)) { _pythonCache = p; return p; } } catch (e) {}
    }
    _pythonCache = "python3";
    return _pythonCache;
}

function extDir()     { return csInterface.getSystemPath(SystemPath.EXTENSION); }
function scriptsDir() { return path.join(extDir(), "scripts"); }

// ── Run Python script ─────────────────────────────────────────────────────
function spawnEnv() {
    const extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";
    const cur   = process.env.PATH || "";
    return Object.assign({}, process.env, {
        PATH: cur.includes("/opt/homebrew") ? cur : extra + ":" + cur
    });
}

function runPython(scriptName, args, onStderr) {
    return new Promise(resolve => {
        const py     = findPython();
        const script = path.join(scriptsDir(), scriptName);
        const proc   = spawn(py, [script, ...args], { env: spawnEnv() });
        const STDERR_CAP = 8000;
        let stdout = "", stderr = "";
        proc.stdout.on("data", d => { stdout += d.toString(); });
        proc.stderr.on("data", d => {
            const chunk = d.toString();
            if (onStderr) onStderr(chunk);
            stderr += chunk;
            if (stderr.length > STDERR_CAP) stderr = stderr.slice(-STDERR_CAP);
        });
        proc.on("close", code => {
            try   { resolve(JSON.parse(stdout.trim())); }
            catch { resolve({ success: false, error: stderr.trim() || `Script exited with code ${code}` }); }
        });
        proc.on("error", err =>
            resolve({ success: false, error: `Could not start Python: ${err.message}\nMake sure Python 3 is installed (python.org).` })
        );
    });
}

function runCmd(cmd, args) {
    return new Promise(resolve => {
        const proc = spawn(cmd, args);
        let out = "", err = "";
        proc.stdout.on("data", d => { out += d.toString(); });
        proc.stderr.on("data", d => { err += d.toString(); });
        proc.on("close", code => resolve({ code, out, err }));
        proc.on("error", e    => resolve({ code: 1, out: "", err: e.message }));
    });
}

// ── ExtendScript ──────────────────────────────────────────────────────────
function loadHostJSX() {
    return new Promise(resolve => {
        const jsxPath = path.join(extDir(), "jsx", "host.jsx").replace(/\\/g, "/");
        csInterface.evalScript(`$.evalFile("${jsxPath}")`, () => resolve());
    });
}

function evalScript(script) {
    return new Promise(resolve => {
        csInterface.evalScript(script, result => {
            try   { resolve(JSON.parse(result)); }
            catch { resolve({ success: false, error: "ExtendScript error: " + result }); }
        });
    });
}

// ── UI helpers ────────────────────────────────────────────────────────────
function setStatus(msg, type = "info") {
    statusBar.textContent = msg;
    statusBar.className   = `status-bar ${type}`;
}

function showProgress(on) {
    progressBar.className = on ? "progress-bar run" : "progress-bar";
}

function setSilenceStatus(msg, type = "info") {
    const el = $("silence-status-bar");
    if (!el) return;
    el.textContent = msg;
    el.className   = `status-bar ${type}`;
}

function showSilenceProgress(on) {
    const el = $("silence-progress-bar");
    if (!el) return;
    el.className = on ? "progress-bar run" : "progress-bar";
}

// Edit tab shares the silence status bar (both live in panel-ed-work)
function setEditStatus(msg, type)   { setSilenceStatus(msg, type); }
function showEditProgress(on)        { showSilenceProgress(on); }

// Audio tab status
function setAudioStatus(msg, type = "info") {
    const el = $("audio-status-bar");
    if (!el) return;
    el.textContent = msg;
    el.className   = `status-bar ${type}`;
}
function showAudioProgress(on) {
    const el = $("audio-progress-bar");
    if (!el) return;
    el.className = on ? "progress-bar run" : "progress-bar";
}

function showToast(msg, type = "info", ms = 3500) {
    toastEl.textContent = msg;
    toastEl.className   = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, ms);
}

function copyText(txt) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(() => showToast("Copied!", "success", 1500));
    }
}

// ── Two-level navigation ──────────────────────────────────────────────────
// Main tabs with work/settings sub-tabs (prefixes), plus the prefix-less Setup.
const MAIN_TABS = ["transcribe", "edit", "audio", "setup"];
const TAB_PREFIX = { transcribe: "tx", edit: "ed", audio: "au" };

let currentMainTab = "transcribe";
let currentSubTab  = { transcribe: "work", edit: "work", audio: "work" };

const ALL_PANELS = ["tx-work", "tx-settings", "ed-work", "ed-settings", "au-work", "au-settings", "setup"];

function showCurrentPanel() {
    ALL_PANELS.forEach(p => { const el = $(`panel-${p}`); if (el) el.style.display = "none"; });
    let target;
    if (currentMainTab === "setup") target = "panel-setup";
    else {
        const prefix = TAB_PREFIX[currentMainTab];
        const sub = currentSubTab[currentMainTab] === "settings" ? "settings" : "work";
        target = `panel-${prefix}-${sub}`;
    }
    const el = $(target); if (el) el.style.display = "flex";
}

function switchMainTab(name) {
    currentMainTab = name;
    MAIN_TABS.forEach(t => { const tab = $(`tab-${t}`); if (tab) tab.classList.toggle("active", t === name); });
    ["transcribe", "edit", "audio"].forEach(t => {
        const bar = $(`sub-tabs-${t}`);
        if (bar) bar.style.display = name === t ? "flex" : "none";
    });
    showCurrentPanel();
    if (name === "setup") runDiagnostics();
    if (name === "edit"  && currentSubTab.edit  === "settings") initEditSettingsUI();
    if (name === "audio" && currentSubTab.audio === "settings") initAudioSettingsUI();
    if (name === "transcribe" && currentSubTab.transcribe === "settings") initSettingsUI();
}

function switchSubTab(mainTab, sub) {
    currentSubTab[mainTab] = sub;
    const prefix = TAB_PREFIX[mainTab];
    ["work", "settings"].forEach(s => {
        const btn = $(`sub-tab-${prefix}-${s}`);
        if (btn) btn.classList.toggle("active", s === sub);
    });
    showCurrentPanel();
    if (sub === "settings") {
        if (mainTab === "transcribe") initSettingsUI();
        if (mainTab === "edit")       initEditSettingsUI();
        if (mainTab === "audio")      initAudioSettingsUI();
    }
}

// Keep compatibility for error handlers that call switchTab("setup")
function switchTab(name) { switchMainTab(name); }

// ── Edit (cut automation) settings init ───────────────────────────────────
function initEditSettingsUI() {
    const set = (id, v) => { const e = $(id); if (e) e.value = v; };
    const txt = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set("set-silthr", settings.silenceThreshold);
    txt("silthr-val", settings.silenceThreshold + " dB");
    set("set-sildur", settings.silenceMinDur);
    txt("sildur-val", settings.silenceMinDur.toFixed(1) + "s");
    set("set-silpad", settings.silencePad);
    txt("silpad-val", (+settings.silencePad).toFixed(2) + "s");
    set("set-zoomamt", settings.zoomAmount);
    txt("zoomamt-val", settings.zoomAmount + "%");
    set("set-zoomstyle", settings.zoomStyle);
}

// ── Audio settings init ───────────────────────────────────────────────────
function initAudioSettingsUI() {
    const chk = (id, v) => { const e = $(id); if (e) e.checked = !!v; };
    chk("set-audio-denoise", settings.audioDenoise);
    chk("set-audio-normalize", settings.audioNormalize);
}

// ── Settings tab ──────────────────────────────────────────────────────────
function initSettingsUI() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };

    set("set-uilang", settings.uiLang);
    set("set-engine", settings.engine);
    chk("set-diarize", settings.diarize);
    chk("set-autopunct", settings.autoPunctuate);

    // Transcript clean-up
    set("set-dict", settings.customDict);
    chk("set-autocleanup", settings.autoCleanup);
    chk("set-filleron", settings.fillerOn);
    set("set-fillers", settings.fillerWords);
    set("set-profanity", settings.profanityList);
    set("set-profmode", settings.profanityMode);

    // Send to Premiere
    set("set-sendmode", settings.sendMode);
    const gsub = $("graphics-sub"); if (gsub) gsub.style.display = settings.sendMode === "graphics" ? "block" : "none";
    updateMogrtLabel();

    chk("set-karaoke", settings.karaoke);
    const kHi = $("set-karaoke-hi"); if (kHi) kHi.value = "#" + (settings.karaokeHi || "FFE000");
    const kSub = $("karaoke-sub"); if (kSub) kSub.style.display = settings.karaoke ? "block" : "none";

    chk("set-autosplit", settings.autoSplit);
    const autoSub = $("autosplit-sub"); if (autoSub) autoSub.style.display = settings.autoSplit ? "block" : "none";
    set("set-cpl",   settings.maxCharsPerLine); txt("cpl-val",   settings.maxCharsPerLine);
    set("set-lines", settings.maxLines);        txt("lines-val", settings.maxLines);
    set("set-cps",   settings.maxCps);          txt("cps-val",   settings.maxCps);
    set("set-maxdur", settings.maxDur);         txt("maxdur-val", (+settings.maxDur).toFixed(1) + "s");

    chk("set-gap-fill", settings.gapFill);
    const gapSub = $("gap-fill-sub");
    if (gapSub) gapSub.style.display = settings.gapFill ? "block" : "none";
    set("set-gap-max", settings.gapMax);        txt("gap-fill-val", (+settings.gapMax).toFixed(1) + "s");

    renderStyleChips();
    updateStylePreview();
    if (settings.karaoke) startKaraokePreview(); else stopKaraokePreview();
}

// ── Style presets ─────────────────────────────────────────────────────────
function renderStyleChips() {
    const wrap = $("style-chips");
    if (!wrap) return;
    wrap.innerHTML = "";
    Object.keys(STYLE_PRESETS).forEach(key => {
        const p = STYLE_PRESETS[key];
        const chip = document.createElement("button");
        chip.className = "style-chip" + (settings.stylePreset === key ? " active" : "");
        chip.textContent = p.label;
        chip.onclick = () => {
            settings.stylePreset = key;
            saveSettings();
            renderStyleChips();
            updateStylePreview();
        };
        wrap.appendChild(chip);
    });
    const form = $("custom-style-form");
    if (form) {
        form.style.display = settings.stylePreset === "custom" ? "block" : "none";
        if (settings.stylePreset === "custom") populateCustomForm();
    }
}

function populateCustomForm() {
    const cs = { ...DEFAULT_CUSTOM_STYLE, ...(settings.customStyle || {}) };
    const el = (id, v) => { const e = $(id); if (e) e.value = v; };
    el("cust-primary", "#" + cs.primary);
    el("cust-outline", "#" + cs.outline);
    el("cust-size", cs.size);
    el("cust-ow", cs.outlineW);
    el("cust-align", cs.align);
    const txt = id => $(id);
    if (txt("cust-size-val"))  txt("cust-size-val").textContent  = cs.size;
    if (txt("cust-ow-val"))    txt("cust-ow-val").textContent    = cs.outlineW;
    const boldEl = $("cust-bold");  if (boldEl)  boldEl.checked  = cs.bold;
    const boxEl  = $("cust-box");   if (boxEl)   boxEl.checked   = cs.box;
}

function updateCustomStyle(key, value) {
    if (!settings.customStyle) settings.customStyle = { ...DEFAULT_CUSTOM_STYLE };
    settings.customStyle[key] = value;
    saveSettings();
    updateStylePreview();
}

function updateStylePreview() {
    const box = $("style-preview");
    const txt = $("style-preview-text");
    if (!box || !txt) return;
    const p = getActivePreset();

    box.style.alignItems = p.align === 8 ? "flex-start" : (p.align === 5 ? "center" : "flex-end");
    txt.style.fontFamily = p.font + ", sans-serif";
    txt.style.fontWeight = p.bold ? "800" : "500";
    txt.style.color      = "#" + p.primary;
    txt.style.fontSize   = Math.round(p.size / 3) + "px";

    const oc = "#" + p.outline;
    const w  = Math.max(1, Math.round(p.outlineW / 2));
    if (p.outlineW > 0) {
        txt.style.textShadow =
            `-${w}px -${w}px 0 ${oc}, ${w}px -${w}px 0 ${oc}, -${w}px ${w}px 0 ${oc}, ${w}px ${w}px 0 ${oc}` +
            (p.shadow ? `, 2px 2px 3px rgba(0,0,0,.7)` : "");
    } else {
        txt.style.textShadow = p.shadow ? "2px 2px 3px rgba(0,0,0,.7)" : "none";
    }

    if (p.box) {
        const opacity = (1 - p.boxAlpha / 255).toFixed(2);
        txt.style.background  = `rgba(0,0,0,${opacity})`;
        txt.style.padding     = "2px 7px";
        txt.style.borderRadius = "3px";
    } else {
        txt.style.background = "transparent";
        txt.style.padding    = "0";
    }
}

// ── Karaoke (Instagram/TikTok style word highlight) ───────────────────────
let _karaokeTimer = null;
function onKaraokeToggle(checked) {
    settings.karaoke = checked;
    saveSettings();
    const sub = $("karaoke-sub");
    if (sub) sub.style.display = checked ? "block" : "none";
    if (checked) startKaraokePreview(); else stopKaraokePreview();
}
function onKaraokeColor(hex) {
    settings.karaokeHi = hex.slice(1).toUpperCase();
    saveSettings();
    startKaraokePreview();
}
function stopKaraokePreview() {
    if (_karaokeTimer) { clearInterval(_karaokeTimer); _karaokeTimer = null; }
}
function startKaraokePreview() {
    const box = $("karaoke-preview");
    if (!box) return;
    stopKaraokePreview();
    const words = ["Kelime", "kelime", "vurgulu", "altyazı", "akışı"];
    box.innerHTML = words.map(w => `<span class="kw">${w}</span>`).join(" ");
    const hi = "#" + (settings.karaokeHi || "FFE000");
    const spans = box.querySelectorAll(".kw");
    let i = 0;
    const tick = () => {
        spans.forEach((s, si) => { s.style.color = si <= i ? hi : "#fff"; });
        i = (i + 1) % (words.length + 2);   // +2 = brief all-on pause before looping
    };
    tick();
    _karaokeTimer = setInterval(tick, 380);
}

function onGapFillChange() {
    settings.gapFill = $("set-gap-fill").checked;
    const sub = $("gap-fill-sub");
    if (sub) sub.style.display = settings.gapFill ? "block" : "none";
    saveSettings();
}

function onGapMaxChange(val) {
    settings.gapMax = parseFloat(val);
    const el = $("gap-fill-val"); if (el) el.textContent = settings.gapMax.toFixed(1) + "s";
    saveSettings();
}

function applyGapFill(segs, maxGap) {
    if (!segs || segs.length < 2) return segs;
    const result = segs.map(s => ({ ...s }));
    for (let i = 0; i < result.length - 1; i++) {
        const gap = result[i + 1].seqStart - result[i].seqEnd;
        if (gap > 0 && gap <= maxGap) {
            result[i].seqEnd = result[i + 1].seqStart;
            result[i].end    = result[i].start + (result[i].seqEnd - result[i].seqStart);
        }
    }
    return result;
}

// ── Smart subtitle splitting ──────────────────────────────────────────────
function applySmartSplit(segs, opt) {
    const maxChars = Math.max(10, opt.maxCharsPerLine * opt.maxLines);
    const out = [];
    for (const seg of segs) {
        const pieces = splitSegment(seg, opt, maxChars);
        for (const p of pieces) out.push(p);
    }
    out.forEach((s, i) => { s.id = i; });
    return out;
}

function splitSegment(seg, opt, maxChars) {
    const text = (seg.text || "").trim();
    const dur  = Math.max(0.001, seg.end - seg.start);
    const cps  = text.length / dur;
    const needs = dur > opt.maxDur || text.length > maxChars || cps > opt.maxCps;
    if (!needs || text.length <= 1) return [seg];

    const words = (seg.words && seg.words.length) ? seg.words : null;
    return words ? splitByWords(seg, words, opt, maxChars)
                 : splitByText(seg, text, opt, maxChars);
}

function splitByWords(seg, words, opt, maxChars) {
    // Guard: skip word objects without valid start/end timestamps
    const valid = words.filter(w => w != null && w.start != null && w.end != null);
    if (!valid.length) return splitByText(seg, (seg.text || "").trim(), opt, maxChars);

    const chunks = [];
    let cur = [];
    for (const w of valid) {
        const tentative = cur.concat([w]);
        const txt   = tentative.map(x => x.word || "").join(" ").trim();
        const start = tentative[0].start;
        const dur   = w.end - start;
        if (cur.length > 0 && (txt.length > maxChars || dur > opt.maxDur)) {
            chunks.push(cur);
            cur = [w];
        } else {
            cur.push(w);
        }
    }
    if (cur.length) chunks.push(cur);
    if (!chunks.length) return [seg];

    return chunks.map(ws => ({
        id:      seg.id,
        start:   ws[0].start,
        end:     ws[ws.length - 1].end,
        text:    ws.map(x => x.word || "").join(" ").replace(/\s+/g, " ").trim(),
        words:   ws,
        speaker: seg.speaker || null,
    }));
}

function splitByText(seg, text, opt, maxChars) {
    const byChars = Math.ceil(text.length / maxChars);
    const byDur   = Math.ceil((seg.end - seg.start) / opt.maxDur);
    const n       = Math.max(2, byChars, byDur);

    const words = text.split(/\s+/);
    const per   = Math.ceil(words.length / n);
    const groups = [];
    for (let i = 0; i < words.length; i += per) groups.push(words.slice(i, i + per));

    const total = seg.end - seg.start;
    const totalChars = text.length || 1;
    let cursor = seg.start;
    return groups.map(g => {
        const t = g.join(" ");
        const frac = t.length / totalChars;
        const start = cursor;
        const end = Math.min(seg.end, start + total * frac);
        cursor = end;
        return { id: seg.id, start, end, text: t, words: [], speaker: seg.speaker || null };
    });
}

// ── Silence detection ─────────────────────────────────────────────────────
async function detectSilences() {
    const btn = $("silence-btn");
    if (btn) { btn.disabled = true; }
    setSilenceStatus("Reading timeline…", "info");
    showSilenceProgress(true);

    try {
        const seqInfo = await evalScript("getSequenceInfo()");
        if (!seqInfo.success) {
            setSilenceStatus(seqInfo.error || "Error reading timeline", "error");
            showToast(seqInfo.error || "Error reading timeline", "error");
            return;
        }
        if (!seqInfo.clips || seqInfo.clips.length === 0) {
            setSilenceStatus("No clips in In/Out range. Set In/Out over a clip first.", "warning");
            return;
        }

        setSilenceStatus(`Analyzing ${seqInfo.duration.toFixed(1)}s for silences…`, "info");
        const tmpAudio = path.join(os.tmpdir(), `silence_${Date.now()}.wav`);
        const clipsArg = JSON.stringify({ clips: seqInfo.clips, duration: seqInfo.duration });

        const ex = await runPython("extract_audio.py", [clipsArg, tmpAudio]);
        if (!ex.success) {
            setSilenceStatus(ex.error || "Audio extraction failed.", "error");
            showToast("Audio extraction failed", "error");
            return;
        }

        const res = await runPython("detect_silence.py",
            [tmpAudio, String(settings.silenceThreshold), String(settings.silenceMinDur)]);

        try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); } catch {}

        if (!res.success) {
            setSilenceStatus(res.error || "Silence detection failed.", "error");
            showToast("Silence detection failed", "error");
            return;
        }

        const silences = res.silences || [];
        if (silences.length === 0) {
            setSilenceStatus("No silences found. Try raising the threshold (e.g. -25 dB).", "warning");
            showToast("No silences found", "info");
            return;
        }

        const marks = silences.map(s => ({
            start: seqInfo.inTime + s.start,
            end:   seqInfo.inTime + s.end,
            dur:   s.dur,
        }));

        await evalScript("clearSilenceMarkers()");
        const addRes = await evalScript(`addSilenceMarkers('${JSON.stringify(marks).replace(/'/g, "\\'")}')`);

        if (addRes && addRes.success) {
            setSilenceStatus(`✓ Marked ${addRes.added} silence(s) on the timeline`, "success");
            showToast(`${addRes.added} silences marked on timeline`, "success");
        } else {
            const msg = (addRes && addRes.error) || "Could not add markers.";
            setSilenceStatus(msg, "error");
            showToast(msg, "error");
        }
    } catch (e) {
        setSilenceStatus(e.message, "error");
        showToast(e.message, "error", 5000);
    } finally {
        showSilenceProgress(false);
        if (btn) btn.disabled = false;
    }
}

// Shared: extract In/Out audio → return detected silence ranges in TIMELINE seconds
async function findSilenceRanges() {
    const seqInfo = await evalScript("getSequenceInfo()");
    if (!seqInfo.success) throw new Error(seqInfo.error || "Error reading timeline");
    if (!seqInfo.clips || seqInfo.clips.length === 0) throw new Error("No clips in In/Out range. Set In/Out over a clip first.");

    const tmpAudio = path.join(os.tmpdir(), `silence_${Date.now()}.wav`);
    const clipsArg = JSON.stringify({ clips: seqInfo.clips, duration: seqInfo.duration });
    const ex = await runPython("extract_audio.py", [clipsArg, tmpAudio]);
    if (!ex.success) throw new Error(ex.error || "Audio extraction failed.");

    const res = await runPython("detect_silence.py",
        [tmpAudio, String(settings.silenceThreshold), String(settings.silenceMinDur)]);
    try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); } catch {}
    if (!res.success) throw new Error(res.error || "Silence detection failed.");

    const ranges = (res.silences || []).map(s => ({
        start: seqInfo.inTime + s.start,
        end:   seqInfo.inTime + s.end,
        dur:   s.dur,
    }));
    return { seqInfo, ranges };
}

// ── Silence auto-cut (ripple delete) ──────────────────────────────────────
// Experimental: razors at each silent boundary and ripple-deletes the gap on
// every track. Undo with Cmd/Ctrl+Z if a complex timeline desyncs.
async function cutSilences() {
    const btn = $("silence-cut-btn");
    if (btn) btn.disabled = true;
    setSilenceStatus("Analyzing audio for silences to cut…", "info");
    showSilenceProgress(true);
    try {
        const { ranges } = await findSilenceRanges();
        if (ranges.length === 0) {
            setSilenceStatus("No silences found to cut. Try raising the threshold.", "warning");
            showToast("No silences found", "info");
            return;
        }

        // Keep a little breathing room around speech: shrink each cut by padding
        const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
        const cutRanges = ranges
            .map(r => ({ start: r.start + pad, end: r.end - pad }))
            .filter(r => r.end - r.start > 0.08);   // ignore tiny leftovers

        if (cutRanges.length === 0) {
            setSilenceStatus("Silences too short to cut after padding. Lower the padding in Settings.", "warning");
            return;
        }

        const total = cutRanges.reduce((a, r) => a + (r.end - r.start), 0);
        if (!confirm(`Ripple-delete ${cutRanges.length} silent gap(s)?\nThis removes ~${total.toFixed(1)}s and shifts clips left.\n(You can undo with Ctrl/Cmd+Z.)`)) {
            setSilenceStatus("Cut cancelled.", "info");
            return;
        }

        setSilenceStatus(`Cutting ${cutRanges.length} gap(s)…`, "info");
        await evalScript("clearSilenceMarkers()");   // remove old markers if any
        const arg = JSON.stringify(cutRanges).replace(/'/g, "\\'");
        const r = await evalScript(`rippleDeleteRanges('${arg}')`);

        if (r && r.success && r.removed > 0) {
            setSilenceStatus(`✓ Cut ${r.removed} item(s) across ~${total.toFixed(1)}s`, "success");
            showToast(`Silences cut (${r.removed} segments removed)`, "success");
        } else {
            // Fall back to markers so the user still gets value
            const marks = ranges.map(r2 => ({ start: r2.start, end: r2.end, dur: r2.dur }));
            await evalScript(`addSilenceMarkers('${JSON.stringify(marks).replace(/'/g, "\\'")}')`);
            const why = (r && r.error) ? (" — " + r.error) : "";
            setSilenceStatus("Couldn't ripple-cut on this timeline — marked instead" + why, "warning");
            showToast("Ripple-cut failed; added markers instead. Send me the diagnostic.", "warning", 6000);
            if (r && r.diag) console.log("[Whisper] ripple diag:", r.diag);
        }
    } catch (e) {
        setSilenceStatus(e.message, "error");
        showToast(e.message, "error", 5000);
    } finally {
        showSilenceProgress(false);
        if (btn) btn.disabled = false;
    }
}

// ── Audio enhancement (denoise + loudness normalize) ──────────────────────
async function enhanceAudio() {
    const btn = $("enhance-btn");
    if (btn) btn.disabled = true;
    setAudioStatus("Reading timeline for audio enhancement…", "info");
    showAudioProgress(true);
    try {
        const seqInfo = await evalScript("getSequenceInfo()");
        if (!seqInfo.success) { setAudioStatus(seqInfo.error || "Error reading timeline", "error"); return; }
        if (!seqInfo.clips || seqInfo.clips.length === 0) {
            setAudioStatus("No clips in the In/Out range. Set In/Out over a clip first.", "warning");
            return;
        }

        setAudioStatus(`Extracting ${seqInfo.duration.toFixed(1)}s of audio…`, "info");
        const tmpRaw = path.join(os.tmpdir(), `enh_raw_${Date.now()}.wav`);
        const clipsArg = JSON.stringify({ clips: seqInfo.clips, duration: seqInfo.duration });
        const ex = await runPython("extract_audio.py", [clipsArg, tmpRaw]);
        if (!ex.success) { setAudioStatus(ex.error || "Audio extraction failed.", "error"); return; }

        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const outWav = path.join(os.homedir(), "Desktop", `enhanced_audio_${stamp}.wav`);

        setAudioStatus("Enhancing audio (denoise + loudness normalize)…", "info");
        const enh = await runPython("enhance_audio.py",
            [tmpRaw, outWav, settings.audioDenoise ? "1" : "0", settings.audioNormalize ? "1" : "0"]);
        try { if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw); } catch {}

        if (!enh.success) { setAudioStatus(enh.error || "Audio enhancement failed.", "error"); return; }

        const imp = await evalScript(`importAudioToProject('${outWav.replace(/'/g, "\\'")}')`);
        if (imp && imp.success) {
            setAudioStatus(`✓ Enhanced audio imported to project bin "${imp.bin || "Whisper Audio"}"`, "success");
            showToast("Enhanced audio added to project — drag it onto a track", "success", 5000);
        } else {
            setAudioStatus(`✓ Enhanced audio saved → ${outWav}`, "success");
            showToast("Enhanced WAV saved to Desktop", "success");
            try { spawn("open", ["-R", outWav]); } catch (e) {}
        }
    } catch (e) {
        setAudioStatus(e.message, "error");
    } finally {
        showAudioProgress(false);
        if (btn) btn.disabled = false;
    }
}

// ── Auto Zoom (dynamic push-in) — Edit tab ────────────────────────────────
async function applyAutoZoom() {
    const btn = $("zoom-btn");
    if (btn) btn.disabled = true;
    setEditStatus("Applying Auto Zoom…", "info");
    showEditProgress(true);
    try {
        const opt = JSON.stringify({ amount: settings.zoomAmount, style: settings.zoomStyle });
        const r = await evalScript(`applyAutoZoom('${opt.replace(/'/g, "\\'")}')`);
        if (r && r.success && r.count > 0) {
            setEditStatus(`✓ Auto Zoom applied to ${r.count} clip(s)`, "success");
            showToast(`Auto Zoom added to ${r.count} clip(s)`, "success");
        } else {
            const err = (r && r.error) || "No clips to zoom in the In/Out range.";
            setEditStatus(err, (r && r.count === 0) ? "warning" : "error");
            if (r && r.diag && r.diag.length) {
                console.log("[Whisper] zoom diag:", r.diag);
                showToast("Auto Zoom note: " + r.diag[0] + " (send me this)", "warning", 7000);
            } else showToast(err, "warning");
        }
    } catch (e) {
        setEditStatus(e.message, "error");
    } finally {
        showEditProgress(false);
        if (btn) btn.disabled = false;
    }
}

// ── Punctuation restore ───────────────────────────────────────────────────
// opts.silent  → don't show the "not installed" error panel (used by auto mode)
// opts.auto    → called automatically right after transcription
async function fixPunctuation(opts) {
    opts = opts || {};
    if (segments.length === 0) {
        if (!opts.silent) showToast("Nothing to fix yet", "info", 2000);
        return;
    }
    const btn = $("punct-btn");
    if (btn) { btn.disabled = true; btn.classList.add("busy"); }
    setStatus(opts.auto ? "Auto-punctuating…" : "Restoring punctuation… (first run downloads the model)", "info");
    showProgress(true);

    let res;
    try {
        const payload = JSON.stringify({
            segments: segments.map(s => ({ text: s.text })),
            language: (lastLanguage || "auto"),
        });
        res = await runPython("punctuate.py", [payload]);
    } catch (e) {
        res = { success: false, error: e && e.message ? e.message : String(e) };
    }

    showProgress(false);
    if (btn) { btn.disabled = false; btn.classList.remove("busy"); }

    if (!res || !res.success || !Array.isArray(res.segments)) {
        const err = (res && res.error) || "Punctuation restore failed";
        if (err.includes("not installed") || err.includes("No module")) {
            setStatus("Punctuation model not installed", "warning");
            if (!opts.silent) {
                showError(
                    "Punctuation restore is not installed.",
                    "It uses the free offline 'deepmultilingualpunctuation' model.",
                    "Install it from the Setup tab, then try again.",
                    "Go to Setup", () => switchTab("setup")
                );
            } else {
                showToast("Auto-punctuate skipped — model not installed (Setup tab)", "info", 5000);
            }
        } else {
            if (!opts.silent) handleError(err);
            else showToast("Auto-punctuate failed: " + err.split("\n")[0], "warning", 5000);
        }
        return;
    }

    let changed = 0;
    res.segments.forEach((s, i) => {
        if (segments[i] && s && typeof s.text === "string" && s.text !== segments[i].text) {
            segments[i].text = s.text;
            changed++;
        }
    });
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
    setStatus(`Punctuation restored — ${changed} segment(s) updated`, "success");
    if (!opts.silent || changed > 0) showToast(`Punctuation fixed (${changed} updated)`, "success");
}

// ── Transcript clean-up (dictionary · fillers · profanity) ────────────────
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Tidy double spaces and stray spaces before punctuation after a removal
function tidyText(t) {
    return (t || "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/^[\s,]+/, "")
        .trim();
}

// Parse the custom dictionary textarea: "wrong=right" or "wrong => right" per line
function parseDictRules(str) {
    const rules = [];
    (str || "").split(/\r?\n/).forEach(line => {
        const m = line.split(/\s*=>?\s*/);   // splits on "=" or "=>"
        if (m.length >= 2) {
            const from = m[0].trim();
            const to   = m.slice(1).join("=").trim();
            if (from) rules.push({ from, to });
        }
    });
    return rules;
}

function applyDictionary(opts) {
    opts = opts || {};
    const rules = parseDictRules(settings.customDict);
    if (!rules.length) { if (!opts.silent) showToast("No dictionary rules yet (add them in Settings)", "info", 2500); return 0; }
    let count = 0;
    for (const seg of segments) {
        let t = seg.text || "";
        for (const r of rules) {
            const re = new RegExp("\\b" + escRe(r.from) + "\\b", "gi");
            t = t.replace(re, m => { count++; return r.to; });
        }
        seg.text = t;
    }
    if (!opts.silent) { renderSegments(); reselect(); showToast(`Dictionary applied — ${count} fix(es)`, "success"); }
    return count;
}

function getFillerList() {
    let list = settings.fillerOn ? BUILTIN_FILLERS.slice() : [];
    (settings.fillerWords || "").split(/[,\n]/).forEach(w => { w = w.trim(); if (w) list.push(w); });
    // longest first so phrases match before their sub-words
    return list.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.length - a.length);
}

function removeFillers(opts) {
    opts = opts || {};
    const list = getFillerList();
    if (!list.length) { if (!opts.silent) showToast("No filler words configured", "info", 2500); return 0; }
    const re = new RegExp("\\b(" + list.map(escRe).join("|") + ")\\b[\\s,]*", "gi");
    let count = 0;
    for (const seg of segments) {
        let t = (seg.text || "");
        t = t.replace(re, () => { count++; return ""; });
        seg.text = capFirst(tidyText(t));
    }
    if (!opts.silent) { renderSegments(); reselect(); showToast(`Removed ${count} filler word(s)`, "success"); }
    return count;
}

function censorProfanity(opts) {
    opts = opts || {};
    let list = BUILTIN_PROFANITY.slice();
    (settings.profanityList || "").split(/[,\n]/).forEach(w => { w = w.trim(); if (w) list.push(w); });
    list = list.filter((v, i, a) => a.indexOf(v) === i);
    if (!list.length) { if (!opts.silent) showToast("No profanity words configured", "info", 2500); return 0; }
    const re = new RegExp("\\b(" + list.map(escRe).join("|") + ")\\b", "gi");
    let count = 0;
    for (const seg of segments) {
        seg.text = (seg.text || "").replace(re, m => {
            count++;
            if (settings.profanityMode === "remove") return "—";
            // keep first letter, asterisk the rest
            return m[0] + "*".repeat(Math.max(1, m.length - 1));
        });
    }
    if (!opts.silent) { renderSegments(); reselect(); showToast(`Censored ${count} word(s)`, "success"); }
    return count;
}

function cleanAll() {
    $("clean-menu").style.display = "none";
    if (segments.length === 0) { showToast("Nothing to clean yet", "info", 2000); return; }
    const d = applyDictionary({ silent: true });
    const f = removeFillers({ silent: true });
    const p = censorProfanity({ silent: true });
    renderSegments(); reselect();
    setStatus(`Cleaned — ${d} dictionary · ${f} fillers · ${p} censored`, "success");
    showToast(`Clean-up done (${d}+${f}+${p})`, "success");
}

function reselect() { if (selectedIndex >= 0) selectSegment(selectedIndex); }
function capFirst(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

function toggleCleanMenu() {
    const m = $("clean-menu");
    m.style.display = (m.style.display === "none" || !m.style.display) ? "block" : "none";
}
function cleanMenuAction(which) {
    $("clean-menu").style.display = "none";
    if (segments.length === 0) { showToast("Nothing to clean yet", "info", 2000); return; }
    if (which === "dict")  applyDictionary();
    if (which === "filler") removeFillers();
    if (which === "prof")  censorProfanity();
    if (which === "all")   cleanAll();
}

// ── Find & Replace ────────────────────────────────────────────────────────
// Find works standalone (highlight + jump between matches). Replace is optional.
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

let activeFindRegex   = null;   // set while a find query is active → drives highlighting
let findMatchSegs     = [];     // segment indices that contain a match
let findPos           = -1;     // pointer into findMatchSegs

function buildFindRegex() {
    const input = $("find-input");
    const find = input ? input.value : "";
    if (!find) return null;
    const caseEl = $("find-case");
    const flags = "g" + (caseEl && caseEl.checked ? "" : "i");
    return new RegExp(escapeRegExp(find), flags);
}

function toggleFindReplace() {
    const p = $("find-panel");
    const show = p.style.display === "none" || !p.style.display;
    p.style.display = show ? "block" : "none";
    if (show) { $("find-input").focus(); $("find-input").select(); updateFindCount(); }
    else { clearFindHighlight(); }
}

function closeFindReplace() {
    $("find-panel").style.display = "none";
    clearFindHighlight();
}

function clearFindHighlight() {
    activeFindRegex = null;
    findMatchSegs = [];
    findPos = -1;
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
}

// Recompute match set + count as the user types
function updateFindCount() {
    const countEl = $("find-count");
    const re = buildFindRegex();
    activeFindRegex = re;
    findMatchSegs = [];
    findPos = -1;

    if (!re) {
        countEl.textContent = "—";
        countEl.classList.remove("zero");
        renderSegments();
        return;
    }
    let n = 0;
    segments.forEach((seg, idx) => {
        const m = (seg.text || "").match(re);
        if (m) { n += m.length; findMatchSegs.push(idx); }
    });
    countEl.textContent = n === 0 ? "no matches" : `${n} match${n !== 1 ? "es" : ""}`;
    countEl.classList.toggle("zero", n === 0);
    renderSegments();
}

// Jump to next / previous matching segment (find-only — no replace needed)
function findNext() {
    if (!findMatchSegs.length) { updateFindCount(); if (!findMatchSegs.length) { showToast("No matches", "info", 1500); return; } }
    findPos = (findPos + 1) % findMatchSegs.length;
    gotoFindMatch();
}
function findPrev() {
    if (!findMatchSegs.length) { updateFindCount(); if (!findMatchSegs.length) { showToast("No matches", "info", 1500); return; } }
    findPos = (findPos - 1 + findMatchSegs.length) % findMatchSegs.length;
    gotoFindMatch();
}
function gotoFindMatch() {
    const idx = findMatchSegs[findPos];
    if (idx == null) return;
    selectSegment(idx);
    const countEl = $("find-count");
    if (countEl) countEl.textContent = `${findPos + 1} / ${findMatchSegs.length}`;
}

function doReplaceAll() {
    const re = buildFindRegex();
    if (!re) { showToast("Type something to find first", "info", 2000); return; }
    const replEl = $("replace-input");
    const replacement = replEl ? replEl.value : "";

    let count = 0;
    for (const seg of segments) {
        const m = (seg.text || "").match(re);
        if (m) {
            count += m.length;
            seg.text = seg.text.replace(re, replacement);
        }
    }

    if (count === 0) { showToast("No matches found", "info", 2000); return; }

    clearFindHighlight();
    updateFindCount();
    showToast(`Replaced ${count} occurrence${count !== 1 ? "s" : ""}`, "success");
}

function reloadExtension() {
    window.location.href = 'index.html';
}

// ── SRT import ────────────────────────────────────────────────────────────
function importSRTFile() {
    const input = document.getElementById('srt-file-input');
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const filePath = file.path || null;
        if (filePath) {
            try {
                const data = fs.readFileSync(filePath, 'utf8');
                _loadSRTData(data, file.name);
            } catch (err) {
                showToast('Could not read file: ' + err.message, 'error');
            }
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => _loadSRTData(ev.target.result, file.name);
            reader.onerror = () => showToast('Could not read SRT file', 'error');
            reader.readAsText(file, 'utf-8');
        }
        input.value = '';
    };
    input.click();
}

function _loadSRTData(data, filename) {
    const parsed = parseSRT(data);
    if (!parsed.length) {
        showToast('No segments found in: ' + filename, 'error');
        return;
    }
    segments  = parsed;
    seqInTime = parsed[0].seqStart;
    renderSegments();
    updateSegCount();
    actionsBar.style.display = 'flex';
    sendBtn.disabled = false;
    setStatus(`Loaded ${parsed.length} segment(s) from ${filename}`, 'success');
    hideError();
    showToast(`${parsed.length} segments loaded from SRT`, 'success');
}

function srtTimeToSecs(t) {
    const clean = t.trim().replace(',', '.');
    const parts = clean.split(':');
    if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
    return parseFloat(clean);
}

function parseSRT(content) {
    const segs   = [];
    const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        let tsIdx = lines.findIndex(l => l.includes('-->'));
        if (tsIdx === -1) continue;
        const m = lines[tsIdx].match(
            /(\d{1,2}:\d{2}:\d{2}[,.:]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.:]\d{1,3})/
        );
        if (!m) continue;
        const start = srtTimeToSecs(m[1]);
        const end   = srtTimeToSecs(m[2]);
        const text  = lines.slice(tsIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
        if (!text) continue;
        segs.push({ id: segs.length, start, end, seqStart: start, seqEnd: end, text });
    }
    return segs;
}

// ── Play / pause ──────────────────────────────────────────────────────────
let _isPlaying = false;

async function playPause() {
    const btn = $("playpause-btn");
    const res = await evalScript("togglePlayback()");

    if (!res || res.success === false) {
        const msg = (res && res.error) ? res.error : "Playback failed (QE unavailable?)";
        setStatus("Play/Pause failed: " + msg, "error");
        showToast("Play/Pause failed: " + msg, "error", 7000);
        return;
    }

    _isPlaying = !!res.playing;
    if (btn) {
        btn.innerHTML = _isPlaying ? icon("pause") + "<span>" + t("btn_pause") + "</span>" : icon("play") + "<span>" + t("btn_play") + "</span>";
        btn.classList.toggle("playing", _isPlaying);
    }
}

// ── Seek timeline + play ───────────────────────────────────────────────────
// Clicking a segment seeks AND starts playback.
async function seekToSegment(idx) {
    const seg = segments[idx];
    if (!seg) return;
    selectSegment(idx);
    await evalScript(`seekToTime(${seg.seqStart})`);
    _isPlaying = false;
    // Start playing after seek
    const playRes = await evalScript("togglePlayback()");
    if (playRes && playRes.success !== false) {
        _isPlaying = !!(playRes.playing);
    }
    const btn = $("playpause-btn");
    if (btn) {
        btn.innerHTML = _isPlaying ? icon("pause") + "<span>" + t("btn_pause") + "</span>" : icon("play") + "<span>" + t("btn_play") + "</span>";
        btn.classList.toggle("playing", _isPlaying);
    }
}

function hideError() { $("error-panel").style.display = "none"; }

function showSRTSaved(srtPath) {
    const panel = $("srt-saved-panel");
    if (!panel) return;
    $("srt-saved-path").textContent = srtPath;
    panel.style.display = "block";
    $("srt-saved-reveal").onclick = () => {
        const { spawn } = _req("child_process");
        spawn("open", ["-R", srtPath]);
    };
}

function hideSRTSaved() {
    const panel = $("srt-saved-panel");
    if (panel) panel.style.display = "none";
}

function showError(what, why, fixText, fixBtnLabel, fixAction) {
    $("error-panel").style.display = "block";
    $("error-what").textContent    = what;

    const whyEl = $("error-why"), fixEl = $("error-fix");
    if (why) {
        whyEl.style.display = "block";
        $("error-why-text").textContent = why;
    } else {
        whyEl.style.display = "none";
    }
    if (fixText) {
        fixEl.style.display = "block";
        $("error-fix-text").textContent = fixText;
        const btn = $("error-fix-btn");
        if (fixBtnLabel && fixAction) {
            btn.textContent   = fixBtnLabel;
            btn.style.display = "inline-block";
            btn.onclick       = fixAction;
        } else {
            btn.style.display = "none";
        }
    } else {
        fixEl.style.display = "none";
    }
}

function formatTime(secs) {
    const h  = Math.floor(secs / 3600);
    const m  = Math.floor((secs % 3600) / 60);
    const s  = Math.floor(secs % 60);
    const ms = Math.round((secs % 1) * 1000);
    return `${p2(h)}:${p2(m)}:${p2(s)},${p3(ms)}`;
}
const p2 = n => String(n).padStart(2, "0");
const p3 = n => String(n).padStart(3, "0");

// ── Error classifier ──────────────────────────────────────────────────────
function classifyError(raw) {
    if (!raw) return null;
    const e = raw.toLowerCase();

    if (e.includes("no active sequence")) return {
        what: "No active sequence found.",
        why:  "A sequence (timeline) must be open and active in Premiere.",
        fix:  "Open a sequence in the Timeline panel and try again.",
    };
    if ((e.includes("in") || e.includes("out")) && e.includes("point")) return {
        what: "No In/Out points set.",
        why:  "Transcription requires a selected time range.",
        fix:  "Press I to set an In point and O to set an Out point on the timeline, then try again.",
    };
    if (e.includes("source media file not found")) return {
        what: "Source media file is offline.",
        why:  raw.split("\n").slice(0, 2).join(" "),
        fix:  "Re-link the offline clip in Premiere (right-click → Link Media), then try again.",
    };
    if (e.includes("ffmpeg not found at:") || (e.includes("ffmpeg") && e.includes("homebrew"))) return {
        what: "ffmpeg found but could not be executed.",
        why:  "Premiere launched without /opt/homebrew/bin in PATH.",
        fix:  "Reload the extension — it adds /opt/homebrew/bin to PATH automatically.",
        fixBtn: "Reload Extension",
        fixAct: () => reloadExtension(),
    };
    if (e.includes("ffmpeg") || (e.includes("no such file or directory") && !e.includes("media file"))) return {
        what: "Audio extraction failed — ffmpeg issue.",
        why:  raw.length < 300 ? raw : raw.slice(0, 300) + "…",
        fix:  "Make sure ffmpeg is installed:\n  brew install ffmpeg\nThen reload the extension.",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("could not start python") || e.includes("enoent")) return {
        what: "Python could not be started.",
        why:  "The extension requires Python 3 but it was not found.",
        fix:  "Install Python 3: https://python.org  or  brew install python3",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("whisperx") && (e.includes("not installed") || e.includes("no module"))) return {
        what: "WhisperX is not installed.",
        why:  "You selected the WhisperX engine but the package isn't available.",
        fix:  "Install it in Setup, or switch the engine in Settings to mlx/openai.",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("all engines failed")) return {
        what: "No transcription engine could run.",
        why:  raw,
        fix:  "Open Setup and install at least one engine (WhisperX, openai-whisper, or mlx-whisper).",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("no module named whisper") || e.includes("importerror")) return {
        what: "openai-whisper is not installed.",
        why:  "The transcription engine is missing.",
        fix:  "Run in Terminal:  pip3 install openai-whisper",
        fixBtn: "Install Now",
        fixAct: () => { switchTab("setup"); installPackage("openai-whisper", "whisper"); },
    };
    if (e.includes("no clips") || e.includes("extractions failed")) return {
        what: "Could not extract audio from the selected clips.",
        why:  raw,
        fix:  "Check that your In/Out points overlap a video/audio clip.",
    };
    return null;
}

// ── Transcription flow ────────────────────────────────────────────────────
async function startTranscription() {
    if (isRunning) return;
    isRunning = true;
    transcribeBtn.disabled   = true;
    sendBtn.disabled         = true;
    actionsBar.style.display = "none";
    hideError();

    const model    = $("model-select").value;
    const language = $("lang-select").value;

    try {
        setStatus("Reading timeline…", "info");
        showProgress(true);

        const seqInfo = await evalScript("getSequenceInfo()");
        if (!seqInfo.success) { handleError(seqInfo.error); return; }
        if (!seqInfo.clips || seqInfo.clips.length === 0) {
            handleError("No clips found in the selected In/Out range.\nMake sure your In/Out points overlap a clip on the timeline.");
            return;
        }

        setStatus(`Extracting audio… (${seqInfo.duration.toFixed(1)}s selected)`, "info");

        const tmpAudio = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`);
        const clipsArg = JSON.stringify({ clips: seqInfo.clips, duration: seqInfo.duration });

        const extractRes = await runPython("extract_audio.py", [clipsArg, tmpAudio]);
        if (!extractRes.success) { handleError(extractRes.error || "Audio extraction failed."); return; }

        const engLabel = { whisperx: "WhisperX", mlx: "mlx-whisper", openai: "openai-whisper", auto: "Whisper" }[settings.engine] || "Whisper";
        setStatus(`Transcribing with ${engLabel}… (first run may download the model)`, "info");

        const txArgs = [
            tmpAudio,
            model,
            language,
            settings.engine,
            settings.diarize ? "1" : "0",
        ];

        const txRes = await runPython("transcribe.py", txArgs, stderr => {
            if (stderr.includes("Downloading") || stderr.includes("download"))
                setStatus("Downloading model… (one-time, please wait)", "info");
        });

        try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); } catch {}

        if (!txRes.success) { handleError(txRes.error || "Transcription failed."); return; }

        lastLanguage = txRes.language || (language !== "auto" ? language : "");
        seqInTime = seqInfo.inTime;

        // Build working segments. Wrapped defensively: a malformed segment/word
        // from any engine (esp. WhisperX diarization/alignment) must never crash
        // the whole run — we fall back to raw, unsplit segments if anything throws.
        let segs;
        try {
            segs = (txRes.segments || [])
                .filter(seg => seg != null && seg.start != null && seg.end != null)
                .map((seg, i) => ({
                    id:    i,
                    start: Number(seg.start) || 0,
                    end:   Number(seg.end)   || 0,
                    text:  (seg.text == null ? "" : String(seg.text)),
                    words: (seg.words || []).filter(w => w != null && w.start != null && w.end != null),
                    speaker: seg.speaker || null,
                }));
            if (settings.autoSplit) segs = applySmartSplit(segs, settings);
        } catch (procErr) {
            console.error("[Whisper] segment processing failed, using raw segments:", procErr);
            segs = (txRes.segments || [])
                .filter(seg => seg != null && seg.start != null && seg.end != null)
                .map((seg, i) => ({
                    id: i, start: Number(seg.start) || 0, end: Number(seg.end) || 0,
                    text: (seg.text == null ? "" : String(seg.text)), words: [], speaker: seg.speaker || null,
                }));
        }

        segments = segs.map(seg => ({
            ...seg,
            seqStart: seqInfo.inTime + seg.start,
            seqEnd:   seqInfo.inTime + seg.end,
        }));

        renderSegments();

        if (segments.length === 0) {
            setStatus("No speech detected. Try a different model or language.", "warning");
        } else {
            const lang = txRes.language ? ` · lang: ${txRes.language}` : "";
            const eng  = txRes.engine   ? ` · ${txRes.engine}`         : "";
            const note = (txRes.notes && txRes.notes.length) ? ` · ${txRes.notes[0]}` : "";
            setStatus(`Done — ${segments.length} segment(s)${lang}${eng}${note}`, "success");
            actionsBar.style.display = "flex";
            updateSegCount();

            // Diarization requested but produced no speakers → tell the user why
            if (settings.diarize && !segments.some(s => s.speaker)) {
                showToast("Speaker labels need a HuggingFace token (see Settings). Transcribed without them.", "info", 6000);
            }

            // Auto-punctuation (runs after transcription if enabled)
            if (settings.autoPunctuate) {
                await fixPunctuation({ silent: true, auto: true });
            }

            // Auto clean-up: dictionary + filler removal (profanity left manual)
            if (settings.autoCleanup) {
                const d = applyDictionary({ silent: true });
                const f = removeFillers({ silent: true });
                renderSegments(); reselect();
                if (d + f > 0) showToast(`Auto clean-up: ${d} dictionary · ${f} fillers`, "info", 4000);
            }
        }

    } catch (e) {
        console.error("[Whisper] transcription error:", e);
        handleError(e && e.message ? e.message : String(e));
    } finally {
        isRunning = false;
        showProgress(false);
        transcribeBtn.disabled = false;
        sendBtn.disabled       = segments.length === 0;
    }
}

function handleError(rawErr) {
    const info = classifyError(rawErr);
    setStatus(info ? info.what : (rawErr?.split("\n")[0] || "An error occurred."), "error");
    if (info) {
        showError(info.what, info.why || null, info.fix || null, info.fixBtn, info.fixAct);
    } else {
        showError(
            rawErr?.split("\n")[0] || "Unknown error",
            rawErr?.split("\n").slice(1).join("\n") || null,
            "Check the Setup tab for system status.",
            "Go to Setup",
            () => switchTab("setup")
        );
    }
}

// ── Segment rendering ─────────────────────────────────────────────────────
function renderSegments() {
    if (segments.length === 0) {
        segmentsWrap.innerHTML = `
          <div class="empty-state">
            <div class="icon">${icon("captions")}</div>
            <p>${escHtml(t("empty_p"))}</p>
            <p class="hint">${escHtml(t("empty_hint"))}</p>
          </div>`;
        return;
    }
    segmentsWrap.innerHTML = "";
    segments.forEach((seg, idx) => {
        const el = document.createElement("div");
        el.className   = "segment";
        el.dataset.idx = idx;

        const speakerHtml = seg.speaker
            ? `<span class="seg-speaker">${seg.speaker.replace("SPEAKER_", "S")}</span>`
            : "";

        const tipSeek = escHtml(t("tip_seek"));
        const header = `
          <div class="seg-header">
            <span class="seg-index" onclick="seekToSegment(${idx})" data-tip="${tipSeek}">${idx + 1}</span>
            <span class="seg-time"  onclick="seekToSegment(${idx})" data-tip="${tipSeek}">${formatTime(seg.seqStart)} → ${formatTime(seg.seqEnd)}</span>
            ${speakerHtml}
            <div class="seg-actions">
              <button class="seg-btn"     onclick="editSegment(${idx})"   data-tip="${escHtml(t("tip_edit"))}">${icon("pencil")}</button>
              <button class="seg-btn"     onclick="splitSegment(${idx})"  data-tip="${escHtml(t("tip_split"))}">${icon("scissors")}</button>
              <button class="seg-btn del" onclick="deleteSegment(${idx})" data-tip="${escHtml(t("tip_del"))}">${icon("close")}</button>
            </div>
          </div>`;

        let bodyHtml;
        if (activeFindRegex) {
            // Find mode: highlight matches (no per-word split while searching)
            bodyHtml = highlightMatches(seg.text, activeFindRegex);
            if (findMatchSegs.includes(idx)) el.classList.add("has-match");
        } else {
            const words = seg.text.split(" ");
            bodyHtml = words.map((w, wi) =>
                `<span class="seg-word" onclick="splitAtWord(${idx},${wi})">${escHtml(w)}</span>`
            ).join(" ");
        }

        el.innerHTML = header +
            `<div class="seg-text" id="seg-text-${idx}" ondblclick="editSegment(${idx})">${bodyHtml}</div>`;

        el.addEventListener("click", e => {
            if (!e.target.classList.contains("seg-btn") &&
                !e.target.classList.contains("seg-word")) seekToSegment(idx);
        });
        segmentsWrap.appendChild(el);
    });
}

function escHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Escape text, then wrap regex matches in <mark> for find highlighting
function highlightMatches(text, re) {
    text = text || "";
    re.lastIndex = 0;
    let out = "", last = 0, m;
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    while ((m = g.exec(text)) !== null) {
        if (m.index > last) out += escHtml(text.slice(last, m.index));
        out += `<mark class="find-hit">${escHtml(m[0])}</mark>`;
        last = m.index + m[0].length;
        if (m[0].length === 0) g.lastIndex++;   // guard against zero-width loops
    }
    out += escHtml(text.slice(last));
    return out;
}

function selectSegment(idx) {
    document.querySelectorAll(".segment").forEach(el => el.classList.remove("selected"));
    selectedIndex = idx;
    const el = document.querySelector(`.segment[data-idx="${idx}"]`);
    if (el) { el.classList.add("selected"); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}

function updateSegCount() {
    if (segCountEl) segCountEl.textContent = `${segments.length} segment${segments.length !== 1 ? "s" : ""}`;
}

function editSegment(idx) {
    const textEl = document.getElementById(`seg-text-${idx}`);
    if (!textEl || textEl.tagName === "TEXTAREA") return;
    const ta = document.createElement("textarea");
    ta.className = "seg-text-edit";
    ta.value     = segments[idx].text;
    ta.rows      = 2;
    textEl.replaceWith(ta);
    ta.id = `seg-text-${idx}`;
    ta.focus();
    const save = () => {
        segments[idx].text = ta.value.trim();
        ta.closest(".segment")?.classList.remove("editing");
        renderSegments(); selectSegment(idx);
    };
    ta.addEventListener("blur", save);
    ta.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
        if (e.key === "Escape") save();
    });
    ta.closest(".segment")?.classList.add("editing");
}

function splitSegment(idx) {
    const seg = segments[idx];
    const mid = (seg.start + seg.end) / 2;
    const seqM= (seg.seqStart + seg.seqEnd) / 2;
    const words= seg.text.split(" ");
    const half = Math.max(1, Math.floor(words.length / 2));
    segments.splice(idx, 1,
        { ...seg, end: mid,   seqEnd:   seqM,  text: words.slice(0, half).join(" ") },
        { ...seg, id: idx+.5, start: mid, seqStart: seqM, text: words.slice(half).join(" ") }
    );
    segments.forEach((s, i) => { s.id = i; });
    renderSegments(); updateSegCount(); selectSegment(idx);
}

function splitAtWord(idx, wi) {
    const seg   = segments[idx];
    const words = seg.text.split(" ");
    if (wi === 0 || wi >= words.length - 1) { selectSegment(idx); return; }
    const ratio  = wi / words.length;
    const splitT = seg.start    + (seg.end    - seg.start)    * ratio;
    const splitS = seg.seqStart + (seg.seqEnd - seg.seqStart) * ratio;
    segments.splice(idx, 1,
        { ...seg, end: splitT, seqEnd:   splitS, text: words.slice(0, wi).join(" ") },
        { ...seg, id: idx+.5, start: splitT, seqStart: splitS, text: words.slice(wi).join(" ") }
    );
    segments.forEach((s, i) => { s.id = i; });
    renderSegments(); updateSegCount(); selectSegment(idx);
}

function deleteSegment(idx) {
    segments.splice(idx, 1);
    segments.forEach((s, i) => { s.id = i; });
    if (segments.length === 0) { renderSegments(); actionsBar.style.display = "none"; }
    else renderSegments();
    updateSegCount();
    sendBtn.disabled = segments.length === 0;
}

function clearAll() {
    if (!confirm("Clear all segments?")) return;
    segments = []; selectedIndex = -1;
    renderSegments(); actionsBar.style.display = "none";
    setStatus("Ready", "info"); hideError();
}

// ── SRT & Send ────────────────────────────────────────────────────────────
function wrapText(text, maxCharsPerLine, maxLines) {
    const words = (text || "").trim().split(/\s+/);
    if (words.length <= 1) return text;
    const lines = [];
    let cur = "";
    for (const w of words) {
        if (cur && (cur.length + 1 + w.length) > maxCharsPerLine && lines.length < maxLines - 1) {
            lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + " " + w : w;
        }
    }
    if (cur) lines.push(cur);
    return lines.join("\n");
}

function segmentsToSRT(segsOverride) {
    const segs = segsOverride || segments;
    return segs.map((seg, i) => {
        const text = settings.autoSplit
            ? wrapText(seg.text, settings.maxCharsPerLine, settings.maxLines)
            : seg.text;
        return `${i+1}\n${formatTime(seg.seqStart)} --> ${formatTime(seg.seqEnd)}\n${text}\n`;
    }).join("\n");
}

// ── Multi-format export ───────────────────────────────────────────────────
function fmtVTT(secs) {
    return formatTime(secs).replace(",", ".");
}
function fmtASS(secs) {
    const h  = Math.floor(secs / 3600);
    const m  = Math.floor((secs % 3600) / 60);
    const s  = Math.floor(secs % 60);
    const cs = Math.round((secs % 1) * 100);
    return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

function _exportSegs() {
    return settings.gapFill ? applyGapFill(segments, settings.gapMax) : segments;
}
function _wrap(text) {
    return settings.autoSplit ? wrapText(text, settings.maxCharsPerLine, settings.maxLines) : text;
}

function segmentsToVTT() {
    const segs = _exportSegs();
    let out = "WEBVTT\n\n";
    out += segs.map((seg, i) =>
        `${i+1}\n${fmtVTT(seg.seqStart)} --> ${fmtVTT(seg.seqEnd)}\n${_wrap(seg.text)}\n`
    ).join("\n");
    return out;
}

function assColor(rrggbb, alpha) {
    const r = rrggbb.slice(0, 2), g = rrggbb.slice(2, 4), b = rrggbb.slice(4, 6);
    const a = (alpha | 0).toString(16).padStart(2, "0");
    return ("&H" + a + b + g + r).toUpperCase();
}

// SecondaryColour matters for karaoke: text shows Secondary before the \k sweep,
// Primary after. For karaoke we set Secondary = base text, Primary = highlight.
function buildASSStyle(p, karaoke) {
    const base      = assColor(p.primary, 0);
    const highlight = assColor(settings.karaokeHi || "FFE000", 0);
    const outline   = assColor(p.outline, 0);
    const back      = assColor(p.boxColor, p.box ? p.boxAlpha : 0);
    const border    = p.box ? 3 : 1;
    const marginV   = (p.align === 5) ? 0 : 50;
    const primaryCol   = karaoke ? highlight : base;
    const secondaryCol = karaoke ? base      : "&H000000FF";
    return `Style: Default,${p.font},${p.size},${primaryCol},${secondaryCol},${outline},${back},${p.bold ? -1 : 0},0,0,0,100,100,0,0,${border},${p.outlineW},${p.shadow},${p.align},60,60,${marginV},1`;
}

function escAssText(s) {
    return (s || "").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

// Build a karaoke dialogue body: {\kf<cs>}word for each word, durations absorb
// inter-word gaps so the highlight stays in sync with the audio.
function karaokeBody(seg) {
    const words = (seg.words || []).filter(w => w && w.start != null && w.end != null && w.word);
    if (!words.length) return escAssText(seg.text);
    let prev = seg.start != null ? seg.start : words[0].start;
    let parts = [];
    for (const w of words) {
        const durCs = Math.max(1, Math.round((w.end - prev) * 100));
        parts.push(`{\\kf${durCs}}` + escAssText(w.word) + " ");
        prev = w.end;
    }
    return parts.join("").trim();
}

function segmentsToASS() {
    const preset   = getActivePreset();
    const karaoke  = !!settings.karaoke;
    const header =
`[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${buildASSStyle(preset, karaoke)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const segs = _exportSegs();
    const lines = segs.map(seg => {
        const text = karaoke ? karaokeBody(seg) : _wrap(seg.text).replace(/\n/g, "\\N");
        return `Dialogue: 0,${fmtASS(seg.seqStart)},${fmtASS(seg.seqEnd)},Default,,0,0,0,,${text}`;
    }).join("\n");
    return header + lines + "\n";
}

function segmentsToTXT() {
    return _exportSegs().map(seg => seg.text.trim()).join("\n");
}

function toggleExportMenu() {
    const m = $("export-menu");
    m.style.display = (m.style.display === "none" || !m.style.display) ? "block" : "none";
}

function exportAs(fmt) {
    $("export-menu").style.display = "none";
    if (segments.length === 0) { showToast("Nothing to export yet", "info", 2000); return; }

    const builders = { srt: segmentsToSRT, vtt: segmentsToVTT, ass: segmentsToASS, txt: segmentsToTXT };
    const builder = builders[fmt];
    if (!builder) return;

    const content = builder();
    const stamp   = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const defName = `captions_${stamp}.${fmt}`;

    let outPath = null;
    try {
        if (window.cep && window.cep.fs && window.cep.fs.showSaveDialogEx) {
            const res = window.cep.fs.showSaveDialogEx("Export captions", "", [fmt], defName, fmt.toUpperCase());
            if (res && res.data) outPath = res.data;
            else if (res && res.err === 0 && typeof res === "string") outPath = res;
        }
    } catch (e) {}

    if (!outPath) {
        outPath = path.join(os.homedir(), "Desktop", defName);
    }

    try {
        fs.writeFileSync(outPath, content, "utf8");
        setStatus(`Exported ${fmt.toUpperCase()} → ${outPath}`, "success");
        showToast(`Saved ${fmt.toUpperCase()} file`, "success");
        try { spawn("open", ["-R", outPath]); } catch (e) {}
    } catch (e) {
        showToast(`Export failed: ${e.message}`, "error", 5000);
    }
}

async function sendToPremiere() {
    if (segments.length === 0) return;
    if (settings.sendMode === "graphics") { await sendStyledGraphics(); return; }
    sendBtn.disabled = true;
    setStatus("Sending captions to Premiere…", "info");
    showProgress(true);
    hideSRTSaved();

    const finalSegs = settings.gapFill ? applyGapFill(segments, settings.gapMax) : segments;
    const srt       = segmentsToSRT(finalSegs);
    const escaped = srt.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\r?\n/g,"\\n");
    const result  = await evalScript(`importSRTToProject('${escaped}')`);

    showProgress(false);
    sendBtn.disabled = false;

    if (result.diag) console.log("[Whisper] caption diag:", result.diag);

    if (result.success) {
        if (result.autoAdded) {
            setStatus(result.message || "Captions added to timeline!", "success");
            showToast(result.message || "Captions added to timeline!", "success");
            hideError();
        } else {
            setStatus("SRT saved — couldn't auto-place on timeline", "warning");
            showSRTSaved(result.srtPath || "");
            if (result.diag) {
                showError(
                    "Captions imported to the project panel but not auto-placed on the timeline.",
                    "Diagnostic: " + result.diag.join("  •  "),
                    "Drag the SRT from the project panel onto a caption track."
                );
            }
        }
    } else {
        handleError(result.error || "Failed to export captions.");
    }
}

// ── Send as styled Essential Graphics (MOGRT) — like AutoCut / FireCut ─────
async function sendStyledGraphics() {
    if (segments.length === 0) return;

    const mogrt = settings.mogrtPath;
    if (!mogrt || !fs.existsSync(mogrt)) {
        setStatus("No MOGRT template selected", "warning");
        showError(
            t("err_nomogrt_what"),
            t("err_nomogrt_why"),
            t("err_nomogrt_fix"),
            t("btn_pickmogrt"),
            () => { switchMainTab("transcribe"); switchSubTab("transcribe", "settings"); setTimeout(pickMOGRT, 150); }
        );
        return;
    }

    sendBtn.disabled = true;
    setStatus("Placing styled graphics on the timeline…", "info");
    showProgress(true);
    hideError(); hideSRTSaved();

    const finalSegs = settings.gapFill ? applyGapFill(segments, settings.gapMax) : segments;
    const items = finalSegs.map(seg => ({
        text:  settings.autoSplit ? wrapText(seg.text, settings.maxCharsPerLine, settings.maxLines) : seg.text,
        start: seg.seqStart,
        end:   seg.seqEnd,
    }));
    const payload = JSON.stringify({ mogrtPath: mogrt.replace(/\\/g, "/"), items });
    const escaped = payload.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    const result = await evalScript(`importTextGraphics('${escaped}')`);

    showProgress(false);
    sendBtn.disabled = false;

    if (result.diag) console.log("[Whisper] graphics diag:", result.diag);

    if (result && result.success && result.placed > 0) {
        setStatus(`✓ Placed ${result.placed} styled graphic(s) on track V${(result.track || 0) + 1}`, "success");
        showToast(`${result.placed} styled captions added to the timeline`, "success", 5000);
    } else {
        const err = (result && result.error) || "Could not place graphics.";
        handleError(err);
        if (result && result.diag) {
            showError(
                "Styled graphics could not be placed correctly.",
                "Diagnostic (send me this): " + result.diag.join("  •  "),
                "This usually means the MOGRT's text parameter name differs in your Premiere version — paste the diagnostic above and I'll tune it."
            );
        }
    }
}

// Pick a .mogrt template file (CEP file dialog)
function pickMOGRT() {
    let chosen = null;
    try {
        if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
            const res = window.cep.fs.showOpenDialogEx(false, false, "Choose a .mogrt template", "", ["mogrt"]);
            if (res && res.data && res.data.length) chosen = res.data[0];
        }
    } catch (e) {}
    if (!chosen) {
        // Fallback: hidden file input
        const inp = document.getElementById("mogrt-file-input");
        if (inp) {
            inp.onchange = e => {
                const f = e.target.files[0];
                if (f && f.path) { settings.mogrtPath = f.path; saveSettings(); updateMogrtLabel(); showToast("MOGRT selected", "success"); }
                inp.value = "";
            };
            inp.click();
        }
        return;
    }
    settings.mogrtPath = chosen;
    saveSettings();
    updateMogrtLabel();
    showToast("MOGRT template selected", "success");
}

function updateMogrtLabel() {
    const el = $("mogrt-name");
    if (el) {
        const p = settings.mogrtPath;
        el.textContent = p ? p.split(/[\\/]/).pop() : t("mogrt_none");
        el.classList.toggle("set", !!p);
    }
}

function onSendModeChange(val) {
    settings.sendMode = val;
    saveSettings();
    const sub = $("graphics-sub");
    if (sub) sub.style.display = val === "graphics" ? "block" : "none";
    // reflect on the send button label
    const sb = $("send-btn");
    if (sb) sb.querySelector("span") && (sb.querySelector("span").textContent =
        val === "graphics" ? t("act_send_gfx") : t("act_send"));
}

// ── Setup / Diagnostics ───────────────────────────────────────────────────
let diagData = null;

async function runDiagnostics() {
    setupIndicator.className = "setup-indicator loading";
    $("checks-list").innerHTML = `<div class="check-loading">Checking…</div>`;
    $("models-list").innerHTML  = `<div class="check-loading">Loading…</div>`;

    const data = await runPython("check_setup.py", []);
    diagData = data;

    if (!data || data.error) {
        setupIndicator.className  = "setup-indicator error";
        setupBadge.style.display  = "inline-flex";
        $("checks-list").innerHTML = `<div class="check-loading" style="color:var(--red2)">
          Could not run Python. Is Python 3 installed?</div>`;
        return;
    }

    renderChecks(data);
    renderModels(data.models);
    renderSetupNotes(data._os || "mac");

    setupIndicator.className = `setup-indicator ${data._ready ? "ok" : "warn"}`;
    setupBadge.style.display = data._ready ? "none" : "inline-flex";
}

function renderChecks(data) {
    const keys = [
        { key: "python"     },
        { key: "ffmpeg"     },
        { key: "whisperx"   },
        { key: "whisper"    },
        { key: "mlx_whisper"},
        { key: "punctuation"},
    ];
    let html = "";
    for (const { key } of keys) {
        const c = data[key]; if (!c) continue;
        const ok  = c.status === "ok";
        const opt = c.optional;
        html += `<div class="check-item">
          <div class="check-icon">${ok ? "✅" : (opt ? "⚪" : "❌")}</div>
          <div class="check-body">
            <div class="check-name">${c.label}</div>
            <div class="check-detail ${ok ? "ok" : (opt ? "opt" : "bad")}">${c.detail || ""}</div>
            ${!ok && c.fix_cmd ? renderFixRow(key, c) : ""}
          </div>
        </div>`;
    }
    $("checks-list").innerHTML = html;
}

function renderFixRow(key, c) {
    if (c.fix_type === "pip") {
        return `<div class="check-cmd">
          <code>${c.fix_cmd}</code>
          <button class="btn-install" id="btn-install-${key}"
                  onclick="installPackage('${c.fix_pkg}','${key}')">
            ${c.fix_label}
          </button>
        </div>`;
    }
    return `<div class="check-cmd">
      <code>${c.fix_cmd}</code>
      <button class="btn-copy" onclick="copyAndMark(this,'${c.fix_cmd}')">Copy</button>
    </div>`;
}

function copyAndMark(btn, text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = "✓"; btn.classList.add("copied");
            setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
        });
    }
}

async function installPackage(pkg, key) {
    const btn = $(`btn-install-${key}`);
    if (btn) { btn.textContent = "Installing…"; btn.disabled = true; btn.classList.add("installing"); }

    const py  = findPython();
    const res = await runCmd(py, ["-m", "pip", "install", "--user", pkg]);

    if (res.code === 0) {
        showToast(`${pkg} installed successfully!`, "success");
    } else {
        showToast(`Install failed: ${res.err.slice(0, 120)}`, "error", 6000);
        if (btn) {
            btn.textContent = diagData?.[key]?.fix_label || "Install automatically";
            btn.disabled    = false;
            btn.classList.remove("installing");
        }
    }
    await runDiagnostics();
}

function renderModels(models) {
    if (!models?.cached?.length) {
        $("models-list").innerHTML = `
          <div class="no-models">
            No models downloaded yet.<br>
            The first transcription will download the selected model automatically.<br>
            <span style="color:var(--text3)">turbo ≈ 1.5 GB (one-time download)</span>
          </div>`;
        return;
    }
    $("models-list").innerHTML = models.cached.map(m => `
      <div class="model-item">
        <div class="model-dot"></div>
        <div class="model-name">${m.label}</div>
        <div class="model-size">${m.size_mb} MB</div>
      </div>`).join("");
}

// OS-aware install guidance (Windows vs macOS)
function renderSetupNotes(os) {
    const el = $("setup-notes");
    if (!el) return;
    const cp = cmd => `<a href="#" onclick="copyText('${cmd.replace(/'/g, "\\'")}'); return false;">${cmd}</a>`;
    if (os === "win") {
        el.innerHTML = `
          <p><strong>1. Python</strong> — install from <a href="#" onclick="copyText('https://www.python.org/downloads/'); return false;">python.org</a>
             and tick <strong>“Add Python to PATH”</strong> during setup.</p>
          <p><strong>2. ffmpeg</strong> — in Terminal (PowerShell): ${cp("winget install Gyan.FFmpeg")}</p>
          <p><strong>3. Engine</strong> — use the <strong>Install automatically</strong> buttons above, or run ${cp("pip install openai-whisper")}</p>
          <p>Then click <strong>Re-check</strong>.</p>`;
    } else {
        el.innerHTML = `
          <p>If <strong>Python</strong> is missing: ${cp("brew install python3")}</p>
          <p>If <strong>ffmpeg</strong> is missing: ${cp("brew install ffmpeg")}</p>
          <p>No Homebrew? ${cp('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')}</p>
          <p>Then click <strong>Re-check</strong>.</p>`;
    }
}

// ── Init ──────────────────────────────────────────────────────────────────
// ── Hover tooltips ─────────────────────────────────────────────────────────
// Any element with a [data-tip] attribute shows a styled tooltip on hover.
// The tooltip is appended to <body> with position:fixed so it is never clipped
// by the panel's overflow containers (a problem with CSS ::after tooltips here).
function initTooltips() {
    let tip = document.getElementById("ws-tooltip");
    if (!tip) {
        tip = document.createElement("div");
        tip.id = "ws-tooltip";
        tip.className = "ws-tooltip";
        document.body.appendChild(tip);
    }
    let timer = null, current = null;

    function place(target) {
        const r = target.getBoundingClientRect();
        // measure first
        tip.style.left = "0px"; tip.style.top = "0px";
        const tr = tip.getBoundingClientRect();
        let left = r.left + r.width / 2 - tr.width / 2;
        let top  = r.top - tr.height - 7;
        if (top < 4) top = r.bottom + 7;                       // flip below if no room
        left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
        tip.style.left = Math.round(left) + "px";
        tip.style.top  = Math.round(top) + "px";
    }
    function show(target) {
        const t = target.getAttribute("data-tip");
        if (!t) return;
        current = target;
        tip.textContent = t;
        tip.classList.add("show");
        place(target);
    }
    function hide() { current = null; clearTimeout(timer); tip.classList.remove("show"); }

    document.addEventListener("mouseover", e => {
        const t = e.target.closest && e.target.closest("[data-tip]");
        if (!t || t === current) return;
        clearTimeout(timer);
        timer = setTimeout(() => show(t), 300);
    });
    document.addEventListener("mouseout", e => {
        const t = e.target.closest && e.target.closest("[data-tip]");
        if (t) hide();
    });
    // Hide on any click/scroll so it never lingers
    document.addEventListener("click", hide, true);
    document.addEventListener("scroll", hide, true);
}

(function init() {
    loadHostJSX();

    applyLanguage();
    applyIcons();
    renderSegments();
    initTooltips();
    const hl = $("header-lang"); if (hl) hl.value = settings.uiLang;
    setStatus(t("status_ready"), "info");
    sendBtn.disabled         = true;
    setupIndicator.className = "setup-indicator loading";

    // Close the export / clean menus when clicking outside
    document.addEventListener("click", e => {
        if (!e.target.closest(".export-wrap")) {
            ["export-menu", "clean-menu"].forEach(id => {
                const menu = $(id);
                if (menu && menu.style.display === "block") menu.style.display = "none";
            });
        }
    });

    // Background startup check
    runPython("check_setup.py", []).then(data => {
        diagData = data;
        if (!data || !data._ready) {
            setupIndicator.className = "setup-indicator warn";
            setupBadge.style.display = "inline-flex";
        } else {
            setupIndicator.className = "setup-indicator ok";
        }
    }).catch(() => {
        setupIndicator.className = "setup-indicator error";
        setupBadge.style.display = "inline-flex";
    });
})();
