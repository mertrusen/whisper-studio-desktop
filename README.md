# Subsper — Desktop

Local AI subtitles, audio cleanup & silence cutting for **CapCut** (or any editor).
No Premiere needed. Runs on **Windows** and macOS. 100% offline & free.

---

## ⬇️ For users — install the app

### Windows
1. Go to the **[Releases](../../releases)** page and download the latest
   `WhisperStudio-Setup-x.x.x.exe`.
2. Run it (Windows SmartScreen may warn because the app isn't code-signed →
   *More info → Run anyway*). Install.
3. **First run — install the engine (one time).** Open the app → **Setup** tab.
   It checks what's missing and gives you copy-paste commands / one-click installs:
   - **Python** — [python.org](https://www.python.org/downloads/) → tick *“Add Python to PATH”*
   - **ffmpeg** — in PowerShell: `winget install Gyan.FFmpeg`
   - **Whisper** — click **Install automatically** in the Setup tab (or `pip install openai-whisper`)
4. Click **Re-check** until everything is green, then open a video and transcribe.

### macOS
```
brew install python3 ffmpeg
pip3 install openai-whisper      # or: pip3 install whisperx
```
Then run the app (or `npm start` from source) and check the **Setup** tab.

> The app itself is small. The AI engine (Python + Whisper) is installed once on the
> machine — this keeps the download tiny and lets you pick the engine you want.

---

## 🛠 For the maintainer — build & publish

The Windows `.exe` is **built automatically in the cloud by GitHub Actions** — you
don't need a Windows PC.

1. Push this folder to a GitHub repo (see below).
2. Every push to `main` builds the installer and uploads it as an **artifact**
   (Actions tab → latest run → Artifacts).
3. To publish a downloadable **Release** your friend can grab:
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions builds and attaches `WhisperStudio-Setup-1.0.0.exe` to a Release.

### First-time push
```
cd WhisperStudioDesktop
git init
git add .
git commit -m "Subsper Desktop"
gh repo create whisper-studio-desktop --public --source=. --push
```

### Build locally instead (optional)
```
npm install
npm run dist:win    # on Windows → dist/WhisperStudio-Setup-x.x.x.exe
npm run dist:mac    # on macOS  → dist/*.dmg
npm start           # run from source
```

---

## Usage
1. **Open Video / Audio File** (or drag-and-drop onto the window)
2. Pick model + language → **Transcribe File**
3. Edit segments (click a word to split, double-click to edit, 🧹 to clean up)
4. **⬇ Export → SRT** → import into CapCut
5. Bonus: **🔊 Audio → Enhance** and **✂️ Edit → Cut Silences** export cleaned/trimmed files

## How it's built
Same UI/logic as the Premiere extension. `desktop-shim.js` stubs the Premiere
(CEP) APIs so `main.js` loads unchanged; `desktop-app.js` overrides the I/O
boundary (file pickers, media playback, exports) and hides Premiere-only tools.
The Python scripts in `scripts/` are shared and run via Node `spawn`.
