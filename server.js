/* ============================================================================
   J.A.R.V.I.S — GoDrive Autos  ·  Secure backend
   ----------------------------------------------------------------------------
   Provides:
     POST /api/jarvis/chat    → Claude (Anthropic) with optional live web search
     POST /api/jarvis/speak   → ElevenLabs text-to-speech proxy (optional)
     GET  /api/jarvis/health  → capability report (what is actually connected)

   The Anthropic and ElevenLabs keys live ONLY on the server, in environment
   variables. They are never sent to the browser.

   Node 18+ required (uses global fetch).
   ========================================================================== */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  ANTHROPIC_API_KEY,
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID = "onwK4e9ZLuTAKqWW03F9", // Daniel (British) default
  JARVIS_MODEL = "claude-sonnet-5",
  PORT = 8787,
  ALLOWED_ORIGIN = "*",
} = process.env;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ *
 * Very small in-memory rate limiter (per IP). Swap for Redis in prod. *
 * ------------------------------------------------------------------ */
const BUCKET = new Map();
const LIMIT = 30; // requests
const WINDOW_MS = 60_000; // per minute
function rateLimited(ip) {
  const now = Date.now();
  const rec = BUCKET.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
  rec.count++;
  BUCKET.set(ip, rec);
  return rec.count > LIMIT;
}

/* ------------------------------------------------------------------ *
 * System prompt. The dealership rules stay in force; general          *
 * conversation + research mode is added on top.                       *
 * ------------------------------------------------------------------ */
const SYSTEM_PROMPT = `You are Jarvis, the private AI General Manager and general conversational assistant for GoDrive Autos, an independent UK used-car dealership. You are speaking with the owner, Asfandyar Khan — address him as "Mr Khan", naturally and not in every sentence.

VOICE & PERSONALITY
- Natural, calm, intelligent, confident, warm but professional. British English.
- Concise by default; more detail for important business decisions.
- Answer the question directly first. Admit uncertainty honestly. Never robotic.
- Do not repeatedly say "How may I assist you?".

WHAT YOU CAN BE
You are BOTH a general assistant and the dealership's GM. Do NOT force every question into a vehicle/dealership frame. First decide what the request is: casual conversation, general knowledge, current public information, a GoDrive vehicle question, a dealership operations question, an external browser action, or a sensitive action needing confirmation — then respond accordingly. Greetings, jokes, explanations, brainstorming and everyday questions should be answered naturally.

DEALERSHIP DATA IS GROUND TRUTH
When the message includes a VERIFIED STOCK CONTEXT block, treat it as the source of truth for that vehicle. Answer from it. Do not overwrite it with anything from the web. If a field is missing or two records conflict, say so plainly rather than guessing. Never invent a vehicle's features, history, condition, mileage, price or availability.

CONFIDENTIALITY
Purchase price, trade price, total cost, prep cost, minimum price, margin and net/gross profit are confidential. You may share them with Mr Khan (the owner) when he asks. Never phrase them as something to tell a customer, and never expose them in customer-facing drafts.

WEB / CURRENT INFORMATION
You have a live web_search tool. Use it only when the question needs current or external information (news, weather, today's prices, current office-holders, live market values, latest rules). When you use it, base your answer on the results and make clear the information came from the web, not from GoDrive records. If a search returns nothing useful, say so — do not fill the gap with guesses. For settled general knowledge, just answer; you needn't search.

ACTIONS vs INFORMATION
You may freely: answer questions, read the supplied records, search approved public sources, do calculations, and draft messages/adverts for review. You must NOT claim to have sent a message, changed an advert or price, marked a car sold/reserved, published content, moved money, or completed any external action — this backend cannot perform those. When Mr Khan asks for such a thing, prepare it and end with a clear confirmation request in the form: "Please confirm: do you want me to [exact action]?" — and note that the action itself has to be carried out in the live system, since you can draft but not execute it here.

HONESTY ABOUT CAPABILITY
Never claim an integration, search, browser session or action succeeded when it did not. If something isn't connected, say what's missing and what would be needed. You can read and reason; you cannot open AutoTrader, send WhatsApp/email, or edit listings from here.

FOLLOW-UPS
Keep the recent conversation in mind so natural follow-ups ("what about tomorrow?", "open the second one", "tell me more") work.`;

