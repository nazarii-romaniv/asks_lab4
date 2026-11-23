'use strict';
// Перевірка реальної бази знань у репозиторії: захист від зламаних/сфабрикованих даних.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/notes');

const root = path.resolve(__dirname, '..');
const notes = N.loadNotes(root);

test('є щонайменше 8 нотаток із обов’язковими полями', () => {
  assert.ok(notes.length >= 8, `знайдено ${notes.length}`);
  for (const n of notes) {
    for (const k of ['title', 'created', 'updated', 'type', 'status', 'tags']) {
      assert.ok(n.meta[k] !== undefined && n.meta[k] !== '', `${n.id}: немає поля ${k}`);
    }
  }
});

test('є MOC, архівна нотатка та пара взаємно пов’язаних нотаток', () => {
  assert.ok(notes.some((n) => n.meta.type === 'moc'));
  assert.ok(notes.some((n) => n.category === 'Archives' && n.meta.status === 'archived'));
  const titles = new Map(notes.map((n) => [n.title.toLowerCase(), n]));
  const mutual = notes.some((a) => a.links.some((l) => {
    const b = titles.get(l.toLowerCase());
    return b && b.id !== a.id && b.links.some((x) => x.toLowerCase() === a.title.toLowerCase());
  }));
  assert.ok(mutual, 'немає двох нотаток, що посилаються одна на одну');
});

test('усі [[посилання]] ведуть на наявні нотатки', () => {
  const titles = new Set(notes.map((n) => n.title.toLowerCase()));
  for (const n of notes) {
    for (const l of n.links) assert.ok(titles.has(l.toLowerCase()), `${n.id}: зламане посилання [[${l}]]`);
  }
});

test('type відповідає категорії (крім moc)', () => {
  const expected = { Inbox: 'inbox', Projects: 'project', Areas: 'area', Resources: 'resource', Archives: 'archive' };
  for (const n of notes) {
    if (n.meta.type === 'moc') continue;
    assert.equal(n.meta.type, expected[n.category], `${n.id}: type=${n.meta.type}`);
  }
});

test('у нотатках немає схожих на секрети рядків', () => {
  const re = /(api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/i;
  for (const n of notes) assert.ok(!re.test(n.body), `${n.id}: підозрілий рядок`);
});

test('SKILL.md існує та має frontmatter з name і description', () => {
  const text = fs.readFileSync(path.join(root, '.agents/skills/second-brain/SKILL.md'), 'utf8');
  const { meta } = N.parseNote(text);
  assert.equal(meta.name, 'second-brain');
  assert.ok(meta.description && meta.description.length > 20);
});
