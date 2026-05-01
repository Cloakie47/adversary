// Backend connection + SSE handling + synthesizer parsing
export const BACKEND_URL = 'http://143.110.185.142:8000';
export const DEMO_ATTACK_ID = '3f456848-783f-402e-b507-2079c1ca17d8';

// Stream a live debate. Defaults to POST /debate-fast (3-5 min).
// Pass { fast: false } to use the legacy POST /debate (~25 min) endpoint.
export async function streamDebate({ artifactText, artifactTitle, onEvent, signal, fast = true }) {
  const path = fast ? '/debate-fast' : '/debate';
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifact_text: artifactText, artifact_title: artifactTitle }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Debate request failed: ${response.status} ${response.statusText}`);
  }
  await processSSE(response, onEvent, signal);
}

// Stream a replay via GET /stream-replay/{id}
export async function streamReplay({ attackId, delaySec = 4, onEvent, signal }) {
  const response = await fetch(
    `${BACKEND_URL}/stream-replay/${attackId}?delay_sec=${delaySec}`,
    { signal }
  );
  if (!response.ok) {
    throw new Error(`Replay request failed: ${response.status} ${response.statusText}`);
  }
  await processSSE(response, onEvent, signal);
}

// Fetch full attack record
export async function fetchAttack(attackId) {
  const response = await fetch(`${BACKEND_URL}/attacks/${attackId}`);
  if (!response.ok) {
    throw new Error(`Fetch attack failed: ${response.status}`);
  }
  return response.json();
}

// List languages already cached server-side for this attack.
// Response shape: { translations: [{ lang, ... }, ...] }
export async function fetchTranslations(attackId) {
  const response = await fetch(`${BACKEND_URL}/translations/${attackId}`);
  if (!response.ok) {
    throw new Error(`Translations fetch failed: ${response.status}`);
  }
  return response.json();
}

// Stream a translation via POST /translate/{id}?lang=…
// Events: translation_start { cached }, translation_delta { text }, translation_complete
export async function streamTranslation({ attackId, lang, onEvent, signal }) {
  const response = await fetch(
    `${BACKEND_URL}/translate/${attackId}?lang=${encodeURIComponent(lang)}`,
    { method: 'POST', signal }
  );
  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status} ${response.statusText}`);
  }
  await processSSE(response, onEvent, signal);
}

// Direct PDF download URL — caller does window.open(url, "_blank").
// Pass `lang` to download a translated PDF (e.g. "ja", "es"); omit or pass
// "en" for the default English version.
export function getPdfUrl(attackId, lang) {
  const code = lang ? String(lang).toLowerCase() : '';
  if (!code || code === 'en') return `${BACKEND_URL}/pdf/${attackId}`;
  return `${BACKEND_URL}/pdf/${attackId}?lang=${encodeURIComponent(code)}`;
}

