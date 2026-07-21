/* ============================================================================
   Jarvis desktop wrapper (Electron) — SKELETON
   ----------------------------------------------------------------------------
   Purpose: a background/menu-bar app that can launch at login and open (or focus)
   the Jarvis window on a local wake word — the "Hey Siri" behaviour a web page
   cannot provide on its own.

   This is a working shell. The wake-word engine is stubbed with a clear TODO so
   you add Picovoice Porcupine (free tier) with your own access key — wake-word
   audio then stays on the machine and only the command is sent onward.

   Setup:
     cd desktop
     npm init -y
     npm install electron @picovoice/porcupine-node @picovoice/pvrecorder-node
     # point JARVIS_URL below at your deployed portal (or http://localhost:8787)
     npx electron .
   ========================================================================== */

const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut } = require("electron");
const path = require("path");

const JARVIS_URL = process.env.JARVIS_URL || "http://localhost:8787";

let win = null;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    title: "J.A.R.V.I.S — GoDrive Autos",
    backgroundColor: "#02070f",
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(JARVIS_URL);
  win.on("close", (e) => { e.preventDefault(); win.hide(); }); // keep running in tray
}

function showJarvis() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

app.whenReady().then(() => {
  createWindow();

  // Menu-bar / tray icon
  const icon = nativeImage.createEmpty(); // replace with a real 16x16 template icon
  tray = new Tray(icon);
  tray.setToolTip("Jarvis — GoDrive Autos");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Jarvis", click: showJarvis },
    { type: "separator" },
    { label: "Launch at login", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }) },
    { type: "separator" },
    { label: "Quit", click: () => { app.exit(0); } },
  ]));

  // Manual hotkey to summon the window (works even before wake word is wired)
  globalShortcut.register("CommandOrControl+Shift+J", showJarvis);

  startWakeWord(showJarvis);
});

app.on("window-all-closed", (e) => { /* stay alive in tray */ });

/* ----------------------------------------------------------------------------
   Wake-word engine — TODO: wire Picovoice Porcupine.
   Porcupine ships a built-in "Jarvis" keyword, so this is a natural fit.
   Pseudocode of the real implementation:

     const { Porcupine, BuiltinKeyword } = require("@picovoice/porcupine-node");
     const { PvRecorder } = require("@picovoice/pvrecorder-node");
     const porcupine = new Porcupine(ACCESS_KEY, [BuiltinKeyword.JARVIS], [0.6]);
     const recorder = new PvRecorder(porcupine.frameLength);
     recorder.start();
     (async function loop(){
       while (recorder.isRecording) {
         const frame = await recorder.read();
         if (porcupine.process(frame) >= 0) onWake();  // detected locally
       }
     })();

   Audio is processed on-device; nothing is streamed to the cloud for detection.
---------------------------------------------------------------------------- */
function startWakeWord(onWake) {
  console.log("[wake] Porcupine not yet configured — add your Picovoice access key.");
  console.log("[wake] Until then, summon Jarvis with Cmd/Ctrl+Shift+J.");
  // onWake() will be called by Porcupine once wired.
}
