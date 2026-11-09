// Page logic: renders the three views from the same model. All state lives in this browser (localStorage); no login.
import { buildModel, sourceFromEntry, answerSentence, briefMarkdown, shareHash, stateFromHash, encodeState,
  parseImport, normaliseState, fmtIST, pl, KIND_LABEL } from './handover.js';
import { demoSources } from './demo.js';

const KEY = 'tab-handover-ledger-v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = load() || fresh();
let view = 'capture';
let notice = '';

// A shared link (#h=...) opens that handover in this browser.
(function openSharedLink() {
  let shared = null;
  try { shared = stateFromHash(location.hash); } catch { notice = 'That link could not be read. Showing the sample handover.'; return; }
  if (shared) { state = { ...shared, audit: [] }; audit('opened from a share link', null); save(); notice = 'Opened from a share link. Entries and reviews come from that link.'; }
})();

function fresh() { return { sources: demoSources(), review: {}, audit: [] }; }
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep working in memory */ } }

function audit(action, claim) {
  state.audit = state.audit || [];
  state.audit.unshift({ at: new Date().toISOString(), action, statement: claim ? claim.statement : '' });
  state.audit = state.audit.slice(0, 50);
}

function setReview(id, claimState) {
  const model = buildModel(state);
  const c = model.claims.find((x) => x.id === id);
  state.review = state.review || {};
  state.review[id] = { state: claimState, at: Date.now() };
  audit(claimState, c);
  save(); render();
}

function undoReview(id) {
  const model = buildModel(state);
  const c = model.claims.find((x) => x.id === id);
  if (state.review && state.review[id]) delete state.review[id];
  audit('undone', c);
  save(); render();
}

function render() {
  const model = buildModel(state);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const el = $('#view');
  if (view === 'capture') el.innerHTML = captureView(model);
  if (view === 'brief') el.innerHTML = briefView(model);
  if (view === 'owner') el.innerHTML = ownerView(model);
  $('#status').textContent = `${pl(model.counts.entries, 'entry', 'entries')} · ${pl(model.counts.claims, 'claim')} · ${pl(model.counts.gaps, 'open question')}${notice ? ' · ' + notice : ''}`;
}

function badge(c) {
  const cls = { superseded: 'old', disputed: 'warn', 'leaver-attested': 'ok', corroborated: 'ok', 'single-source': '', candidate: 'warn' }[c.status] || '';
  const review = c.review === 'accepted' ? ' · accepted' : c.review === 'rejected' ? ' · rejected' : ' · unreviewed';
  const tip = {
    disputed: 'Two owners are named for this item and no newer claim settles it. Answer the question below.',
    candidate: 'The commit author. A candidate owner, not a confirmed one.',
    'single-source': 'Only one source says this.',
    corroborated: 'Another source says the same thing.',
    'leaver-attested': 'The leaver wrote this answer.',
    superseded: 'A newer claim replaced this one.',
  }[c.status] || '';
  return `<span class="badge ${cls}" title="${esc(tip)}">${esc(c.status)}${esc(review)}</span>`;
}

function claimCard(c, { actions = true } = {}) {
  const acc = c.review === 'accepted', rej = c.review === 'rejected';
  const buttons = actions && !c.supersededBy
    ? `<div class="row"><button data-act="accept" data-id="${esc(c.id)}" aria-pressed="${acc}" class="${acc ? 'on' : ''}" ${acc ? 'disabled' : ''}>${acc ? 'Accepted' : 'Accept'}</button>`
      + `<button data-act="reject" data-id="${esc(c.id)}" aria-pressed="${rej}" class="${rej ? 'on' : ''}" ${rej ? 'disabled' : ''}>${rej ? 'Rejected' : 'Reject'}</button>`
      + `${acc || rej ? `<button data-act="undo" data-id="${esc(c.id)}">Undo</button>` : ''}</div>`
    : '';
  return `<div class="claim ${rej ? 'rej' : ''} ${c.supersededBy ? 'sup' : ''}">
    <div class="stmt">${esc(c.statement)}${c.due && c.type !== 'deadline' ? ` <span class="due">due ${esc(c.due)}</span>` : ''}</div>
    <blockquote>“${esc(c.quote)}”</blockquote>
    <div class="meta">${esc(c.source.label)} ${badge(c)}</div>
    ${buttons}
  </div>`;
}

