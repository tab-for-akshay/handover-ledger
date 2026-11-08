// Page logic: renders the three views from the same model. All state lives in this browser (localStorage); no login.
import { buildModel, sourceFromEntry, answerSentence, briefMarkdown, shortLabel, KIND_LABEL } from './handover.js';
import { demoSources } from './demo.js';

const KEY = 'tab-handover-ledger-v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = load() || fresh();
let view = 'capture';

function fresh() { return { sources: demoSources(), review: {}, audit: [] }; }
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep working in memory */ } }

function audit(action, claim) {
  state.audit.unshift({ at: new Date().toISOString().slice(0, 16).replace('T', ' '), action, statement: claim ? claim.statement : '' });
  state.audit = state.audit.slice(0, 50);
}

function setReview(id, claimState) {
  const model = buildModel(state);
  const c = model.claims.find((x) => x.id === id);
  state.review[id] = { state: claimState, at: Date.now() };
  audit(claimState, c);
  save(); render();
}

function render() {
  const model = buildModel(state);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const el = $('#view');
  if (view === 'capture') el.innerHTML = captureView(model);
  if (view === 'brief') el.innerHTML = briefView(model);
  if (view === 'owner') el.innerHTML = ownerView(model);
  $('#status').textContent = `${model.counts.entries} entries · ${model.counts.claims} claims · ${model.counts.gaps} open questions`;
}

function badge(c) {
  const cls = { superseded: 'old', disputed: 'warn', 'leaver-attested': 'ok', corroborated: 'ok', 'single-source': '' }[c.status] || '';
  const review = c.review === 'accepted' ? ' · accepted' : c.review === 'rejected' ? ' · rejected' : ' · unreviewed';
  return `<span class="badge ${cls}">${esc(c.status)}${esc(review)}</span>`;
}

function claimCard(c, { actions = true } = {}) {
  return `<div class="claim ${c.review === 'rejected' ? 'rej' : ''} ${c.supersededBy ? 'sup' : ''}">
    <div class="stmt">${esc(c.statement)}</div>
    <blockquote>“${esc(c.quote)}”</blockquote>
    <div class="meta">${esc(c.source.label)} ${badge(c)}</div>
    ${actions && !c.supersededBy ? `<div class="row"><button data-act="accept" data-id="${esc(c.id)}">Accept</button><button data-act="reject" data-id="${esc(c.id)}">Reject</button></div>` : ''}
  </div>`;
}

