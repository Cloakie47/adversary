import React, { useEffect, useState, useRef, useMemo } from 'react';
import { streamDebate, streamReplay, fetchAttack } from '../lib/debate.js';

const ATTACKERS = [
  { id: 'attacker-skeptic',      name: 'Skeptic',      lane: 'Demand' },
  { id: 'attacker-accountant',   name: 'Accountant',   lane: 'Unit Economics' },
  { id: 'attacker-incumbent',    name: 'Incumbent',    lane: 'Competition' },
  { id: 'attacker-distribution', name: 'Distribution', lane: 'Channel' },
  { id: 'attacker-moat',         name: 'Moat',         lane: 'Defensibility' },
  { id: 'attacker-timing',       name: 'Timing',       lane: 'Market Timing' },
  { id: 'attacker-regulatory',   name: 'Regulatory',   lane: 'Compliance' },
];

const DEFENDERS = [
  { id: 'defender-believer',   name: 'Believer',   lane: 'Demand' },
  { id: 'defender-engineer',   name: 'Engineer',   lane: 'Unit Economics' },
  { id: 'defender-strategist', name: 'Strategist', lane: 'Competition' },
  { id: 'defender-operator',   name: 'Operator',   lane: 'Channel' },
  { id: 'defender-architect',  name: 'Architect',  lane: 'Defensibility' },
  { id: 'defender-builder',    name: 'Builder',    lane: 'Market Timing' },
  { id: 'defender-counsel',    name: 'Counsel',    lane: 'Compliance' },
];

const SYNTH = { id: 'synthesizer', name: 'Synthesizer', lane: 'Verdict' };
const SEQUENCE = [...ATTACKERS, ...DEFENDERS, SYNTH].map((a) => a.id);

const POLL_INTERVAL_MS = 10000;

