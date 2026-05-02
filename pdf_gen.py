"""
api/pdf_gen.py — Adversary report PDF generator.

Renders an investor-grade VC memo / sell-side research style PDF from a debate
attack record. Uses WeasyPrint for HTML+CSS → PDF.

Public surface:
    render_pdf(attack: dict, agents: list[dict], lang: str = "en") -> bytes
        Returns the PDF as bytes.

Notes for integration on the droplet:
    - Keep your existing imports + fontconfig setup at the top of this file
      (the snippet below assumes WeasyPrint is already installed and that
      a FontConfiguration with non-Latin fonts (Noto Sans CJK, Noto Sans
      Devanagari, Noto Sans Arabic, etc.) is registered system-wide).
    - The `attack` dict should contain at least: id, artifact_title, verdict,
      final_report, status. The `agents` list should be the 15 agent rows
      with agent_name, agent_role, lane, output_text, sequence_num.
    - For translated PDFs, pass the translated final_report in attack["final_report"]
      and the lang code; section headers parsed from final_report stay in English.
"""

from __future__ import annotations

import datetime as _dt
import html as _html
import re as _re
from typing import Any

from weasyprint import HTML, CSS  # noqa: F401
from weasyprint.text.fonts import FontConfiguration  # noqa: F401

# Reuse a single FontConfiguration so we don't reload fonts on every call.
# If your existing module already creates one at module scope, use that.
_FONT_CONFIG: FontConfiguration | None = None


def _font_config() -> FontConfiguration:
    global _FONT_CONFIG
    if _FONT_CONFIG is None:
        _FONT_CONFIG = FontConfiguration()
    return _FONT_CONFIG


# ---------------------------------------------------------------------------
# Synthesizer parsing (mirrors the web frontend's parseFinalReport)
# ---------------------------------------------------------------------------

_SECTION_HEADERS = [
    ("risks", "SURVIVING KILL-SHOT RISKS (ranked):"),
    ("strengths", "DEFENDED STRENGTHS:"),
    ("cruxes", "CRUXES (validate this week):"),
    ("founder", "FOUNDER MUST ANSWER BY MONDAY:"),
]
_BOUNDARY_HEADERS = [h for _, h in _SECTION_HEADERS] + [
    "SOURCES CITED ACROSS DEBATE:",
    "ON-CHAIN ATTESTATION:",
]


def _strip_code_fences(text: str) -> str:
    if not text:
        return ""
    s = text.strip()
    s = _re.sub(r"^```[a-zA-Z0-9_-]*\s*\n", "", s)
    s = _re.sub(r"\n```\s*$", "", s)
    s = _re.sub(r"^```\s*", "", s)
    s = _re.sub(r"\s*```$", "", s)
    return s


def _parse_numbered(block: str) -> list[str]:
    items: list[str] = []
    current: str | None = None
    for raw in block.splitlines():
        line = raw.rstrip()
        trimmed = line.strip()
        if not trimmed:
            if current is not None:
                items.append(current.strip())
                current = None
            continue
        m = _re.match(r"^(\d{1,9})\.\s+(.+)$", trimmed)
        if m:
            if current is not None:
                items.append(current.strip())
            current = m.group(2)
        elif current is not None:
            current += " " + trimmed
    if current is not None:
        items.append(current.strip())
    return [s for s in items if s]


def _parse_final_report(text: str) -> dict[str, Any]:
    text = _strip_code_fences(text or "")
    out: dict[str, Any] = {
        "risks": [],
        "strengths": [],
        "cruxes": [],
        "founder": [],
        "sources_cited": "0",
        "attestation": "",
    }
    if not text:
        return out
    for key, header in _SECTION_HEADERS:
        idx = text.find(header)
        if idx == -1:
            continue
        start = idx + len(header)
        end = len(text)
        for other in _BOUNDARY_HEADERS:
            if other == header:
                continue
            i = text.find(other, start)
            if i != -1 and i < end:
                end = i
        out[key] = _parse_numbered(text[start:end])
    src = _re.search(r"SOURCES CITED ACROSS DEBATE:\s*(\d+)", text)
    if src:
        out["sources_cited"] = src.group(1)
    att = _re.search(r"ON-CHAIN ATTESTATION:\s*(.+)", text)
    if att:
        out["attestation"] = att.group(1).strip()
    return out


