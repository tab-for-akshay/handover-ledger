// Handover Ledger: the logic. No DOM in this file, so the page and the Node tests load the same code.
// Built by Tab (an AI assistant) for Akshay Wagh's CodersInPune Round 2 entry.

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
const RE_DECISION = /\b(decided|decision|we will|we'll|agreed|we chose|going with|settled on)\b/i;
const RE_OPEN = /\b(todo|to do|open|pending|unfinished|not yet|still need|still to|remaining|next step|waiting on|blocked)\b/i;
const RE_RISK = /\b(risk|fragile|might|could break|blocker|concern|flaky|untested|no tests?|hack|workaround|single point of failure|depends on|double[- ]charge)\b/i;
const NOT_NAMES = new Set(['The', 'This', 'It', 'We', 'Team', 'Next', 'Also', 'Note', 'Risk', 'Open', 'Decision', 'Here', 'So', 'There', 'Leaver']);
const OWN_RE = /\b(?:([A-Z][\w'-]+)|(I))\s+(?:now\s+)?(?:owns|own|is (?:now )?(?:handling|taking|owning|on)|am (?:now )?(?:handling|taking|on)|will (?:now )?(?:handle|own|take)|took over|has taken over|is taking over|picked up|took)\s+(?:the\s+|our\s+|this\s+)?([^.;,!?]+)/;
const MOVE_RE = /\b(.+?)\s+(?:is now |is |was |now |has been )?(?:owned by|handled by|reassigned to|handed over to|moved to|assigned to)\s+([A-Z][\w'-]+)/;
const COMMIT_RE = /^([0-9a-f]{6,40})\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/i;

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

export function shortLabel(s) {
  return String(s).replace(/^(risk|open|decision|todo|blocked)\s*:\s*/i, '')
    .replace(/^the\s+/i, '').replace(/[.;,!?\s]+$/, '')
    .split(/\s+/).slice(0, 7).join(' ');
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// Split a source into units, each a verbatim span of its text with offsets.
export function splitUnits(source) {
  const units = [];
  const text = source.text || '';
  if (source.kind === 'issues' || source.kind === 'commits') {
    let pos = 0;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const t = line.trim();
      if (t && !(source.kind === 'issues' && /^id,/i.test(t))) {
        const start = pos + line.indexOf(t);
        units.push({ text: t, start, end: start + t.length, sourceId: source.id });
      }
      pos += raw.length + 1;
    }
    return units;
  }
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
  return { owner, subject: m[3].trim() };
}

// Rule-based extraction: every claim is a span of the source, so the quote is always checkable.
function claimsFor(unit, source) {
  const out = [];
  const base = { sourceId: unit.sourceId, start: unit.start, end: unit.end, quote: unit.text, order: unit.order };
  const make = (type, statement, owner, subject, extra = {}) => ({
    ...base, id: `${unit.sourceId}:${unit.start}-${unit.end}:${type}`, type, statement, owner,
    subject, label: shortLabel(subject || statement), tokens: tokens(subject || statement),
    supersedes: false, ...extra,
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

  let t = unit.text;
  if (source.kind === 'commits') {
    const m = COMMIT_RE.exec(unit.text);
    if (m) {
      t = m[4];
      out.push(make('activity', `${m[2]} changed: ${m[4]}`, null, m[4], { author: m[2], date: m[3] }));
    }
  }

  const own0 = ownerIn(t, source) || (() => { const mv = MOVE_RE.exec(t); return mv && !NOT_NAMES.has(mv[2]) ? { owner: mv[2], subject: mv[1].trim() } : null; })();
  const own = own0 && { owner: own0.owner, subject: own0.subject.replace(/\s+(until|by|before|after|while|since|next)\b.*$/i, '').trim() };
  const newer = SIGNAL_NEWER.test(t);
  if (own) {
    out.push(make('owner', `${own.owner} owns ${own.subject}`, own.owner, own.subject, { supersedes: newer }));
  }
  if (RE_DECISION.test(t)) out.push(make('decision', t, null, t));
  if (RE_OPEN.test(t)) out.push(make('open', t, null, t));
  if (RE_RISK.test(t)) out.push(make('risk', t, null, t));
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
  const withOwner = kept.find((c) => c.type === 'owner' && c.owner && c.quote.includes(c.owner));
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

  // Owner clusters: claims about the same subject.
  const owners = kept.filter((c) => c.type === 'owner').sort((a, b) => a.order - b.order);
  const clusters = [];
  for (const c of owners) {
    let cl = clusters.find((k) => sameSubject(k.tokens, c.tokens));
    if (!cl) { cl = { key: c.tokens.join(' '), tokens: c.tokens, label: c.label, claims: [], live: [], conflict: false, current: null }; clusters.push(cl); }
    cl.claims.push(c);
  }
  for (const cl of clusters) {
    const latest = cl.claims[cl.claims.length - 1];
    for (const c of cl.claims) {
      if (c !== latest && c.owner !== latest.owner && latest.supersedes) c.supersededBy = latest.id;
    }
    cl.live = cl.claims.filter((c) => !c.supersededBy && c.review !== 'rejected');
    cl.conflict = new Set(cl.live.map((c) => c.owner)).size > 1;
    cl.current = cl.live.length ? cl.live[cl.live.length - 1] : null;
  }

  const corroborated = (c) => kept.some((o) => o.sourceId !== c.sourceId && sameSubject(c.tokens, o.tokens));
  for (const c of kept) {
    const cl = clusters.find((k) => k.claims.includes(c));
    if (c.supersededBy) c.status = 'superseded';
    else if (cl && cl.conflict) c.status = 'disputed';
    else if (c.attested) c.status = 'leaver-attested';
    else c.status = corroborated(c) ? 'corroborated' : 'single-source';
  }

  // Link open items and risks to the owner cluster they belong to.
  const linkOwner = (c) => clusters.find((cl) => cl.current && sameSubject(c.tokens, cl.tokens)) || null;
  for (const c of kept.filter((x) => x.type === 'open' || x.type === 'risk')) {
    const cl = linkOwner(c);
    c.ownerName = cl ? cl.current.owner : null;
  }

  // Gap questions: what the sources leave unresolved.
  const gaps = [];
  const seen = new Set();
  const addGap = (g) => { if (!seen.has(g.id)) { seen.add(g.id); gaps.push(g); } };
  for (const cl of clusters.filter((k) => k.conflict)) {
    const names = [...new Set(cl.live.map((c) => c.owner))];
    addGap({ id: `gap:conflict:${cl.key}`, kind: 'conflict', subject: cl.label, names,
      question: `Two sources name different owners for "${cl.label}": ${names.join(' and ')}. Who owns it now?` });
  }
  for (const c of kept.filter((x) => x.type === 'open' && !x.ownerName && !x.supersededBy)) {
    addGap({ id: `gap:owner:${c.tokens.join(' ')}`, kind: 'no-owner', subject: shortLabel(c.statement),
      question: `Who owns "${shortLabel(c.statement)}"? It is open and no owner is named.` });
  }
  for (const c of kept.filter((x) => x.type === 'risk' && !x.ownerName)) {
    addGap({ id: `gap:risk:${c.tokens.join(' ')}`, kind: 'risk-owner', subject: shortLabel(c.statement),
      question: `Who is watching this risk: "${shortLabel(c.statement)}"?` });
  }

  const byType = (t) => kept.filter((c) => c.type === t);
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
  const who = String(name || '').trim().replace(/[^\w' -]/g, '').slice(0, 40);
  if (!who) return null;
  if (gap.kind === 'conflict') return `${who} now owns ${gap.subject}.`;
  if (gap.kind === 'risk-owner') return `${who} owns ${gap.subject}.`;
  return `${who} owns ${gap.subject}.`;
}

const line = (c) => `- ${c.statement} _(${c.source.label}, status: ${c.status}${c.review !== 'pending' ? `, ${c.review}` : ''})_\n  > "${c.quote}"`;

export function briefMarkdown(model, title = 'Handover brief') {
  const s = model.sections;
  const live = (arr) => arr.filter((c) => !c.supersededBy && c.review !== 'rejected');
  const out = [`# ${title}`, '', `Built by Tab (an AI assistant) for Akshay Wagh, CodersInPune Round 2. Every line quotes its source.`, ''];
  out.push('## Owners');
  for (const o of s.owners) {
    if (o.conflict) for (const c of o.live) out.push(line(c) + ' — DISPUTED, see questions');
    else out.push(line(o.current));
  }
  out.push('', '## Decisions');
  for (const c of live(s.decisions)) out.push(line(c));
  out.push('', '## Open items');
  for (const c of live(s.open)) out.push(line(c) + (c.ownerName ? '' : '\n  (no owner named)'));
  out.push('', '## Risks');
  for (const c of live(s.risks)) out.push(line(c));
  out.push('', '## Questions still open');
  if (!model.gaps.length) out.push('- None.');
  for (const g of model.gaps) out.push(`- ${g.question}`);
  out.push('', `Quote check: ${model.counts.claims} claims kept, ${model.counts.dropped} dropped. Planted false claims dropped: ${model.selfTest.dropped} of ${model.selfTest.planted}.`);
  return out.join('\n');
}

export function sourceFromEntry(kind, text, author) {
  return { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, label: KIND_LABEL[kind] + (author ? `, ${author}` : ''), author: author || '', text: String(text || '') };
}