// Idempotent attestation generation. Returns { attestation, alg, note }.
export async function requestAttestation(attackId) {
  const response = await fetch(`${BACKEND_URL}/attest/${attackId}`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Attestation request failed: ${response.status}`);
  }
  return response.json();
}

// Parse SSE stream from a fetch Response
async function processSSE(response, onEvent, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines (\n\n).
      // Some servers emit \r\n — handle both.
      let sepIdx;
      while ((sepIdx = findEventBoundary(buffer)) !== -1) {
        const block = buffer.slice(0, sepIdx).replace(/\r/g, '');
        // Skip the appropriate number of newlines for whichever boundary matched
        const remainder = buffer.slice(sepIdx);
        const advance = remainder.startsWith('\r\n\r\n') ? 4 : 2;
        buffer = buffer.slice(sepIdx + advance);
        const evt = parseEventBlock(block);
        if (evt && evt.event !== 'keepalive') {
          onEvent(evt);
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch (_) {}
  }
}

function findEventBoundary(buf) {
  const a = buf.indexOf('\n\n');
  const b = buf.indexOf('\r\n\r\n');
  if (a === -1) return b === -1 ? -1 : b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseEventBlock(block) {
  const lines = block.split('\n');
  let event = 'message';
  const dataLines = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return { event, data: null };
  const dataStr = dataLines.join('\n');
  let data = dataStr;
  try { data = JSON.parse(dataStr); } catch (_) {}
  return { event, data };
}

// ---- Synthesizer parsing ----

// Known section boundaries — any of these headers terminates a previous section.
const SECTION_KEYS = [
  'VERDICT',
  'SURVIVING KILL-SHOT RISKS',
  'SURVIVING KILL SHOT RISKS',
  'KILL-SHOT RISKS',
  'DEFENDED STRENGTHS',
  'STRENGTHS',
  'CRUXES',
  'CRUX',
  'FOUNDER MUST ANSWER BY MONDAY',
  'FOUNDER MUST ANSWER',
  'QUESTIONS FOR FOUNDER',
  'SOURCES CITED ACROSS DEBATE',
  'SOURCES CITED',
  'ON-CHAIN ATTESTATION',
  'ONCHAIN ATTESTATION',
];

export function parseSynthesizer(text) {
  const result = {
    verdict: '',
    risks: [],
    strengths: [],
    cruxes: [],
    founderQuestions: [],
    sourcesCited: '0',
    attestation: 'N/A',
    rawSummary: '',
  };
  if (!text || typeof text !== 'string') return result;

  const verdictMatch = text.match(/VERDICT:\s*([^\n\r]+)/i);
  if (verdictMatch) result.verdict = cleanVerdict(verdictMatch[1]);

  result.risks = extractList(text, [
    'SURVIVING KILL-SHOT RISKS',
    'SURVIVING KILL SHOT RISKS',
    'KILL-SHOT RISKS',
  ]);
  result.strengths = extractList(text, ['DEFENDED STRENGTHS', 'STRENGTHS']);
  result.cruxes = extractList(text, ['CRUXES', 'CRUX']);
  result.founderQuestions = extractList(text, [
    'FOUNDER MUST ANSWER BY MONDAY',
    'FOUNDER MUST ANSWER',
    'QUESTIONS FOR FOUNDER',
  ]);

  const sourcesMatch = text.match(/SOURCES CITED(?:\s+ACROSS\s+DEBATE)?:\s*([^\n\r]+)/i);
  if (sourcesMatch) {
    const num = sourcesMatch[1].match(/\d+/);
    if (num) result.sourcesCited = num[0];
  }

  const attestationMatch = text.match(/ON-?CHAIN ATTESTATION:\s*([^\n\r]+)/i);
  if (attestationMatch) result.attestation = attestationMatch[1].trim();

  const summary = extractBetween(text, 'VERDICT');
  if (summary) {
    const firstPara = summary.split(/\n\s*\n/)[0].trim();
    result.rawSummary = firstPara;
  }

  return result;
}

function cleanVerdict(s) {
  return s.replace(/^[\-—\s]+/, '').replace(/[.!?\s]+$/, '').trim();
}

function sectionBoundaryPattern() {
  const alts = SECTION_KEYS
    .map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?:^|\\n)\\s*(?:${alts})\\b[^\\n]*:`, 'i');
}

function extractBetween(text, header) {
  const escaped = header.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const headRe = new RegExp(`${escaped}\\b[^\\n]*:[^\\n]*\\n`, 'i');
  const headMatch = headRe.exec(text);
  if (!headMatch) return '';
  const startIdx = headMatch.index + headMatch[0].length;
  const rest = text.slice(startIdx);
  const boundary = sectionBoundaryPattern();
  const nextMatch = boundary.exec(rest);
  const endIdx = nextMatch ? nextMatch.index : rest.length;
  return rest.slice(0, endIdx).trim();
}

function extractList(text, headers) {
  for (const header of headers) {
    const content = extractBetween(text, header);
    if (content) return parseNumberedList(content);
  }
  return [];
}

function parseNumberedList(content) {
  const items = [];
  const lines = content.split('\n');
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      if (current) { items.push(current.trim()); current = null; }
      continue;
    }
    const numMatch = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (numMatch) {
      if (current) items.push(current.trim());
      current = numMatch[1];
    } else if (current !== null) {
      current += ' ' + line.trim();
    } else {
      current = line.trim();
    }
  }
  if (current) items.push(current.trim());
  return items.filter((s) => s && s.length > 1);
}

export function getVerdictColor(verdict) {
  if (!verdict) return 'amber';
  const v = verdict.toLowerCase();
  if (v.includes('do not') || v.includes('do-not') || v.includes('kill') || v.includes('reject')) {
    return 'red';
  }
  if (v.includes('pause')) return 'amber';
  if (v.includes('ship')) return 'green';
  return 'amber';
}

