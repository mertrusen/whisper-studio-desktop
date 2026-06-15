/* electron-main.js — Whisper Studio Desktop main process.
   Works on Windows and macOS. Creates the window and serves native file dialogs. */

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 880,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: "#0e1014",
    title: "Subsper",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,   // local desktop tool — renderer needs Node + spawn
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
  win.setMenuBarVisibility(false);
  // win.webContents.openDevTools();
}

// App directory (where scripts/ lives) — requested synchronously by the shim.
// In a packaged build the Python scripts live in resources/scripts (extraResources),
// because spawn() can't execute files from inside the asar archive.
ipcMain.on("get-app-dir", (e) => {
  e.returnValue = app.isPackaged ? process.resourcesPath : __dirname;
});

// Open a media file
ipcMain.handle("dialog:openMedia", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Open video or audio",
    properties: ["openFile"],
    filters: [
      { name: "Media", extensions: ["mp4","mov","m4v","mkv","webm","avi","wmv","mp3","wav","m4a","aac","flac","ogg"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { filePath: null };
  return { filePath: res.filePaths[0] };
});

// Save a file (subtitles / enhanced audio / trimmed media)
ipcMain.handle("dialog:saveFile", async (_e, opts) => {
  opts = opts || {};
  const res = await dialog.showSaveDialog(win, {
    title: "Save",
    defaultPath: opts.defaultName || "output",
    filters: opts.ext
      ? [{ name: opts.ext.toUpperCase(), extensions: [opts.ext] }, { name: "All files", extensions: ["*"] }]
      : [{ name: "All files", extensions: ["*"] }],
  });
  if (res.canceled || !res.filePath) return { filePath: null };
  return { filePath: res.filePath };
});

// Reveal a file in Finder/Explorer
ipcMain.handle("shell:showItem", (_e, p) => { try { shell.showItemInFolder(p); } catch (e) {} return true; });

app.whenReady().then(createWindow);

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