def _verdict_class(verdict: str) -> str:
    if not verdict:
        return "amber"
    v = verdict.lower()
    if any(x in v for x in ("do not", "do-not", "kill", "reject")):
        return "red"
    if "pause" in v:
        return "amber"
    if "ship" in v:
        return "green"
    return "amber"


def _format_verdict(slug: str) -> str:
    if not slug:
        return "AWAITING SYNTHESIS"
    return slug.upper().strip()


def _truncate_hash(h: str) -> str:
    if not h or len(h) < 14:
        return h or "N/A"
    return f"{h[:8]}…{h[-6:]}"


def _agent_role(agent_name: str) -> str:
    if not agent_name:
        return "agent"
    if agent_name == "synthesizer":
        return "synthesizer"
    return agent_name.split("-", 1)[0]


def _agent_display(agent_name: str) -> str:
    if not agent_name:
        return ""
    if agent_name == "synthesizer":
        return "Synthesizer"
    sub = agent_name.split("-", 1)[1] if "-" in agent_name else agent_name
    return sub.capitalize()


# ---------------------------------------------------------------------------
# CSS template — investor-grade VC memo
# ---------------------------------------------------------------------------

_CSS_TEMPLATE = r"""
@page {
    size: Letter;
    margin: 22mm 18mm 26mm 18mm;
    @bottom-left {
        content: "Generated by Adversary on " string(gen-date)
                 " — Built on Hermes Agent + Kimi K2.5 + Tempo";
        font-family: 'Inter', sans-serif;
        font-size: 7pt;
        color: #6b6b6b;
        letter-spacing: 0.04em;
    }
    @bottom-right {
        content: counter(page) " / " counter(pages);
        font-family: 'JetBrains Mono', 'Inter', sans-serif;
        font-size: 7pt;
        color: #6b6b6b;
    }
}

@page :first {
    margin: 0;
    @bottom-left { content: ""; }
    @bottom-right { content: ""; }
}

@page exec {
    @top-right {
        content: "EXECUTIVE SUMMARY";
        font-family: 'Inter', sans-serif;
        font-size: 7pt;
        letter-spacing: 0.18em;
        color: #6b6b6b;
    }
}

:root {
    --accent: #ff3366;
    --green:  #4ade80;
    --amber:  #f59e0b;
    --red:    #ef4444;
    --blue:   #3b82f6;
    --ink:    #1a1a1a;
    --body:   #2a2a2a;
    --mute:   #6b6b6b;
    --rule:   #d8d8d8;
    --paper:  #ffffff;
}

html, body {
    margin: 0;
    padding: 0;
    color: var(--body);
    font-family: 'Inter', 'Noto Sans', sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    background: var(--paper);
    string-set: gen-date attr(data-gen-date);
}

body { string-set: gen-date var(--gen-date); }

h1, h2, h3, h4 { color: var(--ink); margin: 0; }

/* ---- Cover page ---- */
.cover {
    page-break-after: always;
    height: 100vh;
    padding: 40mm 30mm 30mm 30mm;
    box-sizing: border-box;
    background: linear-gradient(180deg, #fafafa 0%, #ffffff 60%);
    position: relative;
    display: flex;
    flex-direction: column;
}
.cover-mark {
    display: flex;
    align-items: center;
    gap: 10pt;
}
.cover-logo {
    width: 28pt;
    height: 28pt;
}
.cover-wordmark {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11pt;
    letter-spacing: 0.32em;
    color: var(--ink);
    font-weight: 700;
}
.cover-eyebrow {
    margin-top: 60pt;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9pt;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
}
.cover-title {
    font-family: 'Source Serif Pro', 'Noto Serif', Georgia, serif;
    font-weight: 700;
    font-size: 64pt;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin-top: 14pt;
}
.cover-subtitle {
    font-family: 'Source Serif Pro', 'Noto Serif', Georgia, serif;
    font-style: italic;
    font-size: 16pt;
    color: var(--mute);
    margin-top: 8pt;
}
.cover-pitch-title {
    margin-top: 38pt;
    padding-top: 18pt;
    border-top: 1pt solid var(--rule);
    font-family: 'Source Serif Pro', 'Noto Serif', Georgia, serif;
    font-size: 20pt;
    font-weight: 600;
    color: var(--ink);
}
.cover-meta {
    margin-top: auto;
}
.cover-meta-row {
    display: flex;
    justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9pt;
    color: var(--mute);
    padding: 6pt 0;
    border-bottom: 1pt solid var(--rule);
}
.cover-meta-label { letter-spacing: 0.12em; text-transform: uppercase; }
.cover-meta-value { color: var(--ink); font-feature-settings: "tnum"; }

.verdict-badge {
    display: inline-block;
    margin-top: 24pt;
    padding: 14pt 24pt;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 18pt;
    letter-spacing: 0.06em;
    border-radius: 4pt;
    border: 2pt solid currentColor;
}
.verdict-badge.red    { color: var(--red);   background: #fee2e2; }
.verdict-badge.amber  { color: #b45309;       background: #fef3c7; }
.verdict-badge.green  { color: #166534;       background: #dcfce7; }

.cover-toc {
    margin-top: 26pt;
    padding-top: 14pt;
    border-top: 1pt solid var(--rule);
    font-family: 'Inter', sans-serif;
    font-size: 9.5pt;
    color: var(--mute);
}
.cover-toc-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--mute);
    margin-bottom: 10pt;
}
.cover-toc-row {
    display: flex;
    justify-content: space-between;
    padding: 3pt 0;
    color: var(--ink);
}
.cover-toc-row .num {
    color: var(--accent);
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5pt;
    margin-right: 10pt;
}

.cover-footer {
    position: absolute;
    bottom: 18mm;
    left: 30mm;
    right: 30mm;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    letter-spacing: 0.16em;
    color: var(--mute);
    text-transform: uppercase;
    text-align: center;
}

/* ---- Executive summary ---- */
.exec {
    page: exec;
    page-break-after: always;
}
.section-eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 6pt;
}
.section-h {
    font-family: 'Source Serif Pro', 'Noto Serif', Georgia, serif;
    font-size: 26pt;
    font-weight: 700;
    line-height: 1.1;
    color: var(--ink);
    margin-bottom: 18pt;
    bookmark-level: 1;
    bookmark-state: open;
}

.exec-card {
    border-left: 3pt solid var(--accent);
    background: #fafafa;
    padding: 14pt 18pt;
    margin-bottom: 18pt;
}
.exec-card.green { border-left-color: var(--green); }
.exec-card.amber { border-left-color: var(--amber); }
.exec-card.red   { border-left-color: var(--red); }
.exec-verdict-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--mute);
    margin-bottom: 4pt;
}
.exec-verdict-val {
    font-family: 'JetBrains Mono', monospace;
    font-size: 22pt;
    font-weight: 700;
    color: var(--ink);
    line-height: 1.1;
}

.exec-rows {
    margin-top: 18pt;
}
.exec-row {
    display: flex;
    justify-content: space-between;
    padding: 8pt 0;
    border-bottom: 1pt solid var(--rule);
    font-size: 10pt;
}
.exec-row .label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5pt;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--mute);
}
.exec-row .value {
    color: var(--ink);
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5pt;
}
.exec-row .value a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 0.5pt dashed currentColor;
}

/* ---- Main numbered sections ---- */
.section {
    page-break-before: always;
    page-break-inside: auto;
}
.section-num-block {
    display: flex;
    align-items: baseline;
    gap: 14pt;
    margin-bottom: 14pt;
    border-bottom: 1pt solid var(--rule);
    padding-bottom: 12pt;
}
.section-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: 28pt;
    font-weight: 700;
    line-height: 1;
}
.section-num.red   { color: var(--red); }
.section-num.green { color: var(--green); }
.section-num.amber { color: var(--amber); }
.section-num.blue  { color: var(--blue); }
.section-num.gray  { color: var(--mute); }

.section-title {
    font-family: 'Source Serif Pro', 'Noto Serif', Georgia, serif;
    font-size: 22pt;
    font-weight: 700;
    color: var(--ink);
    line-height: 1.15;
    bookmark-level: 1;
    bookmark-state: open;
}
.section-sub {
    font-size: 10pt;
    color: var(--mute);
    font-style: italic;
    margin-top: 4pt;
}

.numlist {
    margin-top: 16pt;
    padding: 0;
    list-style: none;
    counter-reset: nl;
}
.numlist > li {
    counter-increment: nl;
    display: grid;
    grid-template-columns: 32pt 1fr;
    column-gap: 14pt;
    padding: 10pt 0;
    border-bottom: 0.5pt solid var(--rule);
    page-break-inside: avoid;
}
.numlist > li::before {
    content: counter(nl, decimal-leading-zero);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10pt;
    color: var(--mute);
    line-height: 1.55;
}
.numlist > li > span {
    font-size: 10.5pt;
    line-height: 1.6;
    color: var(--body);
}
.numlist-empty {
    color: var(--mute);
    font-style: italic;
    text-align: center;
    padding: 18pt 0;
}

/* ---- Full debate appendix ---- */
.appendix-cover {
    page-break-before: always;
    padding-top: 18pt;
}
.agent-card {
    page-break-inside: avoid;
    margin-bottom: 16pt;
    padding-bottom: 12pt;
    border-bottom: 0.5pt solid var(--rule);
}
.agent-head {
    display: flex;
    align-items: baseline;
    gap: 10pt;
    margin-bottom: 6pt;
}
.agent-pill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7.5pt;
    font-weight: 600;
    letter-spacing: 0.12em;
    padding: 2pt 6pt;
    border-radius: 2pt;
    border: 0.5pt solid currentColor;
}
.agent-pill.attacker     { color: var(--red); }
.agent-pill.defender     { color: var(--blue); }
.agent-pill.synthesizer  { color: var(--ink); }
.agent-name {
    font-family: 'Source Serif Pro', 'Noto Serif', Georgia, serif;
    font-size: 13pt;
    font-weight: 600;
    color: var(--ink);
    bookmark-level: 2;
}
.agent-lane {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    color: var(--mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.agent-seq {
    margin-left: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8pt;
    color: var(--mute);
}
.agent-body {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5pt;
    line-height: 1.55;
    color: var(--body);
    white-space: pre-wrap;
    margin: 0;
}

/* ---- Misc ---- */
.confidential-watermark {
    position: fixed;
    bottom: 5mm;
    right: 5mm;
    font-family: 'JetBrains Mono', monospace;
    font-size: 6pt;
    color: rgba(0,0,0,0.18);
    letter-spacing: 0.18em;
}

[lang=ar] {
    direction: rtl;
    text-align: right;
}
"""


