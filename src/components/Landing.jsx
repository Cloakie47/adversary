import React, { useState } from 'react';

export default function Landing({ onStart, onDemo, onViewPast, notice }) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useLegacyEndpoint, setUseLegacyEndpoint] = useState(false);

  const canRun = text.trim().length > 0;

  const handleStart = () => {
    if (!canRun) return;
    onStart(text.trim(), title.trim(), { fast: !useLegacyEndpoint });
  };

  const handleViewPast = () => {
    const raw = window.prompt('Enter attack ID (UUID) to resume a past debate:');
    if (!raw) return;
    const id = raw.trim();
    if (!id) return;
    onViewPast?.(id);
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="logo">
          <LogoMark />
          <span className="logo-text">ADVERSARY</span>
        </div>
        <div className="nav-meta">
          <span className="dot dot-live" /> system online
        </div>
      </header>

      <main className="landing-main">
        <div className="landing-inner">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            adversarial review · multi-agent
          </div>

          <h1 className="headline">Adversary</h1>
          <p className="subhead">
            7 attackers. 7 defenders. 1 verdict. Drop your pitch.
          </p>

          <div className="input-card">
            <input
              className="title-input"
              placeholder="Title (optional) — e.g. ‘Series A: Vertical AI for X’"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
            />
            <textarea
              className="artifact-input"
              placeholder="Paste your pitch deck text, plan, or product spec…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              spellCheck={false}
            />
            <div className="input-footer">
              <div className="char-count">
                {text.length.toLocaleString()} chars
              </div>
              <div className="button-row">
                <button
                  className="btn btn-secondary"
                  onClick={onDemo}
                  type="button"
                >
                  ▶ Run Demo (60s replay)
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleStart}
                  disabled={!canRun}
                  type="button"
                >
                  Run Debate →
                </button>
              </div>
            </div>
          </div>

          <div className="caveat">
            {useLegacyEndpoint
              ? 'Legacy /debate endpoint runs ≈25 min. Use the demo for a 60-second walkthrough.'
              : 'Fast endpoint runs in ≈3–5 min. Use the demo for a 60-second walkthrough.'}
          </div>

          <div className="past-row">
            <button
              type="button"
              className="btn-text past-link"
              onClick={handleViewPast}
            >
              Resume past debate →
            </button>
            <span className="past-divider">·</span>
            <button
              type="button"
              className="btn-text past-link"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? 'Hide advanced' : 'Advanced'}
            </button>
          </div>
          {advancedOpen && (
            <div className="advanced-panel">
              <label className="advanced-row">
                <input
                  type="checkbox"
                  checked={useLegacyEndpoint}
                  onChange={(e) => setUseLegacyEndpoint(e.target.checked)}
                />
                <span className="advanced-label">
                  Use legacy <code>/debate</code> endpoint (~25 min, deeper analysis)
                </span>
              </label>
              <div className="advanced-help">
                Default uses <code>/debate-fast</code> (≈3–5 min). Toggle this for the legacy 25-minute pass when you want maximum depth.
              </div>
            </div>
          )}

          {notice && <div className="landing-notice">{notice}</div>}

          <div className="how-it-works">
            <div className="how-col">
              <div className="how-num">01</div>
              <div className="how-title">7 attackers fire first</div>
              <div className="how-body">
                Skeptic, Accountant, Incumbent, Distribution, Moat, Timing, Regulatory — each runs a kill-shot lane.
              </div>
            </div>
            <div className="how-col">
              <div className="how-num">02</div>
              <div className="how-title">7 defenders rebut, paired</div>
              <div className="how-body">
                Believer, Engineer, Strategist, Operator, Architect, Builder, Counsel — one per lane, no piling on.
              </div>
            </div>
            <div className="how-col">
              <div className="how-num">03</div>
              <div className="how-title">Synthesizer renders verdict</div>
              <div className="how-body">
                Surviving risks, defended strengths, cruxes to validate, and what the founder must answer by Monday.
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        Built on Hermes Agent + Kimi K2.5 + Tempo MPP
      </footer>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M16 48 L32 14 L48 48 Z"
        stroke="#ff3366"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <line x1="22" y1="40" x2="42" y2="40" stroke="#ff3366" strokeWidth="3" />
    </svg>
  );
}
