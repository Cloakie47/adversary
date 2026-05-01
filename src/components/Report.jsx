import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  fetchAttack,
  parseFinalReport,
  getVerdictColor,
  formatVerdict,
  splitAgentName,
  fetchTranslations,
  streamTranslation,
  getPdfUrl,
  requestAttestation,
} from '../lib/debate.js';

const AGENT_LANES = {
  'attacker-skeptic':      'Demand',
  'attacker-accountant':   'Unit Economics',
  'attacker-incumbent':    'Competition',
  'attacker-distribution': 'Channel',
  'attacker-moat':         'Defensibility',
  'attacker-timing':       'Market Timing',
  'attacker-regulatory':   'Compliance',
  'defender-believer':     'Demand',
  'defender-engineer':     'Unit Economics',
  'defender-strategist':   'Competition',
  'defender-operator':     'Channel',
  'defender-architect':    'Defensibility',
  'defender-builder':      'Market Timing',
  'defender-counsel':      'Compliance',
  'synthesizer':           'Verdict',
};
const AGENT_ORDER = Object.keys(AGENT_LANES);

const LANGUAGES = [
  { code: 'en', short: 'EN', label: 'English',   dir: 'ltr' },
  { code: 'hi', short: 'HI', label: 'हिन्दी',      dir: 'ltr' },
  { code: 'ja', short: 'JA', label: '日本語',      dir: 'ltr' },
  { code: 'es', short: 'ES', label: 'Español',   dir: 'ltr' },
  { code: 'ru', short: 'RU', label: 'Русский',   dir: 'ltr' },
  { code: 'id', short: 'ID', label: 'Bahasa',    dir: 'ltr' },
  { code: 'zh', short: 'ZH', label: '中文',       dir: 'ltr' },
  { code: 'fr', short: 'FR', label: 'Français',  dir: 'ltr' },
  { code: 'ar', short: 'AR', label: 'العربية',    dir: 'rtl' },
];

