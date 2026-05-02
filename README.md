```markdown

# Adversary

A multi-agent debate engine for startup ideas. 14 specialist agents argue your pitch — 7 attackers, 7 defenders — then a Synthesizer renders the verdict.

**7 attackers. 7 defenders. 1 verdict. Drop your pitch.**

Built on Hermes Agent + Kimi K2.5 + Tempo (Moderato testnet) for the Nous Research Creative Hackathon, May 2026.

---

## What it does

You drop your pitch, plan, or product spec. 14 agents fight over it across 7 lanes:

| Lane | Attacker | Defender |
|------|----------|----------|
| Demand | Skeptic | Believer |
| Unit Economics | Accountant | Engineer |
| Competition | Incumbent | Strategist |
| Distribution | Distribution | Operator |
| Defensibility | Moat | Architect |
| Market Timing | Timing | Builder |
| Regulatory | Regulatory | Counsel |

Each attacker stays strictly in lane and produces a structured KILLSHOT schema with evidence quotes from the artifact and a severity score. The paired defender rebuts with a structured DEFENSE schema. A 15th agent the Synthesizer reads all 14 outputs and renders the verdict: **KILL, PAUSE, or SHIP** alongside surviving risks, defended strengths, cruxes to validate, and the questions an investor will ask on Monday.

## Why this needed Hermes + Kimi

**Hermes Agent's skill system is the architecture.** Each agent is its own `SKILL.md` with hard lane constraints. The Accountant literally cannot talk about moat. The Skeptic literally cannot talk about regulatory. Without skill-level constraints, every agent drifts toward generic startup advice. With skills, agents stay sharp. That's the difference between real debate and one model wearing 14 hats badly.

**Kimi K2.5 was the right model for the Synthesizer.** It has to hold all 14 prior agent outputs (tens of thousands of tokens of structured argument) plus the original artifact, and produce a coherent verdict that references specific claims by lane. Shorter-context models truncate or hallucinate citations. K2.5 reasons across the entire debate state. Reports translate cleanly into 8 languages (Hindi, Japanese, Mandarin, Spanish, French, Arabic, Russian, Indonesian) using K2.5 streaming, which preserves technical terms (CAC, LTV, JTBD) inline.

## Real on-chain payments

Every debate is **$1 in pathUSD** paid on Tempo Moderato testnet. Every translation is **$0.10**. Real wallet signature, real settlement, single-use payment tokens enforced server-side. Each completed report writes a sha256 attestation on-chain so the verdict is tamper-evident — you can't quietly edit a report after the fact. None of this is mocked.

## Architecture

- **Frontend** (this repo): Vite + React 18, wagmi + viem for wallet
  - `Landing` — paste pitch, connect wallet, run debate or 60s replay
  - `Processing` — 15 cinematic agent cards, live-streamed via SSE
  - `Report` — verdict, sections, multilingual translation, PDF export
  - `MyReports` — every debate paid for by your wallet
  - `PaymentModal` — Tempo wallet → pathUSD transfer → backend verify
- **Backend** (FastAPI on DigitalOcean droplet):
  - `POST /pay-and-run` → verifies tx, mints single-use payment token
  - `POST /debate-fast` → parallel SSE stream (~3-5 min, payment-gated)
  - `POST /translate/{id}?lang=ja` → streaming translation (payment-gated)
  - `POST /attest/{id}` → writes sha256 attestation on Tempo
  - `GET /my-attacks?wallet=0x...` → user's debate history
  - `GET /stream-replay/{id}` → cinematic replay of completed debate

The frontend uses `fetch()` + `ReadableStream` (not `EventSource`) because payment-gated POST endpoints require both a body and an `X-Payment-Token` header.

## Tech stack

- **Hermes Agent v0.11.0** — agent orchestration via SKILL.md
- **Kimi K2.5** — all 15 agents + 8-language translation
- **Tempo Moderato testnet** — pathUSD payments + on-chain attestation
- **wagmi/tempo + viem** — wallet integration
- **FastAPI** — backend with SSE streaming
- **Supabase** — Postgres for attacks, agent_outputs, translations, used_payments
- **Vite + React** — frontend, dark/light mode toggle
- **WeasyPrint** — multilingual PDF rendering with fontconfig (Devanagari, CJK, Arabic)

## Run locally

```bash
# Frontend
npm install
npm run dev
# open http://localhost:5173

# Backend (separate machine, see api/ directory for FastAPI app)
cd api
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
```

You'll need:
- A Tempo wallet (testnet) connected for payments
- Kimi/Moonshot API key (`MOONSHOT_API_KEY`)
- Supabase project + service key
- Tempo testnet wallet for the treasury and attestation roles

## Project layout

```
adversary/
├── api/                       # FastAPI backend (deployed separately)
│   ├── server.py              # main app, payment gating, endpoints
│   ├── parallel.py            # parallel agent orchestration (semaphore=4)
│   ├── tempo_payments.py      # on-chain payment verification
│   ├── tempo_attestation.py   # sha256 attestation on Tempo
│   └── pdf_gen.py             # multilingual PDF rendering
├── skills/                    # 15 SKILL.md agent specs
│   ├── attacker-skeptic/
│   ├── defender-believer/
│   └── ... (13 more)
├── src/                       # Vite + React frontend
│   ├── App.jsx                # state-driven router
│   ├── components/            # Landing, Processing, Report, MyReports, PaymentModal
│   ├── lib/
│   │   ├── wagmi.js           # Tempo Moderato chain config
│   │   ├── paymentFlow.js     # wallet → tx → backend verify
│   │   └── debate.js          # SSE handling, fetchAttack, synthesizer parser
│   └── styles.css             # design system, light/dark mode
└── README.md
```

## Synthesizer output schema

The Synthesizer produces structured plain text. The parser in `lib/debate.js` extracts:

- `VERDICT:` (KILL, PAUSE, or SHIP)
- `SURVIVING KILL-SHOT RISKS (ranked):` (numbered list)
- `DEFENDED STRENGTHS:` (numbered list)
- `CRUXES (validate this week):` (numbered list)
- `FOUNDER MUST ANSWER BY MONDAY:` (numbered list)
- `SOURCES CITED ACROSS DEBATE:` (number)
- `ON-CHAIN ATTESTATION:` (Tempo tx hash)

## What's next

- **Pluggable skill packs.** A Legal Review pack (employment, IP, securities), a Clinical Trial pack for biotech founders, a GTM-only mode for marketers. Adding a new pack is dropping 7 new `SKILL.md` files in.
- **Agent-to-agent debates over Tempo MPP.** Right now humans pay to run debates. The next step is letting agents pay each other directly via Tempo's Machine Payments Protocol — investor agents stress-testing portfolio companies, founder agents pre-validating decks before sending to humans.

## Built on

[Hermes Agent](https://github.com/NousResearch) + [Kimi K2.5](https://platform.moonshot.ai/) + [Tempo](https://tempo.xyz/)

```