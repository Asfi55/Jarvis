/* ============================================================================
   J.A.R.V.I.S — GoDrive Autos  ·  Secure backend
   ----------------------------------------------------------------------------
   Provides:
     POST /api/jarvis/chat            → Claude, with web search + (optional) Gmail read tools
     POST /api/jarvis/speak           → ElevenLabs text-to-speech proxy (optional)
     GET  /api/jarvis/health          → capability report (what is actually connected)
     GET  /api/jarvis/gmail/connect   → starts Gmail OAuth (read-only)
     GET  /api/jarvis/gmail/callback  → finishes OAuth, shows the refresh token once

   All API keys and tokens live ONLY on the server, in environment variables.
   They are never sent to the browser as part of normal app traffic.

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
  // Gmail (read-only). See README for the Google Cloud Console setup steps.
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI, // optional override; otherwise derived from the request
  GOOGLE_REFRESH_TOKEN, // pasted in after the one-time /gmail/connect flow
} = process.env;

const GMAIL_CONFIGURED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const GMAIL_CONNECTED = !!(GMAIL_CONFIGURED && GOOGLE_REFRESH_TOKEN);
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const app = express();
app.set("trust proxy", true); // Render sits behind a proxy; needed for correct proto/host + client IP
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
 * conversation + research mode + (optional) Gmail read is added.      *
 * ------------------------------------------------------------------ */
function buildSystemPrompt() {
  let p = `You are Jarvis, the private AI General Manager and general conversational assistant for GoDrive Autos, an independent UK used-car dealership. You are speaking with the owner, Asfandyar Khan — address him as "Mr Khan", naturally and not in every sentence.

VOICE & PERSONALITY
- Natural, calm, intelligent, confident, warm but professional. British English.
- Concise by default; more detail for important business decisions.
- Answer the question directly first. Admit uncertainty honestly. Never robotic.
- Do not repeatedly say "How may I assist you?".

WHAT YOU CAN BE
You are BOTH a general assistant and the dealership's GM. Do NOT force every question into a vehicle/dealership frame. First decide what the request is: casual conversation, general knowledge, current public information, a GoDrive vehicle question, a dealership operations question, an email question, an external browser action, or a sensitive action needing confirmation — then respond accordingly. Greetings, jokes, explanations, brainstorming and everyday questions should be answered naturally.

DEALERSHIP DATA IS GROUND TRUTH
When the message includes a VERIFIED STOCK CONTEXT block, treat it as the source of truth for that vehicle. Answer from it. Do not overwrite it with anything from the web. If a field is missing or two records conflict, say so plainly rather than guessing. Never invent a vehicle's features, history, condition, mileage, price or availability.

CONFIDENTIALITY
Purchase price, trade price, total cost, prep cost, minimum price, margin and net/gross profit are confidential. You may share them with Mr Khan (the owner) when he asks. Never phrase them as something to tell a customer, and never expose them in customer-facing drafts.

WEB / CURRENT INFORMATION
You have a live web_search tool. Use it only when the question needs current or external information (news, weather, today's prices, current office-holders, live market values, latest rules). When you use it, base your answer on the results and make clear the information came from the web, not from GoDrive records. If a search returns nothing useful, say so — do not fill the gap with guesses. For settled general knowledge, just answer; you needn't search.

ACTIONS vs INFORMATION
You may freely: answer questions, read the supplied records, search approved public sources, do calculations, and draft messages/adverts for review. You must NOT claim to have sent a message, changed an advert or price, marked a car sold/reserved, published content, moved money, or completed any external action — this backend cannot perform those. When Mr Khan asks for such a thing, prepare it and end with a clear confirmation request in the form: "Please confirm: do you want me to [exact action]?" — and note that the action itself has to be carried out in the live system, since you can draft but not execute it here.

HONESTY ABOUT CAPABILITY
Never claim an integration, search, browser session or action succeeded when it did not. If something isn't connected, say what's missing and what would be needed. You cannot open AutoTrader, send WhatsApp, send email, or edit listings from here — you can only read and reason.

FOLLOW-UPS
Keep the recent conversation in mind so natural follow-ups ("what about tomorrow?", "open the second one", "tell me more") work.`;

  if (GMAIL_CONNECTED) {
    p += `\n\nGMAIL (READ-ONLY)
You have search_gmail and read_gmail_message tools connected to Mr Khan's Gmail inbox, read-only. Use them when he asks about emails, leads, or messages from customers or AutoTrader. Important honesty boundary: AutoTrader notification emails are often just a preview — you can only see what is actually in the Gmail message, not the full lead inside the AutoTrader portal itself, since you have no browser access. Say so plainly rather than presenting a preview as the complete lead. You cannot send, reply to, label, delete or archive email — only read it. If asked to reply, draft the message text for Mr Khan to send himself, or note that sending isn't available here yet.`;
  } else {
    p += `\n\nGMAIL
Gmail is not connected yet. If asked about email, say so plainly and that it needs to be connected first — do not invent inbox contents.`;
  }
  return p;
}

