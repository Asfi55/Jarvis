# "Hey Siri, open Jarvis" — iPhone / iPad

A web page cannot be Siri or listen in the background on iOS — Apple doesn't allow it.
The supported, honest equivalent is a Siri Shortcut that launches your Jarvis web app;
you then talk to Jarvis inside it.

## One-time setup (2 minutes)
1. Deploy the backend so you have a public URL (see the main README → Deploying), and
   add the portal to your Home Screen: open the URL in Safari → Share → **Add to Home
   Screen**.
2. Open the **Shortcuts** app → **+** (new shortcut).
3. Add action **Open URLs** → paste your Jarvis URL (e.g. `https://jarvis-godrive.onrender.com`).
   - If you added it to the Home Screen as a web app, "Open URLs" still launches it full-screen.
4. Tap the shortcut name → rename it **Jarvis**.
5. Done. Now say: **"Hey Siri, open Jarvis."**

## Then
- Once the app opens, turn on **Wake word** (or just tap the mic) and speak normally.
- On iOS the mic and wake word only run while the Jarvis app is open and in the
  foreground — that's an OS rule, not a portal limitation.

## Why not more than this?
Genuine always-listening on a phone is reserved for the OS assistant (Siri) and a few
system-level apps. Anything claiming a third-party web page can wake itself on iPhone
while closed is misleading. The Shortcut gives you a one-phrase launch, which is the
real, reliable version.

---

# Desktop (Mac / Windows) — background wake word

For a true "say Jarvis and it pops up" experience on a computer, use the Electron
skeleton in `desktop/main.js`:

1. `cd desktop && npm init -y`
2. `npm install electron @picovoice/porcupine-node @picovoice/pvrecorder-node`
3. Get a free Picovoice access key at https://console.picovoice.ai and wire it into the
   `startWakeWord()` stub (Porcupine has a built-in "Jarvis" keyword).
4. Set `JARVIS_URL` to your portal, then `npx electron .`.
5. Use the tray menu's **Launch at login** so it's always ready. Wake-word audio is
   processed locally; only your actual command is sent onward.

Until Porcupine is wired, the app still runs in the tray and opens on **Cmd/Ctrl+Shift+J**.
