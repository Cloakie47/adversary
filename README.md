# Adversary

A multi-agent debate system that interrogates startup pitches.
**7 attackers. 7 defenders. 1 verdict. Drop your pitch.**

Built on Hermes Agent + Kimi K2.5 + Tempo MPP. Single-page React app, dark mode, investor-grade.

## Architecture

- **Frontend** (this repo): Vite + React 18, single-page app, three views switched by state.
  - `Landing` — paste pitch, "Run Debate" or "Run Demo (60s replay)"
  - `Processing` — 15 cinematic agent cards, live-streamed via SSE
  - `Report` — verdict + parsed sections + collapsible full debate
- **Backend** (already deployed at `http://143.110.185.142:8000`):
  - `POST /debate` → SSE stream of a real debate (~25 min)
  - `GET /stream-replay/{id}?delay_sec=4` → SSE replay of a finished debate
  - `GET /attacks/{id}` → full attack record + 15 agents

The frontend uses `fetch()` + `ReadableStream` (not `EventSource`) because POST debates require a request body, and falls back to polling `/attacks/{id}` every 10s during live runs.

## Run locally

```bash
npm install
npm run dev
# open http://localhost:5173
```

## Deploy to Vercel

```bash
npm install -g vercel
vercel deploy --prod
```

Vercel auto-detects Vite. The `vercel.json` rewrites all paths to `/` so deep-links like `/report/{attack_id}` work without a server.

Alternatively, push this repo to GitHub and import it at https://vercel.com/new — no config needed.

## Demo

The "Run Demo (60s replay)" button hits `/stream-replay/3f456848-783f-402e-b507-2079c1ca17d8?delay_sec=4` and replays a finished debate at watchable speed. Use this for the Nous Research hackathon recording.

## Project layout

```
src/
  App.jsx              # state-driven router (landing → processing → report)
  main.jsx             # ReactDOM mount
  styles.css           # full design system, dark mode, responsive
  lib/
    debate.js          # SSE handling, fetchAttack, synthesizer parser
  components/
    Landing.jsx        # paste, demo, "how it works"
    Processing.jsx     # 15-card grid, live state, reconnection, polling
    Report.jsx         # verdict, sections, collapsible full debate, share
```

## Backend contract recap

- SSE event types: `debate_started`, `agent_complete`, `debate_complete`, `keepalive` (ignored).
- `agent_name` is prefixed: `attacker-{lane}`, `defender-{role}`, or `synthesizer`.
- Synthesizer output is structured plain text. The parser in `lib/debate.js` extracts:
  - `VERDICT:` (single line)
  - `SURVIVING KILL-SHOT RISKS (ranked):` (numbered list)
  - `DEFENDED STRENGTHS:` (numbered list)
  - `CRUXES (validate this week):` (numbered list)
  - `FOUNDER MUST ANSWER BY MONDAY:` (numbered list)
  - `SOURCES CITED ACROSS DEBATE:` (number)
  - `ON-CHAIN ATTESTATION:` (string)

## Style tokens

- bg `#0a0a0a` · text `#e5e5e5` · accent `#ff3366`
- attacker `#ff3366` · defender `#3b82f6` · synthesizer `#f5f5f5`
- Sans: Inter · Mono: JetBrains Mono (verdict, badges, code)