export default function Processing({
  attackId,
  isDemo,
  isResume,
  initialError,
  initialOutputs,
  title,
  artifactText,
  fast = true,
  onAttackId,
  onComplete,
  onReset,
}) {
  const [outputs, setOutputs] = useState(() => initialOutputs || {});
  const [started, setStarted] = useState(!!isResume);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(initialError || null);
  const [reconnecting, setReconnecting] = useState(false);

  const startTimeRef = useRef(Date.now());
  const abortRef = useRef(null);
  const completedRef = useRef(false);
  const liveAttackIdRef = useRef(attackId);
  const onAttackIdRef = useRef(onAttackId);
  const onCompleteRef = useRef(onComplete);
  const outputsRef = useRef(outputs);

  useEffect(() => { onAttackIdRef.current = onAttackId; }, [onAttackId]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { outputsRef.current = outputs; }, [outputs]);
  useEffect(() => {
    if (attackId) liveAttackIdRef.current = attackId;
  }, [attackId]);

  // Elapsed timer
  useEffect(() => {
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 250);
    return () => clearInterval(i);
  }, []);

  // ---- SSE connection (skip in resume mode; demo uses replay endpoint) ----
  useEffect(() => {
    if (isResume) return; // resume mode: poll only
    let cancelled = false;
    let attempt = 0;

    const handleEvent = ({ event, data }) => {
      if (event === 'debate_started') {
        setStarted(true);
        if (data?.attack_id) {
          liveAttackIdRef.current = data.attack_id;
          onAttackIdRef.current?.(data.attack_id);
        }
      } else if (event === 'agent_complete') {
        const agentName = data?.agent_name;
        const output = data?.output ?? data?.text ?? data?.content ?? '';
        if (agentName) {
          setOutputs((prev) => ({ ...prev, [agentName]: output }));
        }
      } else if (event === 'debate_complete') {
        completedRef.current = true;
        setCompleted(true);
        const id = data?.attack_id || liveAttackIdRef.current;
        if (id) onAttackIdRef.current?.(id);
      }
    };

    const run = async () => {
      while (!cancelled && !completedRef.current) {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          if (attempt > 0) setReconnecting(true);
          if (isDemo) {
            await streamReplay({
              attackId,
              delaySec: 4,
              onEvent: handleEvent,
              signal: controller.signal,
            });
          } else {
            await streamDebate({
              artifactText,
              artifactTitle: title,
              onEvent: handleEvent,
              signal: controller.signal,
              fast,
            });
          }
          if (!completedRef.current && !cancelled) {
            attempt += 1;
            // Don't give up — polling is now source of truth, but try to
            // reconnect SSE for live updates while it lasts.
            if (attempt > 5) break;
            setReconnecting(true);
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          break;
        } catch (e) {
          if (cancelled || e.name === 'AbortError') break;
          attempt += 1;
          if (attempt > 5) break;
          setReconnecting(true);
          await new Promise((r) => setTimeout(r, 3000));
        } finally {
          setReconnecting(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      try { abortRef.current?.abort(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Polling: source of truth for agent state and completion ----
  useEffect(() => {
    if (isDemo) return; // demo replays don't need polling
    let active = true;

    const poll = async () => {
      const id = liveAttackIdRef.current || attackId;
      if (!id) return;
      try {
        const data = await fetchAttack(id);
        if (!active) return;

        // Update outputs from API response. /attacks/{id} uses output_text.
        if (data?.agents?.length) {
          setOutputs((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const a of data.agents) {
              const text = a?.output_text || a?.output;
              if (a?.agent_name && text && next[a.agent_name] !== text) {
                next[a.agent_name] = text;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }

        // Backend status governs view transitions
        const status = data?.attack?.status;
        if (status && !started) setStarted(true);
        if (status === 'complete' && !completedRef.current) {
          completedRef.current = true;
          setCompleted(true);
          if (data?.attack?.id) onAttackIdRef.current?.(data.attack.id);
        } else if (status === 'failed') {
          setFailed(true);
          if (!error) setError('Backend reports this debate failed.');
        }
      } catch (_) {
        // ignore polling errors — SSE may still be alive, or we'll retry
      }
    };

    poll(); // immediate first poll
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(interval); };
  }, [attackId, isDemo, started]); // eslint-disable-line react-hooks/exhaustive-deps

  // After completion (from either SSE or polling), transition to report
  useEffect(() => {
    if (!completed) return;
    const id = liveAttackIdRef.current || attackId;
    const t = setTimeout(
      () => onCompleteRef.current?.(id, outputsRef.current),
      2000
    );
    return () => clearTimeout(t);
  }, [completed, attackId]);

  const stateFor = (id) => {
    if (outputs[id]) return 'complete';
    if (failed) return 'dormant';
    let firstIncompleteIdx = -1;
    for (let i = 0; i < SEQUENCE.length; i++) {
      if (!outputs[SEQUENCE[i]]) { firstIncompleteIdx = i; break; }
    }
    const idx = SEQUENCE.indexOf(id);
    if (idx === firstIncompleteIdx && started) return 'thinking';
    return 'dormant';
  };

  const completedCount = useMemo(
    () => Object.keys(outputs).filter((k) => SEQUENCE.includes(k)).length,
    [outputs]
  );
  const totalCount = SEQUENCE.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const statusEyebrow = failed
    ? 'Debate failed'
    : completed
      ? 'Debate complete'
      : isResume
        ? 'Resumed — polling status'
        : started
          ? 'Debate in progress'
          : 'Connecting…';

  return (
    <div className="processing">
      <header className="proc-header">
        <button className="btn-text" onClick={onReset} type="button">
          ← Back
        </button>
        <div className="proc-title-block">
          <div className="proc-eyebrow">
            <span className={`proc-pulse ${started && !completed && !failed ? 'live' : ''} ${failed ? 'failed' : ''}`} />
            {statusEyebrow}
            {reconnecting && <span className="proc-reconnect"> · reconnecting</span>}
          </div>
          <h2 className="proc-title">{title || 'Untitled debate'}</h2>
          {attackId && (
            <div className="proc-attack-id">
              attack_id: <code>{attackId}</code>
            </div>
          )}
        </div>
        <div className="proc-meta">
          <div className="meta-line">
            <span className="meta-num">{completedCount}/{totalCount}</span>
            <span className="meta-lbl">agents</span>
          </div>
          <div className="meta-line">
            <span className="meta-num">{formatTime(elapsed)}</span>
            <span className="meta-lbl">elapsed</span>
          </div>
        </div>
      </header>

      <div className="progress-bar">
        <div className={`progress-fill ${failed ? 'progress-failed' : ''}`} style={{ width: `${progressPct}%` }} />
      </div>

      {error && (
        <div className="error-banner">
          {error}{' '}
          <button className="btn-link" onClick={onReset}>Restart</button>
        </div>
      )}

      <div className="grid">
        <div className="row-label row-label-attackers">Attackers</div>
        <div className="row row-attackers">
          {ATTACKERS.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              role="attacker"
              state={stateFor(a.id)}
              output={outputs[a.id]}
            />
          ))}
        </div>

        <div className="row-divider" />

        <div className="row-label row-label-defenders">Defenders</div>
        <div className="row row-defenders">
          {DEFENDERS.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              role="defender"
              state={stateFor(a.id)}
              output={outputs[a.id]}
            />
          ))}
        </div>

        <div className="row-divider" />

        <div className="synth-row">
          <AgentCard
            agent={SYNTH}
            role="synthesizer"
            state={stateFor(SYNTH.id)}
            output={outputs[SYNTH.id]}
            wide
          />
        </div>
      </div>

      {completed && (
        <div className="processing-overlay">
          <div className="overlay-text">DEBATE COMPLETE</div>
          <div className="overlay-sub">Compiling verdict…</div>
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, role, state, output, wide }) {
  return (
    <div className={`card card-${role} card-${state} ${wide ? 'card-wide' : ''}`}>
      <div className="card-corner" />
      <div className="card-header">
        <div className="card-id">
          <div className="card-name">{agent.name}</div>
          <div className="card-lane">{agent.lane}</div>
        </div>
        <div className="card-badge">Kimi&nbsp;K2.5</div>
      </div>
      <div className="card-body">
        {state === 'dormant' && (
          <div className="card-status">
            <span className="status-dot" /> Standby
          </div>
        )}
        {state === 'thinking' && (
          <div className="card-status thinking">
            <span className="status-dot pulsing" /> Thinking…
          </div>
        )}
        {state === 'complete' && (
          <div className="card-output">
            {truncate(output, wide ? 220 : 90)}
          </div>
        )}
      </div>
      <div className="card-footer">
        <span className="card-role-tag">{roleTag(role)}</span>
      </div>
    </div>
  );
}

function roleTag(role) {
  if (role === 'attacker') return 'ATK';
  if (role === 'defender') return 'DEF';
  return 'SYN';
}

function truncate(s, n) {
  if (!s || typeof s !== 'string') return '';
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > n ? trimmed.slice(0, n).trim() + '…' : trimmed;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
