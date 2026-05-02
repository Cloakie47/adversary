import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { fetchMyAttacks } from '../lib/debate.js';
import ThemeToggle from './ThemeToggle.jsx';

const VERDICT_COLOR = {
  KILL: 'red',
  REJECT: 'red',
  'DO-NOT-SHIP': 'red',
  'DO NOT SHIP': 'red',
  PAUSE: 'amber',
  'PAUSE-AND-VALIDATE': 'amber',
  'PAUSE AND VALIDATE': 'amber',
  SHIP: 'green',
  PROCEED: 'green',
};

function verdictColor(v) {
  if (!v) return 'amber';
  const upper = String(v).toUpperCase().trim();
  for (const key of Object.keys(VERDICT_COLOR)) {
    if (upper.includes(key)) return VERDICT_COLOR[key];
  }
  return 'amber';
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (_) {
    return ts;
  }
}

function shortHash(hash) {
  if (!hash || hash.length < 14) return hash || '';
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export default function MyReports({ onOpenAttack, onReset }) {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attacks, setAttacks] = useState([]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMyAttacks(address, 50)
      .then((data) => {
        if (cancelled) return;
        setAttacks(data.attacks || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Could not load reports');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [address]);

  if (!isConnected) {
    return (
      <div className="myreports">
        <header className="myreports-header">
          <button className="btn-text" onClick={onReset} type="button">← Back</button>
          <div className="myreports-title">My Reports</div>
        </header>
        <div className="myreports-empty">
          Connect your wallet to view your past reports.
        </div>
      </div>
    );
  }

  return (
    <div className="myreports">
      <header className="myreports-header">
        <button className="btn-text" onClick={onReset} type="button">← Back</button>
        <div className="myreports-title">My Reports</div>
        <ThemeToggle />
        <div className="myreports-meta">
          {address.slice(0, 6)}…{address.slice(-4)}
        </div>
      </header>

      {loading && (
        <div className="myreports-empty">Loading your reports…</div>
      )}

      {error && (
        <div className="myreports-error">
          Error: {error}
        </div>
      )}

      {!loading && !error && attacks.length === 0 && (
        <div className="myreports-empty">
          <div className="myreports-empty-title">No reports yet</div>
          <div className="myreports-empty-sub">
            Your paid debates will appear here. Run your first debate to get started.
          </div>
        </div>
      )}

      {!loading && attacks.length > 0 && (
        <div className="myreports-list">
          {attacks.map((a) => (
            <button
              key={a.id}
              className="report-card"
              type="button"
              onClick={() => onOpenAttack(a.id)}
            >
              <div className="report-card-row1">
                <span className="report-card-title">
                  {a.artifact_title || 'Untitled debate'}
                </span>
                {a.verdict && (
                  <span className={`report-card-verdict report-card-verdict-${verdictColor(a.verdict)}`}>
                    {a.verdict}
                  </span>
                )}
                {!a.verdict && a.status === 'running' && (
                  <span className="report-card-verdict report-card-verdict-amber">
                    RUNNING
                  </span>
                )}
                {!a.verdict && a.status === 'failed' && (
                  <span className="report-card-verdict report-card-verdict-red">
                    FAILED
                  </span>
                )}
              </div>
              <div className="report-card-row2">
                <span className="report-card-time">
                  {formatTime(a.completed_at || a.created_at)}
                </span>
                {a.onchain_tx_hash && (
                  <a
                    href={a.onchain_explorer_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="report-card-tx"
                    onClick={(e) => e.stopPropagation()}
                    title="View on Tempo"
                  >
                    {shortHash(a.onchain_tx_hash)} ↗
                  </a>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
