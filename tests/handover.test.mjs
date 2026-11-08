import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, validate, splitUnits, answerSentence, sourceFromEntry, briefMarkdown, sameSubject, parseCsvLine } from '../handover.js';
import { demoSources } from '../demo.js';

const build = (sources, review = {}) => buildModel({ sources, review });

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
