import React, { useState, useEffect, useRef } from 'react';
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi';
import PaymentModal from './PaymentModal.jsx';

export default function Landing({ onStart, onDemo, onViewPast, onShowMyReports, notice }) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useLegacyEndpoint, setUseLegacyEndpoint] = useState(false);
const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const canRun = text.trim().length > 0;

const handleStart = () => {
    if (!canRun) return;
    setPaymentModalOpen(true);
  };

  const handlePaymentSuccess = ({ paymentToken }) => {
    setPaymentModalOpen(false);
    onStart(text.trim(), title.trim(), {
      fast: !useLegacyEndpoint,
      paymentToken,
    });
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
          <MyReportsLink onClick={onShowMyReports} />
          <WalletPill />
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
              placeholder="Title (optional) — e.g. 'Series A: Vertical AI for X'"
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

      <PaymentModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onPaid={handlePaymentSuccess}
        amountUsd={1.0}
        action="debate"
        actionLabel="Run debate"
      />
    </div>
  );
}

function WalletPill() {
  const { address, isConnected } = useAccount();
  const connect = useConnect();
  const connectors = useConnectors();
  const disconnect = useDisconnect();

  const tempoConnector = connectors.find((c) => c.id === 'xyz.tempo') || connectors[0];

  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const groupRef = useRef(null);
  const closeTimerRef = useRef(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (groupRef.current && !groupRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setMenuOpen(false), 220);
  };

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (_) {
      window.prompt('Copy your address:', address);
    }
  };

  const handleDisconnect = () => {
    setMenuOpen(false);
    disconnect.disconnect();
  };

  if (connect.isPending) {
    return (
      <button className="wallet-pill wallet-pill-pending" type="button" disabled>
        <span className="wallet-dot pulsing" />
        Check prompt…
      </button>
    );
  }

  if (isConnected && address) {
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const explorerUrl = `https://explore.moderato.tempo.xyz/address/${address}`;
    return (
      <div
        className={`wallet-pill-group ${menuOpen ? 'wallet-pill-group-open' : ''}`}
        ref={groupRef}
        onMouseEnter={() => { cancelClose(); setMenuOpen(true); }}
        onMouseLeave={scheduleClose}
      >
        <button
          className={`wallet-address-btn ${copied ? 'wallet-copied' : ''}`}
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Click to copy address'}
        >
          <span className="wallet-dot wallet-dot-live" />
          <span className="wallet-address-text">
            {copied ? 'Copied' : short}
          </span>
        </button>
        <span className="wallet-pill-divider" aria-hidden="true" />
        <button
          className="wallet-pill-chevron"
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Wallet menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className={`wallet-chevron-icon ${menuOpen ? 'wallet-chevron-open' : ''}`}
          >
            <path
              d="M2.5 4.5 L6 8 L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {menuOpen && (
          <div
            className="wallet-menu"
            role="menu"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              role="menuitem"
              className="wallet-menu-item"
              onClick={handleCopy}
            >
              <span className="wallet-menu-icon" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </span>
              <span className="wallet-menu-label">
                {copied ? 'Copied!' : 'Copy address'}
              </span>
              <span className="wallet-menu-hint">{short}</span>
            </button>
            <a
              role="menuitem"
              className="wallet-menu-item"
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              <span className="wallet-menu-icon" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M9 2.5 H13.5 V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.5 2.5 L7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 9.5 V13 H3 V4 H6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="wallet-menu-label">View on Tempo Explorer</span>
              <span className="wallet-menu-arrow" aria-hidden="true">↗</span>
            </a>
            <div className="wallet-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="wallet-menu-item wallet-menu-danger"
              onClick={handleDisconnect}
            >
              <span className="wallet-menu-icon" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2 V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M4.5 5 a4.5 4.5 0 1 0 7 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className="wallet-menu-label">Disconnect</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="wallet-pill"
      type="button"
      onClick={() => connect.connect({ connector: tempoConnector })}
    >
      Connect wallet
    </button>
  );
}

function MyReportsLink({ onClick }) {
  const { isConnected } = useAccount();
  if (!isConnected) return null;
  return (
    <button
      className="myreports-link"
      type="button"
      onClick={onClick}
    >
      My Reports
    </button>
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