// Display the verdict slug uppercased, preserving hyphens.
// "pause-and-validate" → "PAUSE-AND-VALIDATE"
export function formatVerdict(v) {
  if (v == null) return '';
  return String(v).toUpperCase().trim();
}

// Strip markdown code fences (``` or ```lang) from the start/end of a block.
// The synthesizer occasionally wraps its plain-text output in fences.
export function stripCodeFences(input) {
  if (!input || typeof input !== 'string') return input || '';
  let s = input.trim();
  // Leading fence: ``` optionally followed by a language tag, then newline
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*\n/, '');
  // Trailing fence
  s = s.replace(/\n```\s*$/, '');
  // Edge case: only a stray ``` at start or end with no newline
  s = s.replace(/^```\s*/, '');
  s = s.replace(/\s*```$/, '');
  return s;
}

// Parse the synthesizer's final_report plain text using the exact section
// headers the backend produces. Each section is a numbered list (1., 2., …)
// terminated by the next header or end of text.
export function parseFinalReport(text) {
  const result = {
    risks: [],
    strengths: [],
    cruxes: [],
    founderQuestions: [],
    sourcesCited: '0',
    attestation: '',
  };
  if (!text || typeof text !== 'string') return result;
  // Strip markdown fences if the synthesizer wrapped the report in ```
  text = stripCodeFences(text);

  const HEADERS = [
    { key: 'risks',            header: 'SURVIVING KILL-SHOT RISKS (ranked):' },
    { key: 'strengths',        header: 'DEFENDED STRENGTHS:' },
    { key: 'cruxes',           header: 'CRUXES (validate this week):' },
    { key: 'founderQuestions', header: 'FOUNDER MUST ANSWER BY MONDAY:' },
  ];
  const allBoundaries = [
    ...HEADERS.map((h) => h.header),
    'SOURCES CITED ACROSS DEBATE:',
    'ON-CHAIN ATTESTATION:',
  ];

  for (const { key, header } of HEADERS) {
    const idx = text.indexOf(header);
    if (idx === -1) continue;
    const sectionStart = idx + header.length;
    let sectionEnd = text.length;
    for (const other of allBoundaries) {
      if (other === header) continue;
      const i = text.indexOf(other, sectionStart);
      if (i !== -1 && i < sectionEnd) sectionEnd = i;
    }
    result[key] = parseNumberedLines(text.slice(sectionStart, sectionEnd));
  }

  const sourcesMatch = text.match(/SOURCES CITED ACROSS DEBATE:\s*(\d+)/);
  if (sourcesMatch) result.sourcesCited = sourcesMatch[1];

  const attestationMatch = text.match(/ON-CHAIN ATTESTATION:\s*(.+)/);
  if (attestationMatch) result.attestation = attestationMatch[1].trim();

  return result;
}

// Pull numbered items "1. …", "2. …" (up to 9 digits + ". "), preserving
// the full line content. Continuations on un-numbered lines are appended.
function parseNumberedLines(block) {
  const items = [];
  const lines = block.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) {
      if (current != null) { items.push(current.trim()); current = null; }
      continue;
    }
    const m = trimmed.match(/^(\d{1,9})\.\s+(.+)$/);
    if (m) {
      if (current != null) items.push(current.trim());
      current = m[2];
    } else if (current != null) {
      current += ' ' + trimmed;
    }
  }
  if (current != null) items.push(current.trim());
  return items;
}

// Read agent output handling either field name. SSE events use `output`,
// the GET /attacks/{id} endpoint uses `output_text`.
export function readAgentOutput(agent, fallbackByName) {
  if (!agent) return fallbackByName || '';
  return (
    agent.output_text ||
    agent.output ||
    (fallbackByName != null ? fallbackByName : '') ||
    ''
  );
}

// Pretty role display from agent_name like "attacker-skeptic"
export function splitAgentName(name) {
  if (!name) return { role: 'agent', sub: '' };
  if (name === 'synthesizer') return { role: 'synthesizer', sub: 'synthesizer' };
  const idx = name.indexOf('-');
  if (idx === -1) return { role: name, sub: '' };
  return { role: name.slice(0, idx), sub: name.slice(idx + 1) };
}