function captureView(model) {
  const entries = state.sources.map((s) => {
    const n = model.claims.filter((c) => c.sourceId === s.id).length;
    return `<div class="entry"><div><b>${esc(s.label)}</b> <span class="muted">· ${pl(n, 'claim')} from this entry</span></div>
      <pre>${esc(s.text.length > 240 ? s.text.slice(0, 240) + '…' : s.text)}</pre>
      <button data-act="remove" data-id="${esc(s.id)}">Remove</button></div>`;
  }).join('') || '<p class="muted">No entries yet. Add one, load the sample handover, or import one.</p>';
  return `
  <h2>1. Capture what you know</h2>
  <p class="muted">Write it the way you would tell a successor: what was decided, who owns what, what is still open, what could break. Each sentence becomes a claim, and each claim keeps its exact quote from the entry.</p>
  <form id="add" class="card">
    <label>Entry type
      <select id="kind">${Object.entries(KIND_LABEL).filter(([k]) => k !== 'answer').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    </label>
    <label>Who wrote it <input id="author" placeholder="e.g. Priya" maxlength="40"></label>
    <label>Text <textarea id="text" rows="6" placeholder="Decided to keep Postgres. Priya owns the retry job. Risk: no tests on the backoff path."></textarea></label>
    <div class="row"><button class="primary" type="submit">Add entry</button>
      <button type="button" data-act="demo">Load sample handover</button>
      <button type="button" data-act="clear">Clear all</button></div>
    <p class="hint">Issue exports: header row <code>id,title,owner,status,updated</code>. Commit logs: one line <code>sha author date subject</code>, or standard <code>git log</code> output.</p>
  </form>
  <h3>Pass it on</h3>
  <div class="card">
    <div class="row"><button data-act="share">Copy share link</button>
      <button data-act="export-json">Download handover (.json)</button>
      <label class="filebtn">Import .md or .json <input type="file" id="import" accept=".md,.json,application/json,text/markdown" hidden></label></div>
    <p class="hint">The share link opens this exact handover in another browser, with no server. A .json or the brief's .md imports back the same way.</p>
    <div id="share-out"></div>
  </div>
  <h3>Entries</h3>${entries}
  <p><button class="primary" data-go="brief">See the handover brief →</button></p>`;
}

function briefView(model) {
  const s = model.sections;
  // Rejected lines stay visible, dimmed, with Undo: a reject is reversible from the brief.
  const live = (arr) => arr.filter((c) => !c.supersededBy);
  const ownerCards = model.clusters.filter((cl) => cl.claims.some((c) => !c.supersededBy)).map((cl) => {
    const rejected = cl.claims.filter((c) => !c.supersededBy && c.review === 'rejected');
    const shown = cl.conflict ? cl.live : (cl.current ? [cl.current] : []);
    return [...shown, ...rejected.filter((c) => !shown.includes(c))].map((c) => claimCard(c)).join('');
  }).join('');
  const owners = ownerCards || '<p class="muted">No owners named yet.</p>';
  const gaps = model.gaps.length ? model.gaps.map((g) => `<div class="claim gap">
      <div class="stmt">${esc(g.question)}</div>
      <div class="row"><input data-gap="${esc(g.id)}" aria-label="Answer" placeholder="${g.kind === 'conflict' ? 'Name the owner now' : 'Name the owner'}" maxlength="40">
      <button data-act="answer" data-id="${esc(g.id)}">Answer</button></div>
      <div class="meta">Answers are stored as the leaver's word, labelled as such.</div></div>`).join('')
    : '<p class="muted">Nothing unresolved: no owner conflicts and no open questions.</p>';
  const list = (arr, empty) => live(arr).map((c) => claimCard(c)).join('') || `<p class="muted">${empty}</p>`;
  const audit = (state.audit || []).slice(0, 8).map((a) => `<li>${esc(fmtIST(a.at))} · ${esc(a.action)} · ${esc(a.statement)}</li>`).join('') || '<li class="muted">No reviews yet.</li>';
  return `
  <h2>2. Handover brief</h2>
  <p class="muted">Built automatically from your entries. Every line quotes its source. Review each line: accept it, or reject it so it leaves the brief.</p>
  <p class="checks">Quote check: <b>${model.counts.claims}</b> ${model.counts.claims === 1 ? 'claim' : 'claims'} kept, <b>${model.counts.dropped}</b> dropped. Planted false claims caught: <b>${model.selfTest.dropped} of ${model.selfTest.planted}</b> <span class="tip" title="A planted false claim is an invented statement, such as 'Dana owns the billing migration', put into every build on purpose. The validator must drop each one; the count shows how many it caught.">(what is this?)</span>.</p>
  <h3>Owners</h3>${owners}
  <h3>Decisions</h3>${list(s.decisions, 'No decisions recorded.')}
  <h3>Open items</h3>${list(s.open, 'Nothing open.')}
  <h3>Risks</h3>${list(s.risks, 'No risks recorded.')}
  <h3>Deadlines</h3>${list(s.deadlines, 'No dates recorded.')}
  <h3>Questions for the leaver</h3>${gaps}
  <h3>Recent activity</h3>${model.activity.slice(0, 6).map((c) => `<div class="muted">${esc(c.statement)}</div>`).join('') || '<p class="muted">No commit lines.</p>'}
  <h3>Review log (India time)</h3><ul class="log">${audit}</ul>
  <p><button data-act="export">Download brief (.md)</button> <button data-go="owner">Open the new-owner view →</button></p>`;
}

