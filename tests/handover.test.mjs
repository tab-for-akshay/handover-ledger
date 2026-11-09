import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, validate, splitUnits, answerSentence, sourceFromEntry, briefMarkdown, sameSubject, parseCsvLine,
  itemSubject, pl, fmtIST, encodeState, decodeState, parseImport, shareHash, stateFromHash, normaliseState } from '../handover.js';
import { demoSources } from '../demo.js';

const build = (sources, review = {}) => buildModel({ sources, review });
const notes = (text, author = '') => sourceFromEntry('notes', text, author);
const csv = (rows) => ({ id: `csv${Math.random().toString(36).slice(2, 6)}`, kind: 'issues', label: 'Issue export (CSV)', author: '', text: 'id,title,owner,status,updated\n' + rows });

// ---- The original 11 tests (unchanged in intent)

test('every kept claim quotes its source verbatim', () => {
  const sources = demoSources();
  const m = build(sources);
  assert.ok(m.claims.length > 10, 'demo yields claims');
  for (const c of m.claims) {
    const s = sources.find((x) => x.id === c.sourceId);
    assert.equal(s.text.slice(c.start, c.end), c.quote);
  }
});

test('planted false claims are all dropped', () => {
  const m = build(demoSources());
  assert.equal(m.selfTest.planted, 3);
  assert.equal(m.selfTest.dropped, 3);
});

test('validator drops a claim whose quote was altered', () => {
  const sources = [{ id: 'a', kind: 'notes', text: 'Ravi owns the retry job.' }];
  const fake = { id: 'x', type: 'owner', sourceId: 'a', start: 0, end: 24, quote: 'Priya owns the retry job.' };
  assert.equal(validate([fake], sources).dropped.length, 1);
});

test('conflicting owners with no supersession become a gap question', () => {
  const m = build(demoSources());
  const conflict = m.gaps.find((g) => g.kind === 'conflict');
  assert.ok(conflict, 'conflict gap exists');
  assert.match(conflict.question, /Priya/);
  assert.match(conflict.question, /Ravi/);
});

test('a leaver answer resolves the conflict via supersession', () => {
  const sources = demoSources();
  const gap = build(sources).gaps.find((g) => g.kind === 'conflict');
  const sentence = answerSentence(gap, 'Ravi');
  assert.equal(sentence, `Ravi now owns ${gap.subject}.`);
  const after = [...sources, sourceFromEntry('answer', sentence, '')];
  const m = build(after);
  assert.equal(m.gaps.filter((g) => g.kind === 'conflict').length, 0, 'conflict gone');
  const priya = m.claims.find((c) => c.type === 'owner' && c.owner === 'Priya' && /payment retry/i.test(c.statement));
  assert.equal(priya.status, 'superseded');
  assert.equal(priya.supersededBy !== undefined, true);
});

test('a rejected claim leaves the owner view and the brief', () => {
  const m0 = build(demoSources());
  const dana = m0.claims.find((c) => c.owner === 'Dana');
  const m1 = build(demoSources(), { [dana.id]: { state: 'rejected' } });
  const md = briefMarkdown(m1);
  assert.doesNotMatch(md, /Dana owns invoice PDF export/);
});

test('issue CSV rows produce owner and open claims with the row as quote', () => {
  const src = { id: 'i', kind: 'issues', text: 'id,title,owner,status,updated\n7,Billing webhook,Mira,open,2026-11-01' };
  const m = build([src]);
  assert.ok(m.claims.some((c) => c.type === 'owner' && c.owner === 'Mira'));
  assert.ok(m.claims.some((c) => c.type === 'open'));
  assert.equal(m.claims[0].quote, '7,Billing webhook,Mira,open,2026-11-01');
});

test('csv parser keeps quoted commas', () => {
  assert.deepEqual(parseCsvLine('1,"Fix, then ship",Ravi'), ['1', 'Fix, then ship', 'Ravi']);
});

test('sameSubject needs two shared words for multi-word subjects', () => {
  assert.equal(sameSubject(['payment', 'retry', 'job'], ['payment', 'retry', 'job', 'backoff']), true);
  assert.equal(sameSubject(['payment', 'retry'], ['invoice', 'pdf']), false);
});