export default function Report({ attackId, agentOutputs, preloadedData, onReset }) {
  const [data, setData] = useState(preloadedData || null);
  const [loadError, setLoadError] = useState(null);
  const [showFull, setShowFull] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // ----- translation state -----
  const [currentLang, setCurrentLang] = useState('en');
  const [availableTranslations, setAvailableTranslations] = useState(new Set());
  const [translationCache, setTranslationCache] = useState({});
  const [translatingLang, setTranslatingLang] = useState(null);
  const [translationStreamText, setTranslationStreamText] = useState('');
  const [translationError, setTranslationError] = useState(null);
  const translationAbortRef = useRef(null);
  const translationStreamRef = useRef('');

  // ----- attestation -----
  const [attestPending, setAttestPending] = useState(false);
  const attestTriggeredRef = useRef(false);

  // Mirror preloadedData → state if it lands later
  useEffect(() => {
    if (preloadedData) setData(preloadedData);
  }, [preloadedData]);

  // ----- initial load -----
  useEffect(() => {
    if (!attackId) {
      setLoadError('Missing attack id');
      return;
    }
    const target = `/?attack_id=${encodeURIComponent(attackId)}`;
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(null, '', target);
    }
    if (preloadedData && preloadedData?.attack?.id === attackId) return;
    let cancelled = false;
    fetchAttack(attackId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'Failed to load report'); });
    return () => { cancelled = true; };
  }, [attackId, preloadedData]);

  // ----- one-time fetch of cached translation languages -----
  useEffect(() => {
    if (!attackId) return;
    let cancelled = false;
    fetchTranslations(attackId)
      .then((res) => {
        if (cancelled) return;
        const codes = (res?.translations || [])
          .map((t) => String(t?.lang || '').toLowerCase())
          .filter(Boolean);
        setAvailableTranslations(new Set(codes));
      })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [attackId]);

  // ----- canonical fields -----
  const attack = data?.attack || null;
  const apiAgents = data?.agents || null;

  const verdictSlug = attack?.verdict || '';
  const verdictDisplay = formatVerdict(verdictSlug);
  const verdictColor = getVerdictColor(verdictSlug);
  const finalReportText = attack?.final_report || '';
  const englishSections = useMemo(
    () => parseFinalReport(finalReportText),
    [finalReportText]
  );

  // ----- attestation auto-trigger (idempotent, runs once) -----
  useEffect(() => {
    if (!attack?.final_report) return;
    if (attestTriggeredRef.current) return;
    const a = englishSections.attestation;
    const isPending = !a || a === 'N/A' || /pending/i.test(a);
    if (!isPending) return;
    attestTriggeredRef.current = true;
    setAttestPending(true);
    requestAttestation(attackId)
      .then(() => fetchAttack(attackId))
      .then((d) => setData(d))
      .catch((e) => console.error('[attest] failed:', e))
      .finally(() => setAttestPending(false));
  }, [attack, attackId, englishSections.attestation]);

  // ----- language change handler -----
  const startTranslationStream = useCallback((lang) => {
    if (translationAbortRef.current) {
      try { translationAbortRef.current.abort(); } catch (_) {}
      translationAbortRef.current = null;
    }
    const controller = new AbortController();
    translationAbortRef.current = controller;
    translationStreamRef.current = '';
    setTranslationStreamText('');
    setTranslatingLang(lang);
    setTranslationError(null);

    streamTranslation({
      attackId,
      lang,
      signal: controller.signal,
      onEvent: ({ event, data: payload }) => {
        if (event === 'translation_start') {
          // payload may have { cached: bool }
        } else if (event === 'translation_delta') {
          const delta =
            typeof payload === 'string'
              ? payload
              : (payload?.text ?? payload?.delta ?? '');
          if (!delta) return;
          translationStreamRef.current += delta;
          setTranslationStreamText(translationStreamRef.current);
        } else if (event === 'translation_complete') {
          finalizeTranslation(lang);
        }
      },
    })
      .then(() => {
        // Stream ended cleanly even without explicit complete event
        if (translationStreamRef.current && translatingLangRef.current === lang) {
          finalizeTranslation(lang);
        }
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setTranslationError(e?.message || 'Translation failed');
        setTranslatingLang(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attackId]);

  // Helper kept stable via ref so startTranslationStream's then() handler
  // can compare to current language.
  const translatingLangRef = useRef(null);
  useEffect(() => { translatingLangRef.current = translatingLang; }, [translatingLang]);

  const finalizeTranslation = useCallback((lang) => {
    const text = translationStreamRef.current;
    if (!text) {
      setTranslatingLang(null);
      return;
    }
    const sections = parseFinalReport(text);
    setTranslationCache((prev) => ({
      ...prev,
      [lang]: { sections, fullText: text },
    }));
    setAvailableTranslations((prev) => {
      const next = new Set(prev);
      next.add(lang);
      return next;
    });
    setTranslatingLang(null);
  }, []);

  const handleLangChange = useCallback((lang) => {
    setCurrentLang(lang);
    if (lang === 'en') {
      if (translationAbortRef.current) {
        try { translationAbortRef.current.abort(); } catch (_) {}
        translationAbortRef.current = null;
      }
      setTranslatingLang(null);
      return;
    }
    if (translationCache[lang]) {
      // Client-side cache hit — instant, no network call
      setTranslatingLang(null);
      return;
    }
    startTranslationStream(lang);
  }, [translationCache, startTranslationStream]);

  // Cleanup any in-flight translation on unmount
  useEffect(() => () => {
    if (translationAbortRef.current) {
      try { translationAbortRef.current.abort(); } catch (_) {}
    }
  }, []);

  // ----- which sections + translation panel to render -----
  const isCurrentlyTranslating = translatingLang === currentLang && currentLang !== 'en';
  const cachedTranslation = translationCache[currentLang];
  const sectionsToShow =
    currentLang === 'en'
      ? englishSections
      : cachedTranslation?.sections || englishSections;

  // The translation panel is visible whenever the user is on a non-EN
  // language AND we have either an in-flight stream or a cached result for
  // that language. It shows streaming state during the stream and a
  // "Translated" state after completion — the box never just disappears.
  const showTranslationPanel =
    currentLang !== 'en' && (isCurrentlyTranslating || !!cachedTranslation);
  const translationPanelText = isCurrentlyTranslating
    ? translationStreamText
    : (cachedTranslation?.fullText || '');

  const currentLangMeta = LANGUAGES.find((l) => l.code === currentLang) || LANGUAGES[0];
  const currentDir = currentLangMeta.dir;

  // ----- agents for full debate -----
  const agentsForDisplay = useMemo(() => {
    if (apiAgents && apiAgents.length) return apiAgents;
    if (!agentOutputs) return [];
    return AGENT_ORDER
      .filter((name) => agentOutputs[name] != null)
      .map((name) => ({ agent_name: name, output_text: agentOutputs[name] }));
  }, [apiAgents, agentOutputs]);

  const sortedAgents = useMemo(
    () => [...agentsForDisplay].sort((a, b) => {
      const ai = AGENT_ORDER.indexOf(a.agent_name);
      const bi = AGENT_ORDER.indexOf(b.agent_name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }),
    [agentsForDisplay]
  );

  const titleFromAttack =
    attack?.artifact_title ||
    attack?.title ||
    'Untitled debate';

  const handleShare = async () => {
    const url = `${window.location.origin}/?attack_id=${encodeURIComponent(attackId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch (_) {
      window.prompt('Copy this link:', url);
    }
  };

  const handlePdf = () => {
    if (!attackId) return;
    // Respect the currently-selected language. EN omits the ?lang param.
    window.open(getPdfUrl(attackId, currentLang), '_blank', 'noopener,noreferrer');
  };

  const hasAnyData = data || (agentOutputs && Object.keys(agentOutputs).length);

  if (loadError && !hasAnyData) {
    return (
      <div className="report">
        <header className="report-header">
          <button className="btn-text" onClick={onReset} type="button">← New debate</button>
        </header>
        <div className="error-banner">Error: {loadError}</div>
      </div>
    );
  }

  if (!hasAnyData) {
    return (
      <div className="report">
        <div className="loader">
          <div className="loader-bar" />
          <div className="loader-text">Loading report…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="report">
      <header className="report-header report-header-tools">
        <button className="btn-text" onClick={onReset} type="button">
          ← New debate
        </button>
        <div className="report-title-block">
          <div className="report-eyebrow">Adversary report</div>
          <div className="report-title">{titleFromAttack}</div>
        </div>
        <div className="report-tools">
          <LanguageSelector
            languages={LANGUAGES}
            current={currentLang}
            cached={availableTranslations}
            translating={translatingLang}
            onSelect={handleLangChange}
          />
          <button
            className="btn btn-tool btn-pdf"
            onClick={handlePdf}
            type="button"
            title={`Download PDF (${currentLangMeta.label})`}
          >
            <span className="tool-icon" aria-hidden="true">⬇</span>
            <span className="tool-label">
              Download PDF{' '}
              <span className="tool-label-lang" dir={currentLangMeta.dir}>
                ({currentLangMeta.label})
              </span>
            </span>
          </button>
          <button
            className="btn btn-tool btn-share"
            onClick={handleShare}
            type="button"
          >
            {shareCopied ? '✓ Copied' : 'Share'}
          </button>
        </div>
      </header>

      <section
        className={`verdict verdict-${verdictColor}`}
        dir={currentDir}
      >
        <div className="verdict-stripe" />
        <div className="verdict-inner">
          <div className="verdict-label">VERDICT</div>
          <h1 className="verdict-text">
            {verdictDisplay || 'AWAITING SYNTHESIS'}
          </h1>
        </div>
      </section>

      {translationError && (
        <div className="error-banner">
          Translation failed: {translationError}{' '}
          <button className="btn-link" onClick={() => handleLangChange('en')}>
            Back to English
          </button>
        </div>
      )}

      {showTranslationPanel && (
        <section
          className={`translating-block ${isCurrentlyTranslating ? 'translating-active' : 'translating-done'}`}
          dir={currentDir}
        >
          <div className="translating-head">
            <div className="translating-status">
              <span className={`status-dot ${isCurrentlyTranslating ? 'pulsing' : 'done'}`} />
              {isCurrentlyTranslating
                ? `Translating to ${currentLangMeta.label} (${currentLangMeta.short})`
                : `Translated to ${currentLangMeta.label} (${currentLangMeta.short})`}
            </div>
            <div className="translating-meta">
              {isCurrentlyTranslating
                ? `translating: ${translationPanelText.length.toLocaleString()} chars`
                : `${translationPanelText.length.toLocaleString()} chars · cached`}
            </div>
          </div>
          <pre className="translating-text">
            {translationPanelText || ' '}
          </pre>
          <div className="translating-foot">
            {isCurrentlyTranslating
              ? 'Streamed via Kimi K2.5 · cached after completion'
              : 'Cached this session · switching languages is instant'}
          </div>
        </section>
      )}

      <section className="report-grid" dir={currentDir}>
        <Section
          title="Surviving Kill-Shot Risks"
          subtitle="What the attackers landed that defenders couldn't fully neutralize"
          items={sectionsToShow.risks}
          accent="red"
          defaultOpen
        />
        <Section
          title="Defended Strengths"
          subtitle="Where the pitch held up under pressure"
          items={sectionsToShow.strengths}
          accent="green"
          defaultOpen
        />
        <Section
          title="Cruxes"
          subtitle="Validate this week"
          items={sectionsToShow.cruxes}
          accent="amber"
          defaultOpen
        />
        <Section
          title="Founder Must Answer By Monday"
          subtitle="Concrete questions the founder owes"
          items={sectionsToShow.founderQuestions}
          accent="blue"
          defaultOpen
        />
      </section>

      <div className="full-debate-toggle">
        <button
          className="btn btn-ghost"
          onClick={() => setShowFull((v) => !v)}
          type="button"
        >
          {showFull ? '← Hide full debate' : `View full debate (${sortedAgents.length}) →`}
        </button>
      </div>

      {showFull && (
        <section className="full-debate">
          {sortedAgents.length === 0 && (
            <div className="error-banner">No agent outputs available yet.</div>
          )}
          {sortedAgents.map((a, i) => (
            <AgentCollapse key={a.id || a.agent_name || i} agent={a} />
          ))}
        </section>
      )}

      <footer className="report-footer">
        <div className="footer-row">
          <span>Sources cited: <strong>{englishSections.sourcesCited || '0'}</strong></span>
          <span className="footer-sep">·</span>
          <AttestationLine
            hash={englishSections.attestation}
            pending={attestPending}
            txHash={attack?.onchain_tx_hash}
            explorerUrl={attack?.onchain_explorer_url}
            network={attack?.onchain_network}
          />
        </div>
        <div className="footer-caption">
          Every report attested on Tempo. Verifiable on-chain.
        </div>
        <div className="footer-build">
          Built on Hermes Agent + Kimi K2.5 + Tempo MPP
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function LanguageSelector({ languages, current, cached, translating, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cur = languages.find((l) => l.code === current) || languages[0];

  return (
    <div className="lang-select" ref={ref}>
      <button
        className="btn btn-tool lang-btn"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="tool-icon" aria-hidden="true">🌐</span>
        <span className="lang-cur-short">{cur.short}</span>
        <span className="lang-cur-label">{cur.label}</span>
        <span className="lang-arrow" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox">
          {languages.map((l) => {
            const isCached = cached.has(l.code) || l.code === 'en';
            const isActive = l.code === current;
            const isTranslating = translating === l.code;
            return (
              <li key={l.code} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  className={`lang-option ${isActive ? 'lang-active' : ''}`}
                  onClick={() => { onSelect(l.code); setOpen(false); }}
                >
                  <span className="lang-opt-short">{l.short}</span>
                  <span className="lang-opt-label" dir={l.dir}>{l.label}</span>
                  <span className="lang-opt-spacer" />
                  {isTranslating && (
                    <span className="lang-opt-pill" title="Translating now">…</span>
                  )}
                  {isCached && !isTranslating && (
                    <span
                      className="lang-opt-dot"
                      title="Cached for this debate"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Section({ title, subtitle, items, accent, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`section section-${accent}`}>
      <button
        className="section-head"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="section-stripe" />
        <span className="section-titles">
          <span className="section-title">{title}</span>
          <span className="section-sub">{subtitle}</span>
        </span>
        <span className="section-count">{items.length}</span>
        <span className="section-toggle">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ol className="section-list">
          {items.length === 0 && (
            <li className="section-empty">— none surfaced —</li>
          )}
          {items.map((it, i) => (
            <li key={i}>
              <span className="list-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="list-text">{it}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AgentCollapse({ agent }) {
  const [open, setOpen] = useState(false);
  const name = agent.agent_name || '';
  const { role, sub } = splitAgentName(name);
  const lane = agent.lane
    ? agent.lane.charAt(0).toUpperCase() + agent.lane.slice(1)
    : (AGENT_LANES[name] || '');
  const display = sub
    ? sub.charAt(0).toUpperCase() + sub.slice(1)
    : 'Synthesizer';

  const text = agent.output_text || agent.output || '';

  return (
    <div className={`agent-collapse agent-${role}`}>
      <button
        className="agent-collapse-head"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className={`agent-role-pill agent-role-${role}`}>
          {role === 'attacker' ? 'ATK' : role === 'defender' ? 'DEF' : 'SYN'}
        </span>
        <span className="agent-collapse-name">{display}</span>
        {lane && <span className="agent-collapse-lane">{lane}</span>}
        <span className="agent-collapse-spacer" />
        {agent.sequence_num != null && (
          <span className="agent-collapse-seq">#{agent.sequence_num}</span>
        )}
        <span className="agent-collapse-toggle">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="agent-collapse-body">
          <pre>{text || '(awaiting agent output)'}</pre>
        </div>
      )}
    </div>
  );
}

function AttestationLine({ hash, pending, txHash, explorerUrl, network }) {
  const [copied, setCopied] = useState(false);

  const onchainAvailable = !!(txHash && explorerUrl);
  const displayHash = onchainAvailable ? txHash : hash;
  const isReal = displayHash && displayHash !== 'N/A' && !/pending/i.test(displayHash);
  const display = formatHashShort(displayHash);

  const copy = async () => {
    if (!isReal) return;
    try {
      await navigator.clipboard.writeText(displayHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (_) {
      window.prompt('Copy hash:', displayHash);
    }
  };

  if (pending) {
    return (
      <span className="attestation-row">
        <span>On-chain attestation:</span>
        <span className="attest-pending">
          <span className="status-dot pulsing" /> writing to chain...
        </span>
      </span>
    );
  }

  return (
    <span className="attestation-row">
      <span>{onchainAvailable ? 'On-chain (Tempo):' : 'Attestation:'}</span>
      {onchainAvailable ? (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="attest-link" title="View on Tempo">
          <code>{display}</code>
          <span className="attest-link-icon" aria-hidden="true">↗</span>
        </a>
      ) : (
        <code title={displayHash || 'N/A'}>{display}</code>
      )}
      {isReal && (
        <button
          className="copy-btn"
          type="button"
          onClick={copy}
          title="Copy full hash"
          aria-label="Copy hash"
        >
          {copied ? '✓' : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="4" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}

function formatHashShort(hash) {
  if (!hash || typeof hash !== 'string') return 'N/A';
  if (/pending/i.test(hash)) return hash;
  if (hash.length < 14) return hash;
  return hash.slice(0, 8) + '…' + hash.slice(-6);
}