function ownerView(model) {
  const s = model.sections;
  const ok = (c) => !c.supersededBy && c.review !== 'rejected';
  const item = (c) => `<div class="claim"><div class="stmt">${esc(c.statement)}${c.due && c.type !== 'deadline' ? ` <span class="due">due ${esc(c.due)}</span>` : ''}</div>
    <blockquote>“${esc(c.quote)}”</blockquote>
    <div class="meta">${esc(c.source.label)} ${c.review === 'accepted' ? '· accepted' : '· unreviewed'}${c.status === 'disputed' ? ' · disputed' : ''}${c.status === 'candidate' ? ' · candidate owner (commit author)' : ''}</div></div>`;
  const owners = s.owners.flatMap((o) => (o.conflict ? o.live : [o.current])).filter(ok).map(item).join('') || '<p class="muted">No owners named.</p>';
  const dec = s.decisions.filter(ok).map(item).join('') || '<p class="muted">None recorded.</p>';
  const open = s.open.filter(ok).map((c) => `${item(c)}${c.ownerName ? '' : '<div class="warn-t">No owner named yet</div>'}`).join('') || '<p class="muted">Nothing open.</p>';
  const risks = s.risks.filter(ok).map(item).join('') || '<p class="muted">None recorded.</p>';
  const dates = s.deadlines.filter(ok).map(item).join('') || '<p class="muted">No dates recorded.</p>';
  const unknown = model.gaps.map((g) => `<div class="claim gap"><div class="stmt">${esc(g.question)}</div></div>`).join('') || '<p class="muted">Nothing unknown in the sources.</p>';
  return `
  <h2>3. New owner</h2>
  <p class="muted">You are picking this up. Rely on what is quoted and accepted. Treat "unreviewed" as a claim to check, and do not act on "disputed" until its question is answered.</p>
  <h3>Who owns what</h3>${owners}
  <h3>Decisions already taken</h3>${dec}
  <h3>Still open</h3>${open}
  <h3>Risks</h3>${risks}
  <h3>Deadlines</h3>${dates}
  <h3>Not known yet</h3>${unknown}`;
}

function download(name, type, body) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function shareLink() {
  return `${location.origin}${location.pathname}${shareHash(state)}`;
}

// ---- events
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; notice = ''; render(); window.scrollTo(0, 0); }));

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { view = go.dataset.go; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === 'accept' || act === 'reject') return setReview(id, act === 'accept' ? 'accepted' : 'rejected');
  if (act === 'undo') return undoReview(id);
  if (act === 'remove') { state.sources = state.sources.filter((s) => s.id !== id); audit('entry removed', null); save(); return render(); }
  if (act === 'demo') { state = fresh(); audit('sample handover loaded', null); save(); return render(); }
  if (act === 'clear') {
    if (!window.confirm('Clear all entries and reviews in this browser? This cannot be undone.')) return;
    state = { sources: [], review: {}, audit: [] }; audit('all entries cleared', null); save(); return render();
  }
  if (act === 'answer') {
    const name = document.querySelector(`[data-gap="${CSS.escape(id)}"]`)?.value;
    const model = buildModel(state);
    const gap = model.gaps.find((g) => g.id === id);
    const sentence = gap && answerSentence(gap, name);
    if (!sentence) return;
    state.sources.push(sourceFromEntry('answer', sentence, ''));
    audit('leaver answered', { statement: sentence });
    save(); return render();
  }
  if (act === 'share') {
    const url = shareLink();
    const long = url.length > 60000;
    const box = $('#share-out');
    if (box) box.innerHTML = `<input readonly id="share-url" aria-label="Share link" value="${esc(url)}" onclick="this.select()">`
      + `<p class="hint">${long ? 'This handover is large; the link is long but still opens. ' : ''}Copy it and send it. Opening it loads this handover in the other person's browser.</p>`;
    const field = $('#share-url');
    if (field) field.select();
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { const h = box && box.querySelector('.hint'); if (h) h.textContent = 'Copied. ' + h.textContent; }, () => {});
    audit('share link made', null); save();
    return;
  }
  if (act === 'export-json') {
    download('handover-ledger.json', 'application/json', JSON.stringify({ app: 'handover-ledger', v: 1, exported: new Date().toISOString(), sources: state.sources, review: state.review || {} }, null, 2));
    return;
  }
  if (act === 'export') {
    download('handover-brief.md', 'text/markdown', briefMarkdown(buildModel(state), 'Handover brief', state));
    return;
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'import') return;
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text();
  try {
    const got = parseImport(text, f.name);
    if (got.kind === 'state') {
      state = { ...got.state, audit: state.audit || [] };
      audit(`imported ${f.name}`, null);
      notice = `Imported ${f.name}.`;
    } else {
      state.sources.push({ ...sourceFromEntry('notes', got.text, ''), label: `Imported, ${got.label}` });
      audit(`imported ${f.name} as a note`, null);
      notice = `Imported ${f.name} as a note.`;
    }
    save(); render();
  } catch (err) {
    notice = `Could not import ${f.name}: ${err.message}`;
    render();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'add') return;
  e.preventDefault();
  const text = $('#text').value.trim();
  if (!text) return;
  state.sources.push(sourceFromEntry($('#kind').value, text, $('#author').value.trim()));
  audit('entry added', null);
  save(); render();
});

render();
