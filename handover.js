// Handover Ledger: the logic. No DOM in this file, so the page and the Node tests load the same code.
// Built by Tab (an AI assistant) for Akshay Wagh's CodersInPune Round 2 entry, team RELAYPROOF.

export const KIND_LABEL = {
  notes: 'Notes',
  issues: 'Issue export (CSV)',
  commits: 'Commit log',
  answer: 'Leaver answer',
};

const STOP = new Set((
  'a an and are as at be been but by can do does for from had has have i if in into is it its just no nor not of on ' +
  'or our so such than that the their them then there these they this to too us was we were what when which who will ' +
  'with yet you your until still need needs open pending todo going only also very here about over after before while ' +
  'now also one two'
).split(/\s+/));

const SIGNAL_NEWER = /\b(now|moved|handed over|reassigned|took over|taking over|from today|instead)\b/i;
const RE_DECISION = /\b(decided|decision|we will|we'll|agreed|we chose|going with|settled on|approved)\b/i;
const RE_OPEN = /\b(todo|to do|open|pending|unfinished|not yet|still need|still to|remaining|next step|waiting on|blocked|unassigned|not started)\b/i;
const RE_RISK = new RegExp(
  '\\b(risk|fragile|might|could break|blocker|concern|flaky|untested|no tests?|hack|workaround|single point of failure|' +
  'depends on|double[- ]charge|expires?|expiring|lapses?|lapsed|overdue|at risk|outage|failure|fails?|failing|breaks?)\\b' +
  '|\\bif\\b[^.;]*\\b(?:fails?|failed|lapses?|breaks?|expires?|misses?|missed|slips?)\\b', 'i');
const NOT_NAMES = new Set(['The', 'This', 'It', 'We', 'Team', 'Next', 'Also', 'Note', 'Risk', 'Open', 'Decision', 'Here', 'So',
  'There', 'Leaver', 'If', 'When', 'Once', 'Before', 'After', 'All', 'Each', 'Every', 'Please', 'And', 'But', 'Our', 'Certificate',
  'That', 'Which', 'Someone', 'Nobody']);
// Owner sentences: "Rohit owns X", "Rohit handles X", "Rohit is responsible for X", "Rohit will finish X by 15 Nov".
const OWN_RE = /\b(?:([A-Z][\w'-]+)|(I))\s+(?:now\s+)?(?:owns?|handles?|(?:is|are) (?:now )?(?:responsible for|handling|taking|owning|on)|am (?:now )?(?:responsible for|handling|taking|on)|will (?:now )?(?:handle|own|take|finish|complete|deliver|fix|ship|build|review|write|migrate|deploy|test|close|resolve)|has taken over|is taking over|took over|picked up)\s+(?:the\s+|our\s+|this\s+|a\s+)?([^.;,!?\n]+)/;
const MOVE_RE = /\b(.+?)\s+(?:is now |is |was |now |has been )?(?:owned by|handled by|reassigned to|handed over to|moved to|assigned to)\s+([A-Z][\w'-]+)/;
const COMMIT_RE = /^([0-9a-f]{6,40})\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/i;
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RE = new RegExp(`\\b(\\d{1,2}\\s+(?:${MONTHS})\\.?(?:\\s+\\d{4})?|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{4}-\\d{2}-\\d{2})\\b`, 'i');
// Where an item's name stops: the clause after it ("PDF export is still open", "retry job until Friday").
const CLAUSE = /\s+(?:and|but|which|that|who|with|so|because|since|until|by|before|after|while|next|is|are|was|were|has|have|had|still|not|yet|if|due|expires?|lapses?)\b.*$/i;

export function tokens(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

// Two subjects are the same when they share at least two significant words (or all of a one-word subject).
export function sameSubject(a, b) {
  if (!a.length || !b.length) return false;
  const sb = new Set(b);
  const overlap = new Set(a.filter((w) => sb.has(w))).size;
  return overlap >= Math.min(2, new Set(a).size, new Set(b).size) && overlap > 0;
}

// The item's own name, whole: no truncation, no status clause, no leading article or label.
export function itemSubject(raw, { commit = false } = {}) {
  const orig = String(raw || '').replace(/\s+/g, ' ').trim();
  let s = orig.replace(/^(risk|open|decision|todo|to do|blocked|pending)\s*:\s*/i, '');
  if (commit) s = s.split(/[,;]/)[0];
  s = s.replace(/^(the|our|this|a|an)\s+/i, '').replace(CLAUSE, '').replace(/[.;,!?\s]+$/, '').trim();
  return s || orig.replace(/[.;,!?\s]+$/, '');
}

export function shortLabel(s) {
  return String(s).replace(/^(risk|open|decision|todo|blocked)\s*:\s*/i, '')
    .replace(/^the\s+/i, '').replace(/[.;,!?\s]+$/, '').trim();
}

// "1 entry", "2 entries": counts read as words, never "1 entries".
export function pl(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

// Times in the page and the brief are India time.
export function fmtIST(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} IST`;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// Split a source into units, each a verbatim span of its text with offsets.
export function splitUnits(source) {
  const units = [];
  const text = source.text || '';
  if (source.kind === 'issues') {
    let pos = 0;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const t = line.trim();
      if (t && !/^id,/i.test(t)) {
        const start = pos + line.indexOf(t);
        units.push({ text: t, start, end: start + t.length, sourceId: source.id });
      }
      pos += raw.length + 1;
    }
    return units;
  }
  if (source.kind === 'commits') return commitUnits(source);
  const lineRe = /[^\n]+/g;
  let m;
  while ((m = lineRe.exec(text))) {
    const sentRe = /[^.!?;\n]+[.!?;]?/g;
    let s;
    while ((s = sentRe.exec(m[0]))) {
      const t = s[0].trim();
      if (!t) continue;
      const start = m.index + s.index + s[0].indexOf(t);
      units.push({ text: t, start, end: start + t.length, sourceId: source.id });
    }
  }
  return units;
}

// Commit log: the one-line form ("sha author date subject") and the standard multi-line `git log` form.
// In the multi-line form each commit's first indented line is its subject; author and date ride on every unit of that commit.
function commitUnits(source) {
  const units = [];
  const text = source.text || '';
  let pos = 0;
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    const at = pos + line.indexOf(t);
    if (/^commit\s+[0-9a-f]{6,40}\b/i.test(t)) {
      cur = { author: '', date: '', pendingSubject: true };
    } else if (cur && /^Author:/i.test(t)) {
      cur.author = t.replace(/^Author:\s*/i, '').replace(/\s*<[^>]*>\s*$/, '').trim();
    } else if (cur && /^Date:/i.test(t)) {
      const d = new Date(t.replace(/^Date:\s*/i, ''));
      cur.date = Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    } else if (cur && /^\s{4}\S/.test(line)) {
      units.push({ text: t, start: at, end: at + t.length, sourceId: source.id, author: cur.author, date: cur.date, subject: cur.pendingSubject });
      cur.pendingSubject = false;
    } else if (t) {
      units.push({ text: t, start: at, end: at + t.length, sourceId: source.id });
    }
    pos += raw.length + 1;
  }
  return units;
}

// Minimal CSV line parser (double quotes, no embedded newlines).
export function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function ownerIn(t, source) {
  const m = OWN_RE.exec(t);
  if (!m) return null;
  let owner = m[1] || null;
  if (m[2]) owner = source.author || null;
  if (!owner || NOT_NAMES.has(owner)) return null;
  return { owner, subject: itemSubject(m[3]) };
}

// Rule-based extraction: every claim is a span of the source, so the quote is always checkable.
function claimsFor(unit, source) {
  const out = [];
  // For a commit line the date and author are metadata; only the subject is read for dates and claims.
  let t = unit.text;
  let commitMeta = null;
  if (source.kind === 'commits') {
    const m = unit.author ? null : COMMIT_RE.exec(unit.text);
    const author = m ? m[2] : (unit.author || null);
    const date = m ? m[3] : (unit.date || null);
    if (m) t = m[4];
    if (author && (m || unit.subject)) commitMeta = { author, date, subject: t };
  }
  const dm = DATE_RE.exec(t);
  const due = dm ? dm[1] : null;
  const base = { sourceId: unit.sourceId, start: unit.start, end: unit.end, quote: unit.text, order: unit.order, due };
  const make = (type, statement, owner, subject, extra = {}) => ({
    ...base, id: `${unit.sourceId}:${unit.start}-${unit.end}:${type}`, type, statement, owner,
    subject, item: subject, label: shortLabel(subject || statement), tokens: tokens(subject || statement),
    supersedes: false, candidate: false, ...extra,
  });

  if (source.kind === 'issues') {
    const header = parseCsvLine(((source.text || '').split('\n')[0] || '').replace(/\r$/, '')).map((h) => h.toLowerCase());
    const f = parseCsvLine(unit.text);
    const get = (name) => (header.indexOf(name) >= 0 ? f[header.indexOf(name)] || '' : '');
    const title = get('title'), owner = get('owner'), status = get('status').toLowerCase();
    if (!title) return out;
    if (owner) out.push(make('owner', `${owner} owns ${title}`, owner, title));
    if (/open|progress|todo|pending|blocked/.test(status)) out.push(make('open', `${title} (${status})`, null, title));
    if (/blocked/.test(status)) out.push(make('risk', `${title} is blocked`, null, title));
    return out;
  }

  if (commitMeta) {
    const { author, date } = commitMeta;
    out.push(make('activity', `${author} changed: ${t}`, null, t, { author, date }));
    // The commit author is a candidate owner: it says who wrote the change, not who owns the item.
    const subj = itemSubject(t, { commit: true });
    out.push(make('owner', `${author} owns ${subj}`, author, subj, { candidate: true, author, date }));
  }

  const own0 = ownerIn(t, source) || (() => { const mv = MOVE_RE.exec(t); return mv && !NOT_NAMES.has(mv[2]) ? { owner: mv[2], subject: itemSubject(mv[1]) } : null; })();
  const newer = SIGNAL_NEWER.test(t);
  if (own0) out.push(make('owner', `${own0.owner} owns ${own0.subject}`, own0.owner, own0.subject, { supersedes: newer }));
  if (RE_DECISION.test(t)) out.push(make('decision', t, null, t));
  if (RE_OPEN.test(t)) out.push(make('open', t, null, itemSubject(t)));
  if (RE_RISK.test(t)) out.push(make('risk', t, null, itemSubject(t)));
  if (dm) out.push(make('deadline', `Due ${dm[1]}`, null, t));
  return out;
}

// The quote validator: a claim survives only if its quote is the exact span it names in the source.
export function validate(claims, sources) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const kept = [], dropped = [];
  for (const c of claims) {
    const src = byId.get(c.sourceId);
    const ok = !!src && !!c.quote && src.text.slice(c.start, c.end) === c.quote && norm(src.text).includes(norm(c.quote));
    (ok ? kept : dropped).push(c);
  }
  return { kept, dropped };
}

// Planted false claims: the validator must drop every one. Run on each build as a self-test.
export function plantedFakes(sources, kept) {
  const fakes = [];
  const first = sources[0];
  if (!first) return fakes;
  fakes.push({ id: 'planted-1', type: 'owner', sourceId: first.id, start: 0, end: 20, quote: 'Dana owns the billing migration', statement: 'Dana owns the billing migration', owner: 'Dana', tokens: ['billing', 'migration'], order: -1 });
  const withOwner = kept.find((c) => c.type === 'owner' && !c.candidate && c.owner && c.quote.includes(c.owner));
  if (withOwner) {
    const other = sources.find((s) => s.id !== withOwner.sourceId) || first;
    fakes.push({ ...withOwner, id: 'planted-2', sourceId: other.id, quote: withOwner.quote.replace(withOwner.owner, 'Mira'), statement: `Mira owns ${withOwner.label}`, owner: 'Mira', order: -1 });
    fakes.push({ ...withOwner, id: 'planted-3', start: withOwner.start + 1, end: withOwner.end + 1, order: -1 });
  }
  return fakes;
}

export function buildModel(state) {
  const sources = state.sources || [];
  const review = state.review || {};
  let order = 0;
  const raw = [];
  for (const s of sources) {
    for (const u of splitUnits(s)) { u.order = order++; raw.push(...claimsFor(u, s)); }
  }
  const { kept, dropped } = validate(raw, sources);
  const planted = plantedFakes(sources, kept);
  const plantedResult = validate(planted, sources);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  for (const c of kept) {
    c.source = srcById.get(c.sourceId);
    c.review = (review[c.id] && review[c.id].state) || 'pending';
    c.attested = c.source.kind === 'answer';
  }

  // Owner clusters: claims about the same item. Named owners and commit-author candidates share a cluster.
  const owners = kept.filter((c) => c.type === 'owner').sort((a, b) => a.order - b.order);
  const clusters = [];
  for (const c of owners) {
    let cl = clusters.find((k) => sameSubject(k.tokens, c.tokens));
    if (!cl) { cl = { key: c.tokens.join(' '), tokens: c.tokens, label: c.item, claims: [], live: [], conflict: false, current: null }; clusters.push(cl); }
    cl.claims.push(c);
  }
  for (const cl of clusters) {
    const named = cl.claims.find((c) => !c.candidate);
    if (named) cl.label = named.item;
    const latest = cl.claims[cl.claims.length - 1];
    for (const c of cl.claims) {
      if (c !== latest && c.owner.toLowerCase() !== latest.owner.toLowerCase() && latest.supersedes) c.supersededBy = latest.id;
    }
    cl.live = cl.claims.filter((c) => !c.supersededBy && c.review !== 'rejected');
    const namedLive = cl.live.filter((c) => !c.candidate);
    const names = new Set(cl.live.map((c) => c.owner.toLowerCase()));
    // A conflict is two different owners where at least one is a named owner. Commit authors alone do not dispute.
    cl.conflict = names.size > 1 && namedLive.length > 0;
    const pool = namedLive.length ? namedLive : cl.live;
    cl.current = pool.length ? pool[pool.length - 1] : null;
  }
  const clusterOf = (c) => clusters.find((k) => k.claims.includes(c));

  // Corroborated only by another source saying the same thing: an owner needs the same owner name; other kinds the same kind.
  const corroborated = (c) => kept.some((o) => o.sourceId !== c.sourceId && o.type === c.type && sameSubject(c.tokens, o.tokens)
    && (c.type !== 'owner' || o.owner.toLowerCase() === c.owner.toLowerCase()));
  for (const c of kept) {
    const cl = clusterOf(c);
    if (c.supersededBy) c.status = 'superseded';
    else if (cl && cl.conflict && cl.live.includes(c)) c.status = 'disputed';
    else if (c.attested) c.status = 'leaver-attested';
    else if (c.candidate) c.status = 'candidate';
    else c.status = corroborated(c) ? 'corroborated' : 'single-source';
  }

  // Link open items and risks to the owner cluster they belong to.
  const linkOwner = (c) => clusters.find((cl) => cl.current && sameSubject(c.tokens, cl.tokens)) || null;
  for (const c of kept.filter((x) => x.type === 'open' || x.type === 'risk')) {
    const cl = linkOwner(c);
    c.ownerName = cl ? cl.current.owner : null;
  }

  // Gap questions: what the sources leave unresolved. One question per item, however many sources mention it.
  const gaps = [];
  const groupBy = (list) => {
    const groups = [];
    for (const c of list) {
      const g = groups.find((k) => sameSubject(k.tokens, c.tokens));
      if (g) g.members.push(c); else groups.push({ tokens: c.tokens, members: [c] });
    }
    return groups;
  };
  for (const cl of clusters.filter((k) => k.conflict)) {
    const byLower = new Map();
    for (const c of cl.live) if (!byLower.has(c.owner.toLowerCase())) byLower.set(c.owner.toLowerCase(), c.owner);
    const names = [...byLower.values()];
    gaps.push({ id: `gap:conflict:${cl.key}`, kind: 'conflict', subject: cl.label, names, members: cl.live.map((c) => c.id),
      question: `The sources name different owners for "${cl.label}": ${names.join(' and ')}. Who owns it now?` });
  }
  const openNoOwner = kept.filter((x) => x.type === 'open' && !x.ownerName && !x.supersededBy && x.review !== 'rejected');
  for (const g of groupBy(openNoOwner)) {
    const rep = g.members[0];
    gaps.push({ id: `gap:owner:${rep.tokens.join(' ')}`, kind: 'no-owner', subject: rep.item, members: g.members.map((c) => c.id),
      question: `Who owns "${rep.item}"? It is open and no owner is named.` });
  }
  const riskNoOwner = kept.filter((x) => x.type === 'risk' && !x.ownerName && !x.supersededBy && x.review !== 'rejected');
  for (const g of groupBy(riskNoOwner)) {
    const rep = g.members[0];
    // A risk on an item already asking "who owns it" is one question, not two.
    if (gaps.some((x) => x.kind === 'no-owner' && sameSubject(tokens(x.subject), rep.tokens))) continue;
    gaps.push({ id: `gap:risk:${rep.tokens.join(' ')}`, kind: 'risk-owner', subject: rep.item, members: g.members.map((c) => c.id),
      question: `Who is watching this risk: "${rep.item}"?` });
  }

  const byType = (t) => kept.filter((c) => c.type === t && c.review !== undefined);
  return {
    claims: kept,
    dropped,
    clusters,
    gaps,
    activity: byType('activity'),
    sections: {
      owners: clusters.filter((cl) => cl.current).map((cl) => ({ cluster: cl, current: cl.current, live: cl.live, conflict: cl.conflict, history: cl.claims.filter((c) => c.supersededBy) })),
      decisions: byType('decision'),
      open: byType('open'),
      risks: byType('risk'),
      deadlines: byType('deadline'),
    },
    selfTest: { planted: planted.length, dropped: plantedResult.dropped.length },
    counts: {
      entries: sources.length,
      units: order,
      claims: kept.length,
      dropped: dropped.length,
      gaps: gaps.length,
    },
  };
}

// The answer to a gap becomes a leaver-attested source sentence, so it runs through the same rules and validator.
export function answerSentence(gap, name) {
  const who = String(name || '').trim().replace(/[^\w' -]/g, '').slice(0, 40).trim();
  if (!who || !gap || !gap.subject) return null;
  if (gap.kind === 'conflict') return `${who} now owns ${gap.subject}.`;
  return `${who} owns ${gap.subject}.`;
}

const line = (c) => `- ${c.statement}${c.due ? ` (due ${c.due})` : ''} _(${c.source.label}, status: ${c.status}${c.review !== 'pending' ? `, ${c.review}` : ''})_\n  > "${c.quote}"`;

export function briefMarkdown(model, title = 'Handover brief', state = null) {
  const s = model.sections;
  const live = (arr) => arr.filter((c) => !c.supersededBy && c.review !== 'rejected');
  const out = [`# ${title}`, '', `Built by Tab (an AI assistant) for Akshay Wagh, CodersInPune Round 2, team RELAYPROOF. Every line quotes its source.`, ''];
  out.push('## Owners');
  let any = false;
  for (const o of s.owners) {
    any = true;
    if (o.conflict) for (const c of o.live) out.push(line(c) + ' — DISPUTED, see questions');
    else out.push(line(o.current));
  }
  if (!any) out.push('- None named.');
  out.push('', '## Decisions');
  for (const c of live(s.decisions)) out.push(line(c));
  out.push('', '## Open items');
  for (const c of live(s.open)) out.push(line(c) + (c.ownerName ? '' : '\n  (no owner named)'));
  out.push('', '## Risks');
  for (const c of live(s.risks)) out.push(line(c));
  out.push('', '## Deadlines');
  for (const c of live(s.deadlines)) out.push(line(c));
  out.push('', '## Questions still open');
  if (!model.gaps.length) out.push('- None.');
  for (const g of model.gaps) out.push(`- ${g.question}`);
  out.push('', `Quote check: ${model.counts.claims} claims kept, ${model.counts.dropped} dropped. Planted false claims dropped: ${model.selfTest.dropped} of ${model.selfTest.planted}.`);
  if (state) out.push('', `<!-- handover-ledger-state: ${encodeState(state)} -->`);
  return out.join('\n');
}

export function sourceFromEntry(kind, text, author) {
  return { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, label: KIND_LABEL[kind] + (author ? `, ${author}` : ''), author: author || '', text: String(text || '') };
}

// ---- Sharing: the whole handover travels in a URL hash, or in a .json / .md file.
const toB64 = (str) => {
  let bin = '';
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s) => {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
};

export function encodeState(state) {
  return toB64(JSON.stringify({ app: 'handover-ledger', v: 1, sources: state.sources || [], review: state.review || {} }));
}

// Accepts the shape encodeState and the .json export write. Anything else is refused, not guessed at.
export function normaliseState(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.sources)) throw new Error('This file is not a Handover Ledger handover.');
  const sources = o.sources
    .filter((s) => s && KIND_LABEL[s.kind] && typeof s.text === 'string')
    .slice(0, 200)
    .map((s, i) => ({
      id: String(s.id || `imp${Date.now().toString(36)}${i}`).replace(/[^\w-]/g, '').slice(0, 60) || `imp${i}`,
      kind: s.kind, label: String(s.label || KIND_LABEL[s.kind]).slice(0, 80), author: String(s.author || '').slice(0, 40), text: s.text.slice(0, 200000),
    }));
  const review = {};
  for (const [k, v] of Object.entries(o.review || {})) if (v && (v.state === 'accepted' || v.state === 'rejected')) review[k] = { state: v.state, at: Number(v.at) || 0 };
  return { sources, review };
}

export function decodeState(b64) {
  return normaliseState(JSON.parse(fromB64(b64)));
}

export const STATE_MARK = /<!-- handover-ledger-state: ([A-Za-z0-9_-]+) -->/;

// What an imported file means: a whole handover (.json, or a .md that carries one), or a plain note to add.
export function parseImport(text, name = '') {
  const str = String(text);
  const m = STATE_MARK.exec(str);
  if (m) return { kind: 'state', state: decodeState(m[1]) };
  if (/\.json$/i.test(name) || /^\s*\{/.test(str)) return { kind: 'state', state: normaliseState(JSON.parse(str)) };
  return { kind: 'note', text: str, label: name || 'imported file' };
}

export function shareHash(state) {
  return `#h=${encodeState(state)}`;
}

export function stateFromHash(hash) {
  const m = /^#h=([A-Za-z0-9_-]+)$/.exec(String(hash || ''));
  return m ? decodeState(m[1]) : null;
}
