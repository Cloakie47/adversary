import React, { useState, useEffect, useCallback } from 'react';
import Landing from './components/Landing.jsx';
import Processing from './components/Processing.jsx';
import Report from './components/Report.jsx';
import MyReports from './components/MyReports.jsx';
import { DEMO_ATTACK_ID, fetchAttack } from './lib/debate.js';

export default function App() {
  const [view, setView] = useState('landing');
  const [attackId, setAttackId] = useState(null);
  const [isDemo, setIsDemo] = useState(false);
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactText, setArtifactText] = useState('');
  // In-memory state from SSE so View 3 can render without refetching
  const [agentOutputs, setAgentOutputs] = useState({});
  // Preloaded full /attacks/{id} response (used when boot finds status=complete)
  const [preloadedAttack, setPreloadedAttack] = useState(null);
  // Resume mode: opened ?attack_id=… for an in-progress or failed debate
  const [resumeMode, setResumeMode] = useState(false);
  const [resumeError, setResumeError] = useState(null);
  // Boot loading: true while we resolve a URL-supplied attack_id
  const [bootLoading, setBootLoading] = useState(true);
  // Bootstrap error to surface on the landing page (e.g. invalid id)
  const [landingNotice, setLandingNotice] = useState(null);
  // Endpoint choice for the live debate: /debate-fast (default) vs legacy /debate
  const [useFast, setUseFast] = useState(true);
  // Payment token from the wallet → backend verification flow
  const [paymentToken, setPaymentToken] = useState(null);

  // Keep the URL in sync with the active attack_id.
  const updateUrl = useCallback((id) => {
    if (!id) return;
    const target = `/?attack_id=${encodeURIComponent(id)}`;
    const current = window.location.pathname + window.location.search;
    if (current !== target) {
      window.history.replaceState(null, '', target);
    }
  }, []);

  // Load a debate by id and route into the right view based on its status.
  const loadById = useCallback((id) => {
    if (!id) return;
    setBootLoading(true);
    setAttackId(id);
    setIsDemo(false);
    setPreloadedAttack(null);
    setAgentOutputs({});
    setResumeMode(false);
    setResumeError(null);
    setLandingNotice(null);
    updateUrl(id);

    fetchAttack(id)
      .then((data) => {
        const status = data?.attack?.status || 'unknown';
        const title =
          data?.attack?.artifact_title ||
          data?.attack?.title ||
          'Debate';
        setArtifactTitle(title);

        if (status === 'complete') {
          setPreloadedAttack(data);
          setView('report');
        } else if (status === 'failed') {
          setResumeMode(true);
          setResumeError('This debate failed on the backend.');
          // Pre-populate any partial agent outputs we already have
          if (data?.agents?.length) {
            const map = {};
            for (const a of data.agents) {
              const t = a?.output_text || a?.output;
              if (a?.agent_name && t) map[a.agent_name] = t;
            }
            setAgentOutputs(map);
          }
          setView('processing');
        } else {
          // running or unknown — resume the cinematic view via polling
          if (data?.agents?.length) {
            const map = {};
            for (const a of data.agents) {
              const t = a?.output_text || a?.output;
              if (a?.agent_name && t) map[a.agent_name] = t;
            }
            setAgentOutputs(map);
          }
          setResumeMode(true);
          setView('processing');
        }
      })
      .catch((e) => {
        setLandingNotice(`Could not load debate ${id.slice(0, 8)}…: ${e.message || 'fetch failed'}`);
        setView('landing');
        // Clean the bad attack_id from the URL so refresh doesn't loop
        window.history.replaceState(null, '', '/');
      })
      .finally(() => setBootLoading(false));
  }, [updateUrl]);

  // Boot: read attack_id from URL on initial mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('attack_id');
    // Backwards-compat: also accept legacy /report/{id} paths
    if (!id) {
      const m = window.location.pathname.match(/^\/report\/([a-zA-Z0-9-]{8,})\/?$/);
      if (m) id = m[1];
    }
    if (!id) {
      setBootLoading(false);
      return;
    }
    loadById(id);
  }, [loadById]);

  const startLiveDebate = (text, title, opts = {}) => {
    setArtifactText(text);
    setArtifactTitle(title || 'Untitled debate');
    setIsDemo(false);
    setAttackId(null);
    setPreloadedAttack(null);
    setAgentOutputs({});
    setResumeMode(false);
    setResumeError(null);
    setLandingNotice(null);
    setUseFast(opts.fast !== false); // default fast unless explicitly opted out
    setPaymentToken(opts.paymentToken || null);
    setView('processing');
  };

  const startDemo = () => {
    setArtifactTitle('Sample pitch — replay');
    setIsDemo(true);
    setAttackId(DEMO_ATTACK_ID);
    setPreloadedAttack(null);
    setAgentOutputs({});
    setResumeMode(false);
    setResumeError(null);
    setLandingNotice(null);
    setView('processing');
  };

  const handleAttackId = (id) => {
    if (!id) return;
    setAttackId(id);
    // Persist the URL once the live debate has its id (skip for demo replays)
    if (!isDemo) updateUrl(id);
  };

  const handleDebateComplete = (id, outputs) => {
    if (id) setAttackId(id);
    if (outputs && typeof outputs === 'object') setAgentOutputs(outputs);
    setTimeout(() => setView('report'), 2000);
  };

  const viewPastDebate = (id) => {
    if (!id) return;
    loadById(id.trim());
  };

  const showMyReports = () => {
    setLandingNotice(null);
    setView('myreports');
  };

  const reset = () => {
    setView('landing');
    setAttackId(null);
    setIsDemo(false);
    setArtifactTitle('');
    setArtifactText('');
    setAgentOutputs({});
    setPreloadedAttack(null);
    setResumeMode(false);
    setResumeError(null);
    setLandingNotice(null);
    setPaymentToken(null);
    if (window.location.pathname !== '/' || window.location.search) {
      window.history.replaceState(null, '', '/');
    }
  };

  if (bootLoading) {
    return (
      <div className="app">
        <div className="bg-grid" aria-hidden="true" />
        <div className="loader">
          <div className="loader-bar" />
          <div className="loader-text">Loading debate…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden="true" />
      {view === 'landing' && (
        <Landing
          onStart={startLiveDebate}
          onDemo={startDemo}
          onViewPast={viewPastDebate}
          onShowMyReports={showMyReports}
          notice={landingNotice}
        />
      )}
      {view === 'processing' && (
        <Processing
          attackId={attackId}
          isDemo={isDemo}
          isResume={resumeMode}
          initialError={resumeError}
          initialOutputs={agentOutputs}
          title={artifactTitle}
          artifactText={artifactText}
          fast={useFast}
          paymentToken={paymentToken}
          onAttackId={handleAttackId}
          onComplete={handleDebateComplete}
          onReset={reset}
        />
      )}
      {view === 'report' && (
        <Report
          attackId={attackId}
          agentOutputs={agentOutputs}
          preloadedData={preloadedAttack}
          onReset={reset}
        />
      )}
      {view === 'myreports' && (
        <MyReports
          onOpenAttack={loadById}
          onReset={reset}
        />
      )}
    </div>
  );
}