/* ------------------------------------------------------------------ *
 * Gmail OAuth (read-only) — stateless: the refresh token is stored     *
 * as a Render environment variable, not on disk, so it survives        *
 * redeploys and free-tier spin-downs without a database.               *
 * ------------------------------------------------------------------ */
function redirectUri(req) {
  if (GOOGLE_REDIRECT_URI) return GOOGLE_REDIRECT_URI;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}/api/jarvis/gmail/callback`;
}

app.get("/api/jarvis/gmail/connect", (req, res) => {
  if (!GMAIL_CONFIGURED) {
    return res.status(503).send(htmlPage("Gmail isn't configured yet",
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first, then reload this link."));
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // forces a refresh_token every time, so reconnecting always works
    scope: GMAIL_SCOPE,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/jarvis/gmail/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(htmlPage("Gmail connection cancelled", `Google reported: ${escapeHtml(error)}`));
  if (!code) return res.status(400).send(htmlPage("Missing code", "No authorisation code was returned by Google."));

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.refresh_token) {
      console.error("Gmail token exchange failed:", data);
      return res.status(502).send(htmlPage("Couldn't finish connecting Gmail",
        `Google didn't return a refresh token. This usually means you've connected once before — go to <a href="https://myaccount.google.com/permissions" target="_blank">Google Account → Security → Third-party access</a>, remove "Jarvis", and try connecting again.`));
    }
    res.send(htmlPage("Gmail connected — one more step",
      `Copy the refresh token below and add it to Render as an environment variable named <code>GOOGLE_REFRESH_TOKEN</code>, then save (Render will redeploy automatically).
      <div style="margin:18px 0;padding:14px;background:#0b1a26;border:1px solid #17d1ff55;border-radius:8px;word-break:break-all;font-family:monospace;color:#7deeff;">${escapeHtml(data.refresh_token)}</div>
      <p>This token is shown once. If you lose it, just connect again from Jarvis.</p>`));
  } catch (err) {
    console.error("Gmail callback error:", err.message);
    res.status(500).send(htmlPage("Something went wrong", "The token exchange failed. Nothing was saved."));
  }
});

function htmlPage(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>body{background:#02070f;color:#cfeeff;font-family:-apple-system,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.6}
  h1{color:#7deeff;font-size:20px}a{color:#17d1ff}code{background:#0b1a26;padding:2px 6px;border-radius:4px}</style></head>
  <body><h1>${escapeHtml(title)}</h1><div>${bodyHtml}</div>
  <p style="margin-top:30px"><a href="/">← Back to Jarvis</a></p></body></html>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

/* ------------------------------------------------------------------ *
 * Gmail API helpers (read-only). Access tokens are minted on demand    *
 * from the refresh token and cached in memory for their short life.    *
 * ------------------------------------------------------------------ */
let cachedAccessToken = null, cachedExpiry = 0;
async function getGmailAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiry - 30_000) return cachedAccessToken;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Gmail token refresh failed: ${data.error || r.status}`);
  cachedAccessToken = data.access_token;
  cachedExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function headerVal(headers, name) {
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}
function decodeBase64Url(s) {
  return Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function extractPlainText(payload, depth = 0) {
  if (!payload || depth > 6) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      const t = extractPlainText(part, depth + 1);
      if (t) return t;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

async function gmailSearch(query, maxResults = 8) {
  const token = await getGmailAccessToken();
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(maxResults, 15)) })}`;
  const listRes = await fetch(listUrl, { headers: { authorization: `Bearer ${token}` } });
  const listData = await listRes.json();
  if (!listRes.ok) throw new Error(listData.error?.message || `Gmail search failed (${listRes.status})`);
  const ids = (listData.messages || []).map(m => m.id);
  const results = [];
  for (const id of ids) {
    const mRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const m = await mRes.json();
    if (!mRes.ok) continue;
    results.push({
      id: m.id,
      from: headerVal(m.payload?.headers, "From"),
      subject: headerVal(m.payload?.headers, "Subject"),
      date: headerVal(m.payload?.headers, "Date"),
      snippet: m.snippet || "",
    });
  }
  return results;
}

async function gmailGetMessage(id) {
  const token = await getGmailAccessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const m = await r.json();
  if (!r.ok) throw new Error(m.error?.message || `Gmail read failed (${r.status})`);
  const body = extractPlainText(m.payload).slice(0, 6000); // keep context sane
  return {
    id: m.id,
    from: headerVal(m.payload?.headers, "From"),
    to: headerVal(m.payload?.headers, "To"),
    subject: headerVal(m.payload?.headers, "Subject"),
    date: headerVal(m.payload?.headers, "Date"),
    body: body || "(no readable text content — may be an image-only or unusual message)",
  };
}

/* ------------------------------------------------------------------ *
 * Chat endpoint — Claude, with web search + (optional) Gmail tools,    *
 * using a short multi-round tool-use loop for the custom Gmail tools.  *
 * ------------------------------------------------------------------ */
const GMAIL_TOOLS = [
  {
    name: "search_gmail",
    description: "Search Mr Khan's Gmail inbox (read-only). Use Gmail search syntax, e.g. 'from:autotrader newer_than:7d' or 'subject:enquiry'. Returns a short list of matching messages with id, from, subject, date and a snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "integer", description: "Max messages to return, default 8" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_gmail_message",
    description: "Read the full text of one Gmail message by id (read-only). Use after search_gmail to get complete content.",
    input_schema: {
      type: "object",
      properties: { message_id: { type: "string", description: "The Gmail message id from search_gmail results" } },
      required: ["message_id"],
    },
  },
];

async function callClaude(messages, allowWeb) {
  const tools = [];
  if (allowWeb) tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
  if (GMAIL_CONNECTED) tools.push(...GMAIL_TOOLS);

  const body = { model: JARVIS_MODEL, max_tokens: 1024, system: buildSystemPrompt(), messages };
  if (tools.length) body.tools = tools;

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
    const err = new Error(`Claude returned an error (${r.status})`);
    err.status = 502;
    throw err;
  }
  return r.json();
}

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

  const trimmed = Array.isArray(history) ? history.slice(-12) : [];
  const messages = trimmed
    .filter(m => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map(m => ({ role: m.role, content: String(m.content) }));

  let userContent = message;
  if (vehicleContext && String(vehicleContext).trim()) {
    userContent =
      `VERIFIED STOCK CONTEXT (GoDrive internal records — ground truth):\n${vehicleContext}\n\n` +
      `Mr Khan asks: ${message}`;
  }
  messages.push({ role: "user", content: userContent });

  try {
    let text = "";
    const sources = [];
    const seen = new Set();
    let usedWeb = false;
    let usedGmail = false;

    // Tool-use loop: up to 4 rounds so Claude can search then read a message.
    for (let round = 0; round < 4; round++) {
      const data = await callClaude(messages, allowWeb);
      const customToolCalls = [];

      for (const block of data.content || []) {
        if (block.type === "text") {
          text += block.text;
          for (const c of block.citations || []) {
            if (c.url && !seen.has(c.url)) { seen.add(c.url); sources.push({ title: c.title || c.url, url: c.url }); }
          }
        } else if (block.type === "server_tool_use" && block.name === "web_search") {
          usedWeb = true;
        } else if (block.type === "web_search_tool_result") {
          usedWeb = true;
        } else if (block.type === "tool_use" && (block.name === "search_gmail" || block.name === "read_gmail_message")) {
          customToolCalls.push(block);
        }
      }

      if (!customToolCalls.length) break; // done — no more tools requested

      usedGmail = true;
      messages.push({ role: "assistant", content: data.content });
      const toolResults = [];
      for (const call of customToolCalls) {
        let resultText;
        try {
          if (call.name === "search_gmail") {
            const found = await gmailSearch(call.input.query, call.input.max_results || 8);
            resultText = found.length
              ? JSON.stringify(found, null, 2)
              : "No matching messages found.";
          } else {
            const msg = await gmailGetMessage(call.input.message_id);
            resultText = JSON.stringify(msg, null, 2);
          }
        } catch (err) {
          resultText = `Gmail error: ${err.message}`;
        }
        toolResults.push({ type: "tool_result", tool_use_id: call.id, content: resultText });
      }
      messages.push({ role: "user", content: toolResults });
    }

    res.json({
      text: text.trim() || "I don't have an answer for that, Mr Khan.",
      sources,
      usedWeb,
      usedGmail,
      usedStock: !!vehicleContext,
      model: JARVIS_MODEL,
    });
  } catch (err) {
    console.error("chat failure:", err.message);
    res.status(err.status || 500).json({ error: "server", message: err.message?.startsWith("Claude returned") ? err.message + ". I haven't guessed an answer." : "Something went wrong. Nothing was fabricated." });
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
    webSearch: !!ANTHROPIC_API_KEY,
    elevenlabs: !!ELEVENLABS_API_KEY,
    gmailConfigured: GMAIL_CONFIGURED,
    gmailConnected: GMAIL_CONNECTED,
    model: JARVIS_MODEL,
  });
});

app.listen(PORT, () => {
  console.log(`\nJarvis backend on http://localhost:${PORT}`);
  console.log(`  Claude:     ${ANTHROPIC_API_KEY ? "connected" : "NOT configured (set ANTHROPIC_API_KEY)"}`);
  console.log(`  ElevenLabs: ${ELEVENLABS_API_KEY ? "connected" : "not set (browser voice fallback)"}`);
  console.log(`  Gmail:      ${GMAIL_CONNECTED ? "connected (read-only)" : GMAIL_CONFIGURED ? "configured, not yet connected — visit /api/jarvis/gmail/connect" : "not configured"}`);
  console.log(`  Model:      ${JARVIS_MODEL}\n`);
});