/* ------------------------------------------------------------------ *
 * Chat endpoint                                                       *
 * ------------------------------------------------------------------ */
app.post("/api/jarvis/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "rate_limited", message: "Too many requests — give me a moment, Mr Khan." });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "no_api_key",
      message: "The Claude connection isn't configured. Set ANTHROPIC_API_KEY on the server and restart.",
    });
  }

  const { message, history = [], vehicleContext = null, allowWeb = true } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "bad_request", message: "No message received." });
  }

  // Build the message list. Only recent history is kept (last 12 turns).
  const trimmed = Array.isArray(history) ? history.slice(-12) : [];
  const messages = trimmed
    .filter(m => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map(m => ({ role: m.role, content: String(m.content) }));

  // Attach verified stock context (only the records the frontend judged relevant).
  let userContent = message;
  if (vehicleContext && String(vehicleContext).trim()) {
    userContent =
      `VERIFIED STOCK CONTEXT (GoDrive internal records — ground truth):\n${vehicleContext}\n\n` +
      `Mr Khan asks: ${message}`;
  }
  messages.push({ role: "user", content: userContent });

  const body = {
    model: JARVIS_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  };
  if (allowWeb) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Anthropic error", r.status, detail.slice(0, 300));
      return res.status(502).json({
        error: "upstream",
        message: `Claude returned an error (${r.status}). I haven't guessed an answer.`,
      });
    }

    const data = await r.json();

    // Assemble final text and collect any web-search citations as sources.
    let text = "";
    const sources = [];
    const seen = new Set();
    let usedWeb = false;

    for (const block of data.content || []) {
      if (block.type === "text") {
        text += block.text;
        for (const c of block.citations || []) {
          if (c.url && !seen.has(c.url)) {
            seen.add(c.url);
            sources.push({ title: c.title || c.url, url: c.url });
          }
        }
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        usedWeb = true;
      } else if (block.type === "web_search_tool_result") {
        usedWeb = true;
      }
    }

    res.json({
      text: text.trim() || "I don't have an answer for that, Mr Khan.",
      sources,
      usedWeb,
      usedStock: !!vehicleContext,
      model: JARVIS_MODEL,
    });
  } catch (err) {
    console.error("chat failure:", err.message);
    res.status(500).json({ error: "server", message: "Something went wrong reaching Claude. Nothing was fabricated." });
  }
});

/* ------------------------------------------------------------------ *
 * Text-to-speech proxy (optional). Falls back client-side if 501.     *
 * ------------------------------------------------------------------ */
app.post("/api/jarvis/speak", async (req, res) => {
  if (!ELEVENLABS_API_KEY) {
    return res.status(501).json({ error: "no_tts", message: "ElevenLabs not configured — using browser voice." });
  }
  const { text, voiceId } = req.body || {};
  if (!text) return res.status(400).json({ error: "bad_request" });
  try {
    const vid = voiceId || ELEVENLABS_VOICE_ID;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!r.ok) {
      return res.status(502).json({ error: "tts_upstream", message: `ElevenLabs error ${r.status}.` });
    }
    res.setHeader("content-type", "audio/mpeg");
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.error("tts failure:", err.message);
    res.status(500).json({ error: "server" });
  }
});

/* ------------------------------------------------------------------ *
 * Health / capability report — the frontend uses this to show, truth- *
 * fully, what is actually available.                                  *
 * ------------------------------------------------------------------ */
app.get("/api/jarvis/health", (_req, res) => {
  res.json({
    ok: true,
    claude: !!ANTHROPIC_API_KEY,
    webSearch: !!ANTHROPIC_API_KEY, // web search runs through the same key
    elevenlabs: !!ELEVENLABS_API_KEY,
    model: JARVIS_MODEL,
  });
});

app.listen(PORT, () => {
  console.log(`\nJarvis backend on http://localhost:${PORT}`);
  console.log(`  Claude:     ${ANTHROPIC_API_KEY ? "connected" : "NOT configured (set ANTHROPIC_API_KEY)"}`);
  console.log(`  ElevenLabs: ${ELEVENLABS_API_KEY ? "connected" : "not set (browser voice fallback)"}`);
  console.log(`  Model:      ${JARVIS_MODEL}\n`);
});