test('splitUnits gives verbatim offsets for notes', () => {
  const s = { id: 'n', kind: 'notes', text: 'First one. Second one!\nThird line' };
  for (const u of splitUnits(s)) assert.equal(s.text.slice(u.start, u.end), u.text);
});

test('empty input builds an empty brief without errors', () => {
  const m = build([]);
  assert.equal(m.counts.claims, 0);
  assert.match(briefMarkdown(m), /Quote check: 0 claims kept/);
});

// ---- Fix 1: share link and import

test('share link round-trips the whole handover through the URL hash', () => {
  const state = { sources: demoSources(), review: { x: { state: 'accepted', at: 1 } }, audit: [] };
  const hash = shareHash(state);
  assert.match(hash, /^#h=[A-Za-z0-9_-]+$/, 'hash carries no +, / or padding');
  const back = stateFromHash(hash);
  assert.deepEqual(back.sources, state.sources);
  assert.deepEqual(back.review, { x: { state: 'accepted', at: 1 } });
});

test('share link survives non-ASCII text', () => {
  const state = { sources: [notes('Priya owns the migração — “quoted” text, ✓.')], review: {} };
  assert.equal(decodeState(encodeState(state)).sources[0].text, state.sources[0].text);
});

test('a hash that is not a share link is ignored, not guessed at', () => {
  assert.equal(stateFromHash(''), null);
  assert.equal(stateFromHash('#something'), null);
  assert.throws(() => decodeState('bm90IGpzb24'));
});

test('importing a .json export restores the same handover', () => {
  const state = { sources: demoSources(), review: {} };
  const json = JSON.stringify({ app: 'handover-ledger', v: 1, sources: state.sources, review: {} });
  const got = parseImport(json, 'handover-ledger.json');
  assert.equal(got.kind, 'state');
  assert.equal(build(got.state.sources).counts.claims, build(state.sources).counts.claims);
});

test('importing the brief .md restores the handover it was made from', () => {
  const state = { sources: demoSources(), review: {} };
  const md = briefMarkdown(build(state.sources), 'Handover brief', state);
  const got = parseImport(md, 'handover-brief.md');
  assert.equal(got.kind, 'state');
  assert.equal(got.state.sources.length, 3);
});

test('a plain .md file imports as a note, and a non-handover .json is refused', () => {
  const got = parseImport('# Notes\nPriya owns the retry job.', 'standup.md');
  assert.equal(got.kind, 'note');
  assert.throws(() => normaliseState({ hello: 1 }), /not a Handover Ledger handover/);
});

// ---- Fix 2: plain-English notes

test('"X is responsible for ..." is an owner claim with the item as subject', () => {
  const m = build([notes('Rohit is responsible for the certificate renewal.')]);
  const o = m.claims.find((c) => c.type === 'owner');
  assert.equal(o.owner, 'Rohit');
  assert.equal(o.statement, 'Rohit owns certificate renewal');
});

test('"X will finish ... by 15 Nov" gives an owner and a deadline', () => {
  const m = build([notes('Meera will finish the audit log export by 15 Nov.')]);
  assert.ok(m.claims.some((c) => c.type === 'owner' && c.owner === 'Meera'), 'owner');
  const d = m.claims.find((c) => c.type === 'deadline');
  assert.ok(d, 'deadline');
  assert.equal(d.due, '15 Nov');
  assert.equal(d.quote, 'Meera will finish the audit log export by 15 Nov.');
});

test('"expires on 20 Nov and if it lapses ..." is a risk and a deadline', () => {
  const m = build([notes('The certificate expires on 20 Nov and if it lapses the audit fails.')]);
  assert.ok(m.claims.some((c) => c.type === 'risk'), 'risk');
  assert.ok(m.claims.some((c) => c.type === 'deadline' && c.due === '20 Nov'), 'deadline');
});

test('"handles" and "blocked" are caught too', () => {
  const m = build([notes('Dev handles the webhook retries. The import is blocked on legal review.')]);
  assert.ok(m.claims.some((c) => c.type === 'owner' && c.owner === 'Dev'));
  assert.ok(m.claims.some((c) => c.type === 'open' && /blocked/.test(c.statement)));
});

test('a sentence starting with a capitalised word that is not a name is not an owner', () => {
  const m = build([notes('If it fails we roll back. Certificate expires soon.')]);
  assert.equal(m.claims.filter((c) => c.type === 'owner').length, 0);
});

// ---- Fix 3: owner conflicts across sources

test('CSV owner Meera against notes owner Rohit is a disputed conflict, not agreement', () => {
  const sources = [notes('Rohit owns the PDF export.', 'Priya'), csv('5,PDF export,Meera,open,2026-11-01')];
  const m = build(sources);
  const gap = m.gaps.find((g) => g.kind === 'conflict');
  assert.ok(gap, 'a conflict question exists');
  assert.match(gap.question, /Rohit/);
  assert.match(gap.question, /Meera/);
  assert.ok(m.claims.filter((c) => c.type === 'owner').every((c) => c.status === 'disputed'));
});

test('a conflict is shown even when the owner sentence says "is responsible for"', () => {
  const m = build([notes('Rohit is responsible for PDF export.'), csv('5,PDF export,Meera,open,2026-11-01')]);
  assert.ok(m.gaps.some((g) => g.kind === 'conflict'));
});

test('two notes naming the same owner do not raise a conflict', () => {
  const m = build([notes('Rohit owns the PDF export.'), notes('Rohit handles PDF export.')]);
  assert.equal(m.gaps.filter((g) => g.kind === 'conflict').length, 0);
});

test('no conflict means the question list is empty, not "agree" by default', () => {
  const m = build([notes('Rohit owns the PDF export.')]);
  assert.equal(m.gaps.length, 0);
});

// ---- Fix 4: questions use the whole item name

test('"Who owns" uses the full item subject and never ends mid-clause', () => {
  const m = build([notes('Rohit owns PDF export, which is still open.')]);
  const sentences = [notes('Open: the reconciliation report has no owner yet.')];
  const g = build(sentences).gaps.find((x) => x.kind === 'no-owner');
  assert.equal(g.question, 'Who owns "reconciliation report"? It is open and no owner is named.');
  assert.equal(m.claims.find((c) => c.type === 'owner').statement, 'Rohit owns PDF export');
});

test('an owner statement does not carry the trailing "is still" clause', () => {
  assert.equal(itemSubject('PDF export is still open'), 'PDF export');
  assert.equal(itemSubject('the payment retry job until Friday'), 'payment retry job');
  assert.equal(itemSubject('Risk: no tests on the backoff path'), 'no tests on the backoff path');
});

// ---- Fix 5: duplicate questions merge; answers stay scoped

test('the same open item in notes and CSV is one question, not two', () => {
  const sources = [notes('Open: the invoice PDF export is not started yet.'), csv('42,Invoice PDF export,,open,2026-10-28')];
  const m = build(sources);
  assert.equal(m.gaps.filter((g) => g.kind === 'no-owner').length, 1);
});

test('answering one question does not clear an unrelated one', () => {
  const sources = [notes('Open: the invoice PDF export is not started yet. Open: the reconciliation report has no owner yet.')];
  const m = build(sources);
  const invoice = m.gaps.find((g) => /invoice/.test(g.question));
  assert.ok(invoice, 'invoice question exists');
  const after = build([...sources, sourceFromEntry('answer', answerSentence(invoice, 'Dana'), '')]);
  assert.ok(after.gaps.some((g) => /reconciliation/.test(g.question)), 'reconciliation question still open');
  assert.equal(after.gaps.some((g) => /invoice/.test(g.question)), false, 'invoice question closed');
});

test('a leaver answer is stored as an attested owner sentence', () => {
  assert.equal(answerSentence({ kind: 'no-owner', subject: 'invoice PDF export' }, 'Dana'), 'Dana owns invoice PDF export.');
  assert.equal(answerSentence({ kind: 'no-owner', subject: 'x' }, ''), null);
});

// ---- Fix 6: commit authors and the standard git log

test('a one-line commit author is a candidate owner, marked as a candidate', () => {
  const m = build([sourceFromEntry('commits', 'a1b2c3d Ravi 2026-10-31 retry job: add exponential backoff', '')]);
  const o = m.claims.find((c) => c.type === 'owner');
  assert.equal(o.owner, 'Ravi');
  assert.equal(o.candidate, true);
  assert.equal(o.status, 'candidate');
});

test('a standard multi-line git log gives author, date and the subject line as quote', () => {
  const log = [
    'commit e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3',
    'Author: Priya Nair <priya@example.org>',
    'Date:   Tue Oct 27 10:02:11 2026 +0530',
    '',
    '    WIP webhook idempotency, hotfix pending review',
    '',
    'commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    'Author: Ravi <ravi@example.org>',
    'Date:   Sat Oct 31 09:00:00 2026 +0530',
    '',
    '    retry job: add exponential backoff',
  ].join('\n');
  const src = sourceFromEntry('commits', log, '');
  const m = build([src]);
  const owners = m.claims.filter((c) => c.type === 'owner');
  assert.deepEqual(owners.map((c) => c.owner).sort(), ['Priya Nair', 'Ravi']);
  for (const c of owners) assert.equal(src.text.slice(c.start, c.end), c.quote, 'quote is a verbatim span');
  assert.equal(owners.find((c) => c.owner === 'Ravi').quote, 'retry job: add exponential backoff');
  assert.ok(m.claims.some((c) => c.type === 'activity' && c.author === 'Priya Nair'));
});

test('a commit author alone does not raise a dispute', () => {
  const m = build([sourceFromEntry('commits', 'a1b2c3d Ravi 2026-10-31 retry job: add backoff', '')]);
  assert.equal(m.gaps.filter((g) => g.kind === 'conflict').length, 0);
});

test('a commit author who disagrees with a named owner does raise the question', () => {
  const m = build([notes('Priya owns the payment retry job.'), sourceFromEntry('commits', 'a1b2c3d Ravi 2026-10-31 payment retry job: add backoff', '')]);
  assert.ok(m.gaps.some((g) => g.kind === 'conflict'));
});

// ---- Fix 7: corroboration needs the same owner

test('"Dana owns invoice PDF export" is single-source when the CSV owner is empty', () => {
  const m = build([notes('Dana owns invoice PDF export.'), csv('42,Invoice PDF export,,open,2026-10-28')]);
  const dana = m.claims.find((c) => c.owner === 'Dana');
  assert.equal(dana.status, 'single-source');
});

test('an owner is corroborated only by the same owner in another source', () => {
  const m = build([notes('Ravi owns the payment retry job.'), csv('41,Payment retry job,Ravi,open,2026-10-30')]);
  assert.equal(m.claims.find((c) => c.type === 'owner' && c.source.kind === 'notes').status, 'corroborated');
});

// ---- Fix 8: small things

test('counts read as words: "1 entry", "2 entries"', () => {
  assert.equal(pl(1, 'entry', 'entries'), '1 entry');
  assert.equal(pl(2, 'entry', 'entries'), '2 entries');
  assert.equal(pl(1, 'claim'), '1 claim');
  assert.equal(pl(0, 'claim'), '0 claims');
});

test('times read as India time', () => {
  assert.equal(fmtIST('2026-11-09T02:30:00Z'), '9 Nov 2026, 08:00 IST');
  assert.equal(fmtIST('not a date'), 'not a date');
});

// ---- Fix 9 and 10: name and licence in the brief

test('the brief names the team RELAYPROOF and nothing else', () => {
  const md = briefMarkdown(build(demoSources()));
  assert.match(md, /team RELAYPROOF/);
  assert.doesNotMatch(md, /Tab x Akshay/);
});

test('the brief carries the planted-claim count for the self-test', () => {
  const m = build(demoSources());
  assert.match(briefMarkdown(m), /Planted false claims dropped: 3 of 3/);
});
