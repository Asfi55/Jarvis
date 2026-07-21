# J.A.R.V.I.S — GoDrive Autos (v2)

Your stock dashboard is now a conversational AI assistant. It keeps every existing
feature — stock, ads, G3 watchlist, sold, leads, costs, MOT alerts, the arc-reactor
briefing — and adds:

- **Real conversation** through Claude (greetings, questions, brainstorming, jokes).
- **Live web search** for current things (news, weather, today's prices, who holds an office).
- **Wake word** — say "Jarvis" (or "Wake up, Jarvis") and talk, hands-free, while the page is open.
- **Grounded stock answers** — vehicle questions are answered from your verified records, not the internet.
- **Honest limits** — it never claims a connection, search or action happened when it didn't.

The API keys live only on a small backend you run. They are never put in the web page.

---

## What's in the box

```
jarvis-portal/
├── public/index.html      ← the upgraded portal (frontend)
├── server.js              ← secure backend: Claude chat + web search + voice proxy
├── package.json           ← dependencies + start scripts
├── .env.example           ← copy to .env and add your key
├── README.md              ← this file
├── SECURITY.md            ← what's protected and how
├── TEST-CHECKLIST.md      ← the 14 test commands + what to expect
├── JARVIS-SYSTEM-PROMPT-ADDITION.md
└── desktop/               ← optional Electron wrapper for a real "Hey Siri"-style launch
```

---

## Setup (about 5 minutes)

You need **Node.js 18 or newer** (check with `node -v`). Get it from https://nodejs.org.

**1. Install dependencies**
```bash
cd jarvis-portal
npm install
```

**2. Add your Anthropic key**
```bash
cp .env.example .env
```
Open `.env` and paste your key after `ANTHROPIC_API_KEY=`. Get one at
https://console.anthropic.com. (ElevenLabs is optional — leave it blank to use the
free browser voice.)

**3. Start the backend**
```bash
npm start
```
You'll see:
```
Jarvis backend on http://localhost:8787
  Claude:     connected
  ...
```

**4. Open the portal**
Go to **http://localhost:8787** in your browser. Because the backend also serves the
page, everything is wired up automatically.

**5. Test the connection**
Type "How are you?" in the Jarvis tab. A spoken/written reply means Claude is live.
The capability line under the chat shows exactly what's connected.

---

## Deploying it so it's always on (and works on your phone)

Running on your laptop only works while the laptop is on. To reach Jarvis from your
iPhone in Safari, host the backend on a small always-on service. Free tiers work fine:

**Render (recommended, no card for the free tier)**
1. Put this folder in a GitHub repo.
2. On https://render.com → New → Web Service → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Add an environment variable `ANTHROPIC_API_KEY` (and optionally `ELEVENLABS_API_KEY`).
5. Deploy. You get a URL like `https://jarvis-godrive.onrender.com`.
6. Open that URL in Safari → Share → **Add to Home Screen**. You now have a Jarvis app icon.

Railway, Fly.io and a small VPS work the same way. Set `ALLOWED_ORIGIN` to your final
URL once you're live.

> Note on cost: each conversation calls the Claude API, which is billed to your
> Anthropic account (usage-based). Web search has a small per-search cost. Keep an eye
> on the usage dashboard in the Anthropic console.

---

## Wake word — what's real and what isn't

Say **"Jarvis"** with wake word switched on and the portal replies "Yes, Mr Khan.
I'm listening," then takes your command. This uses the browser's built-in speech
recognition and is honest about three hard limits:

1. **It only works while the portal page is open and in the foreground.** A web page
   cannot listen after the browser or phone is closed — the operating system forbids it.
2. **It needs microphone permission** (you'll be asked once) and a supported browser
   (Chrome, Edge, or Safari).
3. **On iPhone**, background listening isn't possible for any web page. See below for
   the closest supported alternative.

While Jarvis is speaking, the mic is paused so it doesn't hear its own voice; it resumes
right after. Tapping the mic button interrupts and lets you talk over it.

### If you want true always-on "Hey Siri"-style wake

That requires a small app that runs in the background, not a web page. Two supported routes:

- **Mac / Windows desktop:** the `desktop/` folder contains an Electron wrapper skeleton
  and instructions to add a proper local wake-word engine (Picovoice Porcupine). It can
  launch at login and pop the Jarvis window on the wake word. This keeps wake-word audio
  **on your machine** — only the actual command is sent onward.
- **iPhone / iPad:** a web page can't be Siri. The realistic version is a **Siri
  Shortcut**: say "Hey Siri, open Jarvis" and it launches the Home-Screen web app, then
  you talk. Create it in the Shortcuts app → New Shortcut → "Open URL" → your Jarvis URL
  → rename it "Jarvis". See `desktop/SIRI-SHORTCUT.md`.

The web version does not pretend to be more than it is.

---

## Everyday use

- **Type or talk.** Type in the Jarvis tab, or tap the mic, or turn on wake word.
- **Web search** is on by default (toggle it off to keep answers offline/faster). Jarvis
  only actually searches when a question needs current info.
- **Stock questions** ("MOT on the Seat Leon", "profit in the BMW") open the matching
  vehicle on screen and answer from your records, with a green "GoDrive record" tag.
- **Web answers** carry an amber "Live web" tag and their sources.
- **New chat** clears the conversation memory. **Stop speaking** halts the voice.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Claude brain offline" | Backend isn't running or the URL is wrong. Run `npm start`; or set the backend URL in ⚙ Settings. |
| "set ANTHROPIC_API_KEY" | The key is missing from `.env`. Add it and restart. |
| Mic does nothing | Permission denied or unsupported browser. Allow the mic; use Chrome/Edge/Safari. |
| No voice, just text | No ElevenLabs key → browser voice is used. That's expected. Some browsers need one tap before they'll speak. |
| Works on laptop, not phone | You need to deploy it (see above) so it has a public https URL. |

See `TEST-CHECKLIST.md` for the full command-by-command expected behaviour.
