#!/usr/bin/env python3
"""Whisper Studio – dependency diagnostic. Outputs JSON. Cross-platform (mac/win)."""
import json, os, sys, subprocess, shutil

IS_WIN = sys.platform.startswith("win")
PY = sys.executable or ("python" if IS_WIN else "python3")

FFMPEG_PATHS = [
    "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/sbin/ffmpeg",
    "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg",
    "C:/ffmpeg/bin/ffmpeg.exe", "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
]

MODEL_LABELS = {
    "large-v3-turbo": "large-v3-turbo — Recommended ★",
    "turbo":          "turbo",
    "large-v3":       "large-v3 — Best accuracy",
    "large-v2":       "large-v2",
    "large":          "large",
    "medium":         "medium",
    "small":          "small",
    "base":           "base",
    "tiny":           "tiny",
}


def find_ffmpeg():
    # PATH lookup first (works on Windows and *nix)
    found = shutil.which("ffmpeg")
    if found:
        return found
    for p in FFMPEG_PATHS:
        if os.path.isfile(p):
            return p
    return None


def pip_cmd(pkg):
    # Install into THE SAME interpreter the app uses — avoids "installed in the
    # wrong Python" problems, the #1 cause of "engine not found".
    return '"%s" -m pip install %s' % (PY, pkg)


def ffmpeg_fix():
    if IS_WIN:
        return {"fix_type": "copy", "fix_cmd": "winget install Gyan.FFmpeg",
                "fix_label": "Copy command and run in Terminal"}
    return {"fix_type": "copy", "fix_cmd": "brew install ffmpeg",
            "fix_label": "Copy command and run in Terminal"}


def check():
    out = {}

    vmaj, vmin = sys.version_info.major, sys.version_info.minor
    ver = "%d.%d.%d" % (vmaj, vmin, sys.version_info.micro)
    # Whisper / WhisperX wheels are most reliable on Python 3.10–3.11. 3.12+ often
    # fails to build deps (numba/llvmlite, torch). Flag it so the user knows.
    py_too_new = (vmaj == 3 and vmin >= 12)
    out["python"] = {
        "status": "warn" if py_too_new else "ok",
        "label":  "Python",
        "version": ver,
        "path":   PY,
        "detail": ("Python %s — ⚠ 3.12+ can fail to install Whisper. Install Python 3.11 for best results." % ver)
                  if py_too_new else ("Python %s — %s" % (ver, PY)),
    }

    ffmpeg = find_ffmpeg()
    if ffmpeg:
        out["ffmpeg"] = {"status": "ok", "label": "ffmpeg", "detail": ffmpeg}
    else:
        d = {"status": "missing", "label": "ffmpeg", "detail": "Required for audio — not installed"}
        d.update(ffmpeg_fix())
        out["ffmpeg"] = d

    # openai-whisper
    try:
        import whisper  # noqa: F401
        try:
            import importlib.metadata
            ver = importlib.metadata.version("openai-whisper")
        except Exception:
            ver = getattr(whisper, "__version__", "installed")
        out["whisper"] = {"status": "ok", "label": "openai-whisper", "detail": "v%s" % ver}
    except Exception:
        out["whisper"] = {
            "status": "missing", "label": "openai-whisper",
            "detail": "Transcription engine — not installed",
            "fix_type": "pip", "fix_pkg": "openai-whisper",
            "fix_cmd": pip_cmd("openai-whisper"), "fix_label": "Install automatically",
        }

    # whisperx
    try:
        import whisperx  # noqa: F401
        try:
            import importlib.metadata
            ver = importlib.metadata.version("whisperx")
        except Exception:
            ver = "installed"
        out["whisperx"] = {"status": "ok", "label": "WhisperX (word-level + speakers) ★",
                           "optional": True, "detail": "v%s — best word timing & diarization" % ver}
    except Exception:
        out["whisperx"] = {
            "status": "missing", "label": "WhisperX (recommended)", "optional": True,
            "detail": "Word-level timestamps + speaker labels — not installed",
            "fix_type": "pip", "fix_pkg": "whisperx",
            "fix_cmd": pip_cmd("whisperx"), "fix_label": "Install automatically",
        }

    # mlx-whisper (Apple Silicon only)
    if IS_WIN:
        out["mlx_whisper"] = {"status": "na", "label": "mlx-whisper (Apple Silicon only)",
                              "optional": True, "detail": "Not applicable on Windows"}
    else:
        try:
            import mlx_whisper  # noqa: F401
            out["mlx_whisper"] = {"status": "ok", "label": "mlx-whisper (Apple Silicon speed)",
                                  "optional": True, "detail": "Installed — 3–5× faster on M-series"}
        except Exception:
            out["mlx_whisper"] = {
                "status": "missing", "label": "mlx-whisper (optional)", "optional": True,
                "detail": "Speed boost for Apple Silicon — not required",
                "fix_type": "pip", "fix_pkg": "mlx-whisper",
                "fix_cmd": pip_cmd("mlx-whisper"), "fix_label": "Install automatically",
            }

    # punctuation (optional)
    try:
        import deepmultilingualpunctuation  # noqa: F401
        out["punctuation"] = {"status": "ok", "label": "Punctuation restore (optional)",
                              "optional": True, "detail": "Installed"}
    except Exception:
        out["punctuation"] = {
            "status": "missing", "label": "Punctuation restore (optional)", "optional": True,
            "detail": "Restores punctuation & casing — not required",
            "fix_type": "pip", "fix_pkg": "deepmultilingualpunctuation",
            "fix_cmd": pip_cmd("deepmultilingualpunctuation"), "fix_label": "Install automatically",
        }

    # cached whisper models (~/.cache/whisper on all platforms)
    cached = []
    whisper_cache = os.path.expanduser("~/.cache/whisper")
    if os.path.exists(whisper_cache):
        try:
            for fname in os.listdir(whisper_cache):
                if fname.endswith(".pt"):
                    name = fname[:-3]
                    size_mb = round(os.path.getsize(os.path.join(whisper_cache, fname)) / 1048576)
                    cached.append({"name": name, "label": MODEL_LABELS.get(name, name), "size_mb": size_mb})
        except Exception:
            pass

    out["models"] = {
        "status": "ok" if cached else "empty",
        "label":  "Whisper models",
        "cached": cached,
        "detail": ("%d model(s) cached" % len(cached)) if cached else "No models downloaded yet",
    }

    any_engine = (
        out["whisper"]["status"] == "ok"
        or out.get("whisperx", {}).get("status") == "ok"
        or out.get("mlx_whisper", {}).get("status") == "ok"
    )
    out["_ready"] = (out["python"]["status"] in ("ok", "warn") and out["ffmpeg"]["status"] == "ok" and any_engine)
    out["_os"] = "win" if IS_WIN else "mac"
    return out


if __name__ == "__main__":
    print(json.dumps(check(), ensure_ascii=False))