function captureView(model) {
  const entries = state.sources.map((s) => {
    const n = model.claims.filter((c) => c.sourceId === s.id).length;
    return `<div class="entry"><div><b>${esc(s.label)}</b> <span class="muted">· ${n} claim${n === 1 ? '' : 's'} from this entry</span></div>
      <pre>${esc(s.text.length > 240 ? s.text.slice(0, 240) + '…' : s.text)}</pre>
      <button data-act="remove" data-id="${esc(s.id)}">Remove</button></div>`;
  }).join('') || '<p class="muted">No entries yet. Add one, or load the sample handover.</p>';
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
    <p class="hint">Issue exports: header row <code>id,title,owner,status,updated</code>. Commit logs: <code>sha author date subject</code>.</p>
  </form>
  <h3>Entries</h3>${entries}
  <p><button class="primary" data-go="brief">See the handover brief →</button></p>`;
}

function briefView(model) {
  const s = model.sections;
  const live = (arr) => arr.filter((c) => !c.supersededBy && c.review !== 'rejected');
  const owners = s.owners.map((o) => o.conflict
    ? o.live.map((c) => claimCard(c)).join('')
    : claimCard(o.current)).join('') || '<p class="muted">No owners named yet.</p>';
  const gaps = model.gaps.length ? model.gaps.map((g) => `<div class="claim gap">
      <div class="stmt">${esc(g.question)}</div>
      <div class="row"><input data-gap="${esc(g.id)}" placeholder="${g.kind === 'conflict' ? 'Name the owner now' : 'Name the owner'}" maxlength="40">
      <button data-act="answer" data-id="${esc(g.id)}">Answer</button></div>
      <div class="meta">Answers are stored as the leaver's word, labelled as such.</div></div>`).join('')
    : '<p class="muted">Nothing unresolved. The sources agree.</p>';
  const list = (arr, empty) => live(arr).map((c) => claimCard(c)).join('') || `<p class="muted">${empty}</p>`;
  const audit = state.audit.slice(0, 8).map((a) => `<li>${esc(a.at)} · ${esc(a.action)} · ${esc(a.statement)}</li>`).join('') || '<li class="muted">No reviews yet.</li>';
  return `
  <h2>2. Handover brief</h2>
  <p class="muted">Built automatically from your entries. Every line quotes its source. Review each line: accept it, or reject it so it leaves the brief.</p>
  <p class="checks">Quote check: <b>${model.counts.claims}</b> claims kept, <b>${model.counts.dropped}</b> dropped. Planted false claims caught: <b>${model.selfTest.dropped} of ${model.selfTest.planted}</b>.</p>
  <h3>Owners</h3>${owners}
  <h3>Decisions</h3>${list(s.decisions, 'No decisions recorded.')}
  <h3>Open items</h3>${list(s.open, 'Nothing open.')}
  <h3>Risks</h3>${list(s.risks, 'No risks recorded.')}
  <h3>Questions for the leaver</h3>${gaps}
  <h3>Recent activity</h3>${model.activity.slice(0, 6).map((c) => `<div class="muted">${esc(c.statement)}</div>`).join('') || '<p class="muted">No commit lines.</p>'}
  <h3>Review log</h3><ul class="log">${audit}</ul>
  <p><button data-act="export">Download brief (.md)</button> <button data-go="owner">Open the new-owner view →</button></p>`;
}

function ownerView(model) {
  const s = model.sections;
  const ok = (c) => !c.supersededBy && c.review !== 'rejected';
  const item = (c) => `<div class="claim"><div class="stmt">${esc(c.statement)}</div><div class="meta">${esc(c.source.label)} ${c.review === 'accepted' ? '· accepted' : '· unreviewed'}${c.status === 'disputed' ? ' · disputed' : ''}</div></div>`;
  const owners = s.owners.flatMap((o) => (o.conflict ? o.live : [o.current])).filter(ok).map(item).join('') || '<p class="muted">No owners named.</p>';
  const dec = s.decisions.filter(ok).map(item).join('') || '<p class="muted">None recorded.</p>';
  const open = s.open.filter(ok).map((c) => `${item(c)}${c.ownerName ? '' : '<div class="warn-t">No owner named yet</div>'}`).join('') || '<p class="muted">Nothing open.</p>';
  const risks = s.risks.filter(ok).map(item).join('') || '<p class="muted">None recorded.</p>';
  const unknown = model.gaps.map((g) => `<div class="claim gap"><div class="stmt">${esc(g.question)}</div></div>`).join('') || '<p class="muted">Nothing unknown in the sources.</p>';
  return `
  <h2>3. New owner</h2>
  <p class="muted">You are picking this up. Rely on what is quoted and accepted. Treat "unreviewed" as a claim to check, and do not act on "disputed" until its question is answered.</p>
  <h3>Who owns what</h3>${owners}
  <h3>Decisions already taken</h3>${dec}
  <h3>Still open</h3>${open}
  <h3>Risks</h3>${risks}
  <h3>Not known yet</h3>${unknown}`;
}

// ---- events
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); window.scrollTo(0, 0); }));

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { view = go.dataset.go; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === 'accept' || act === 'reject') return setReview(id, act === 'accept' ? 'accepted' : 'rejected');
  if (act === 'remove') { state.sources = state.sources.filter((s) => s.id !== id); audit('entry removed', null); save(); return render(); }
  if (act === 'demo') { state = fresh(); audit('sample handover loaded', null); save(); return render(); }
  if (act === 'clear') { state = { sources: [], review: {}, audit: [] }; save(); return render(); }
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
  if (act === 'export') {
    const md = briefMarkdown(buildModel(state), 'Handover brief');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'handover-brief.md' });
    document.body.appendChild(a); a.click(); a.remove();
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