# ---------------------------------------------------------------------------
# HTML template
# ---------------------------------------------------------------------------

_LOGO_SVG = """
<svg class="cover-logo" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 48 L32 14 L48 48 Z" fill="none" stroke="#ff3366" stroke-width="4.5" stroke-linejoin="round"/>
  <line x1="22" y1="40" x2="42" y2="40" stroke="#ff3366" stroke-width="3"/>
</svg>
"""


def _esc(s: Any) -> str:
    return _html.escape("" if s is None else str(s))


def _render_numlist(items: list[str]) -> str:
    if not items:
        return '<div class="numlist-empty">— none surfaced —</div>'
    lis = "\n".join(f"  <li><span>{_esc(x)}</span></li>" for x in items)
    return f'<ol class="numlist">\n{lis}\n</ol>'


def _build_html(
    *,
    attack: dict,
    agents: list[dict],
    sections: dict,
    verdict_slug: str,
    verdict_class: str,
    verdict_display: str,
    title: str,
    attack_id: str,
    gen_date_iso: str,
    gen_date_human: str,
    explorer_tx_url: str,
    lang: str,
) -> str:
    attestation_full = sections.get("attestation", "") or ""
    attestation_short = _truncate_hash(attestation_full) if attestation_full else "—"
    attestation_link = (
        f'<a href="https://explore.moderato.tempo.xyz/tx/{_esc(attestation_full)}">'
        f"{_esc(attestation_short)}</a>"
        if attestation_full and attestation_full.startswith("0x")
        else _esc(attestation_short)
    )
    sources = _esc(sections.get("sources_cited", "0"))

    sections_html = []
    section_meta = [
        ("01", "red",   "Surviving Kill-Shot Risks",
            "What the attackers landed that defenders couldn't fully neutralize",
            sections["risks"]),
        ("02", "green", "Defended Strengths",
            "Where the pitch held up under pressure",
            sections["strengths"]),
        ("03", "amber", "Cruxes",
            "Validate this week",
            sections["cruxes"]),
        ("04", "blue",  "Founder Must Answer By Monday",
            "Concrete questions the founder owes",
            sections["founder"]),
    ]
    for num, color, heading, sub, items in section_meta:
        sections_html.append(f"""
<section class="section">
  <div class="section-num-block">
    <div class="section-num {color}">{num}</div>
    <div>
      <div class="section-title">{_esc(heading)}</div>
      <div class="section-sub">{_esc(sub)}</div>
    </div>
  </div>
  {_render_numlist(items)}
</section>""")

    # Full debate appendix
    agent_cards = []
    for a in sorted(agents, key=lambda x: (x.get("sequence_num") or 99)):
        name = a.get("agent_name") or ""
        role = _agent_role(name)
        display = _agent_display(name)
        lane = (a.get("lane") or "").capitalize()
        seq = a.get("sequence_num")
        body = a.get("output_text") or a.get("output") or "(no output captured)"
        agent_cards.append(f"""
<div class="agent-card">
  <div class="agent-head">
    <span class="agent-pill {role}">{role[:3].upper()}</span>
    <span class="agent-name">{_esc(display)}</span>
    <span class="agent-lane">{_esc(lane)}</span>
    {f'<span class="agent-seq">#{seq}</span>' if seq else ''}
  </div>
  <pre class="agent-body">{_esc(body)}</pre>
</div>""")

    toc_rows = [
        ("00", "Executive Summary"),
        ("01", "Surviving Kill-Shot Risks"),
        ("02", "Defended Strengths"),
        ("03", "Cruxes"),
        ("04", "Founder Must Answer By Monday"),
        ("AX", "Full Debate Transcript"),
    ]
    toc_html = "\n".join(
        f'<div class="cover-toc-row"><span><span class="num">{n}</span>{_esc(t)}</span></div>'
        for n, t in toc_rows
    )

    return f"""<!doctype html>
<html lang="{_esc(lang)}">
<head>
  <meta charset="utf-8" />
  <title>Adversary Report — {_esc(title)}</title>
  <style>{_CSS_TEMPLATE}</style>
</head>
<body style="--gen-date: '{_esc(gen_date_human)}';" data-gen-date="{_esc(gen_date_human)}">

  <!-- ============== COVER ============== -->
  <section class="cover">
    <div class="cover-mark">{_LOGO_SVG}<span class="cover-wordmark">ADVERSARY</span></div>
    <div class="cover-eyebrow">Adversarial Report — Confidential</div>
    <div class="cover-title">Adversary</div>
    <div class="cover-subtitle">7 attackers. 7 defenders. 1 verdict.</div>
    <div class="cover-pitch-title">{_esc(title)}</div>

    <div style="margin-top: 28pt;">
      <span class="verdict-badge {verdict_class}">{_esc(verdict_display)}</span>
    </div>

    <div class="cover-meta">
      <div class="cover-meta-row">
        <span class="cover-meta-label">Attack ID</span>
        <span class="cover-meta-value">{_esc(attack_id)}</span>
      </div>
      <div class="cover-meta-row">
        <span class="cover-meta-label">Generated</span>
        <span class="cover-meta-value">{_esc(gen_date_human)}</span>
      </div>
      <div class="cover-meta-row">
        <span class="cover-meta-label">Sources cited</span>
        <span class="cover-meta-value">{sources}</span>
      </div>
      <div class="cover-meta-row">
        <span class="cover-meta-label">Attestation</span>
        <span class="cover-meta-value">{_esc(attestation_short)}</span>
      </div>

      <div class="cover-toc">
        <div class="cover-toc-title">Contents</div>
        {toc_html}
      </div>
    </div>

    <div class="cover-footer">CONFIDENTIAL · NOT FOR DISTRIBUTION</div>
  </section>

  <!-- ============== EXECUTIVE SUMMARY ============== -->
  <section class="exec">
    <div class="section-eyebrow">Executive Summary</div>
    <h1 class="section-h">Verdict & overview</h1>

    <div class="exec-card {verdict_class}">
      <div class="exec-verdict-label">Verdict</div>
      <div class="exec-verdict-val">{_esc(verdict_display)}</div>
    </div>

    <p style="font-size: 11pt; line-height: 1.65; color: var(--body);">
      Fifteen agents — seven attackers, seven defenders, one synthesizer —
      interrogated this pitch across the lanes of demand, unit economics,
      competition, channel, defensibility, market timing, and compliance.
      The synthesizer's verdict above represents the surviving consensus
      after defended strengths were weighed against killshots that landed.
    </p>

    <div class="exec-rows">
      <div class="exec-row">
        <span class="label">Pitch</span>
        <span class="value">{_esc(title)}</span>
      </div>
      <div class="exec-row">
        <span class="label">Attack ID</span>
        <span class="value">{_esc(attack_id)}</span>
      </div>
      <div class="exec-row">
        <span class="label">Generated</span>
        <span class="value">{_esc(gen_date_human)}</span>
      </div>
      <div class="exec-row">
        <span class="label">Sources cited across debate</span>
        <span class="value">{sources}</span>
      </div>
      <div class="exec-row">
        <span class="label">On-chain attestation</span>
        <span class="value">{attestation_link}</span>
      </div>
    </div>
  </section>

  <!-- ============== SECTIONS ============== -->
  {''.join(sections_html)}

  <!-- ============== APPENDIX ============== -->
  <section class="appendix-cover">
    <div class="section-num-block">
      <div class="section-num gray">AX</div>
      <div>
        <div class="section-title">Full Debate Transcript</div>
        <div class="section-sub">All fifteen agent outputs, in firing order</div>
      </div>
    </div>
    {''.join(agent_cards)}
  </section>

  <div class="confidential-watermark">CONFIDENTIAL · {_esc(attack_id[:8])}</div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def render_pdf(attack: dict, agents: list[dict], lang: str = "en") -> bytes:
    """
    Render a polished VC-memo style PDF for a debate.

    Args:
        attack: The attack record. Must contain `id`, `verdict`, `final_report`,
                and ideally `artifact_title`.
        agents: The 15 agent rows as returned by GET /attacks/{id}.
        lang:   Language code for body text. Section headers stay in English
                regardless of `lang` (matches the parser).

    Returns:
        PDF bytes ready to be served as `application/pdf`.
    """
    attack = attack or {}
    agents = agents or []

    sections = _parse_final_report(attack.get("final_report") or "")
    verdict_slug = attack.get("verdict") or sections.get("verdict") or ""
    verdict_class = _verdict_class(verdict_slug)
    verdict_display = _format_verdict(verdict_slug)
    attack_id = attack.get("id") or ""
    title = attack.get("artifact_title") or attack.get("title") or "Untitled debate"

    now = _dt.datetime.utcnow()
    gen_date_iso = now.strftime("%Y-%m-%d")
    gen_date_human = now.strftime("%B %d, %Y · %H:%M UTC")
    explorer_tx_url = (
        f"https://explore.moderato.tempo.xyz/tx/{sections.get('attestation', '')}"
    )

    html_doc = _build_html(
        attack=attack,
        agents=agents,
        sections=sections,
        verdict_slug=verdict_slug,
        verdict_class=verdict_class,
        verdict_display=verdict_display,
        title=title,
        attack_id=attack_id,
        gen_date_iso=gen_date_iso,
        gen_date_human=gen_date_human,
        explorer_tx_url=explorer_tx_url,
        lang=lang,
    )

    return HTML(string=html_doc).write_pdf(
        font_config=_font_config(),
    )
