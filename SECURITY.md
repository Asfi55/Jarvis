# Security notes

## Keys never touch the browser
`ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` are read from server environment
variables in `server.js` and used only in server-to-server calls. They are not sent to
the page, not stored in `localStorage`, and not present in any client file. Keep `.env`
out of version control (add it to `.gitignore`).

> Legacy exception: the ⚙ Settings panel still offers an *optional* browser-side
> ElevenLabs key as a fallback for people who open the raw HTML with no backend. For a
> real deployment, leave that blank and set `ELEVENLABS_API_KEY` on the backend instead,
> so voice runs server-side.

## What the backend will and won't do
- **Will:** answer questions, search the public web via Claude's tool, proxy voice, and
  return drafts.
- **Won't:** send customer messages, change adverts or prices, mark cars sold/reserved,
  move money, or take any external action. The system prompt forbids claiming these were
  done, and there is no code path that performs them. High-risk actions must be carried
  out by you in the live systems — Jarvis only prepares and asks for confirmation.

## Confidential dealership data
Purchase/trade price, prep cost, minimum price, margin and profit are passed to Claude
only as owner-facing context, clearly labelled `[CONFIDENTIAL]`, and the prompt bars
Jarvis from surfacing them in any customer-facing draft. Only the vehicle records
relevant to the current question are sent — never the whole database on every request.

## Prompt-injection defence
Web pages and search results are treated as untrusted data. The system prompt instructs
Jarvis that instructions found in fetched content never override its rules. It does not
enter credentials, bypass logins/CAPTCHA/2FA, or act on instructions embedded in results.

## Rate limiting
A simple per-IP limiter (30 requests/minute) is built in to blunt runaway usage and
accidental loops. For production behind a shared IP, swap it for a per-session or Redis
limiter.

## Transport & origin
Deploy behind HTTPS (Render/Railway/Fly all provide it). Set `ALLOWED_ORIGIN` to your
real domain so other sites can't call your backend from a browser. The API key still
protects you server-side regardless.

## Logging
Errors are logged without dumping customer data. Don't add verbose request logging that
records message contents in production.
