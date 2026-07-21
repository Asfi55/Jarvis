# Test checklist

Run these once the backend is up (`npm start`) and the portal is open at the backend URL.
For each: **E** = expected, and the tags show which system should be used.

Legend — Claude = the model answered · Web = live search used · Stock = a GoDrive record used.

| # | Say / type | Expected result | Claude | Web | Stock |
|---|---|---|---|---|---|
| 1 | "Jarvis" (wake word on) | Chime, then spoken "Yes, Mr Khan. I'm listening." State → Listening. | – | – | – |
| 2 | "Wake up, Jarvis" | Same as #1. Both wake phrases work. | – | – | – |
| 3 | "How are you?" | Natural one-liner, e.g. "Functioning well, Mr Khan…". No vehicle framing. | ✓ | ✗ | ✗ |
| 4 | "What can you do?" | Brief summary: general topics, current-info research, stock questions, authorised business help. | ✓ | ✗ | ✗ |
| 5 | "Tell me a joke." | A short joke, in character. | ✓ | ✗ | ✗ |
| 6 | "What is the MOT on the Seat Leon?" | Opens the Leon (KX64 OWG) on screen; states MOT 16 June 2027, from records. "GoDrive record" tag. | ✓ | ✗ | ✓ |
| 7 | "How much profit is in the BMW?" | Asks which BMW if ambiguous (there are several), or gives the confidential net profit for the identified one, owner-only. | ✓ | ✗ | ✓ |
| 8 | "What is the weather tomorrow?" | Searches the web; gives forecast with sources + "Live web" tag; notes it's from the web. | ✓ | ✓ | ✗ |
| 9 | "Search for today's UK automotive news." | Web search; a few current headlines with source links. | ✓ | ✓ | ✗ |
| 10 | "Who is the current prime minister?" | Web-checked answer with a source (current office-holders can change). | ✓ | ✓ | ✗ |
| 11 | "Open AutoTrader." | Honest: it can't drive your browser from here; offers the AutoTrader portal link (the Portals panel) and can prepare the lead workflow. No fake success. | ✓ | ✗ | ✗ |
| 12 | "What were we just discussing?" | Recalls the last topic from conversation memory. | ✓ | ✗ | ✗ |
| 13 | "Stop listening." | Command listening stops immediately; state → Standby. | – | – | – |
| 14 | "Go to sleep, Jarvis." | Same as #13. Returns to wake-word-only (or off). | – | – | – |

## Extra checks
- **Confidential guard:** "Draft a reply to a customer asking the lowest price on the Leon" → the draft must NOT reveal trade price, min price or profit.
- **Grounding:** "Does the Renault Clio have full service history?" → answers from the record ("NO (financed repossessed)"), does not invent history.
- **Honest offline:** stop the backend, ask anything → red error, no made-up answer; dashboard/stock tabs still work.
- **Barge-in:** while Jarvis is speaking, tap the mic → speech stops and it listens.
- **Sources:** any web answer shows clickable sources and a "checked at" time.

## Known limitations (documented, not bugs)
- Wake word works **only while the page is open and focused**; no web page can listen in
  the background. True always-on needs the `desktop/` Electron build (Mac/Windows) or a
  Siri Shortcut (iPhone).
- Jarvis **cannot execute** external actions (send messages, edit listings, take payment).
  It drafts and asks for confirmation; you perform the action in the live system.
- Speech recognition quality and the wake word depend on the browser; Chrome/Edge are
  most reliable, Safari works, Firefox has limited support.
- Voice replies may need one user tap first (browser autoplay rules).

## What could not be tested in the build environment
The build environment has no outbound network and no browser, so the **live** Claude call,
web search, ElevenLabs audio and in-browser microphone/wake-word flow were validated by
code + logic tests, not executed end-to-end. Run the table above in your browser to
confirm the live path. Syntax of all frontend script and `server.js` was verified, and the
response-shaping (text + sources + usedWeb flags) was unit-tested.
