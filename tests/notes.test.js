'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const N = require('../src/notes');
const { createServer } = require('../src/server');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  for (const c of N.CATEGORIES) fs.mkdirSync(path.join(root, 'notes', c), { recursive: true });
  return root;
}

test('parseNote: frontmatter, теги, тіло', () => {
  const { meta, body } = N.parseNote('---\ntitle: "А: Б"\ntags: [x, "y z"]\nstatus: active\n---\n# Привіт\n');
  assert.equal(meta.title, 'А: Б');
  assert.deepEqual(meta.tags, ['x', 'y z']);
  assert.equal(meta.status, 'active');
  assert.match(body, /# Привіт/);
});

test('parseNote: файл без frontmatter не ламає читання', () => {
  const { meta, body } = N.parseNote('просто текст');
  assert.deepEqual(meta, {});
  assert.equal(body, 'просто текст');
});

test('extractLinks: унікальні [[...]] і alias', () => {
  assert.deepEqual(N.extractLinks('[[A]] і [[a]] та [[B|псевдонім]]'), ['A', 'B']);
});

test('extractLinks ігнорує приклади в `коді` (регресія)', () => {
  assert.deepEqual(N.extractLinks('синтаксис `[[Приклад]]`\n```\n[[Блок]]\n```\nреальне [[Справжнє]]'), ['Справжнє']);
});

test('slugify підтримує кирилицю', () => {
  assert.equal(N.slugify('Хмарні моделі, 2026!'), 'хмарні-моделі-2026');
});

test('createNote: створення, дублікат, валідація', () => {
  const root = tmpRoot();
  const n = N.createNote(root, { title: 'Тест нотатка', tags: 'A, b ,#c', body: 'Привіт [[Інша]]' });
  assert.equal(n.category, 'Inbox');
  assert.deepEqual(n.tags, ['a', 'b', 'c']);
  assert.equal(n.status, 'draft');
  assert.deepEqual(n.links, [{ title: 'Інша', id: null }]);
  assert.throws(() => N.createNote(root, { title: 'Тест нотатка' }), (e) => e.status === 409);
  assert.throws(() => N.createNote(root, { title: '   ' }), (e) => e.status === 400);
  assert.throws(() => N.createNote(root, { title: 'X', category: '../etc' }), (e) => e.status === 400);
});

test('пошук за словом, фільтр за тегом і порожній результат', () => {
  const root = tmpRoot();
  N.createNote(root, { title: 'Хмара', category: 'Resources', tags: 'cloud', body: 'IaaS і PaaS' });
  N.createNote(root, { title: 'Огляд PARA', category: 'Resources', tags: 'para', body: 'проєкти' });
  const all = N.loadNotes(root);
  assert.equal(N.filterNotes(all, { q: 'paas' }).length, 1);
  assert.equal(N.filterNotes(all, { tag: 'para' })[0].title, 'Огляд PARA');
  assert.equal(N.filterNotes(all, { q: 'paas', tag: 'para' }).length, 0);
  assert.equal(N.filterNotes(all, { q: 'неіснуюче-слово' }).length, 0);
});

test('внутрішні посилання та зворотні посилання', () => {
  const root = tmpRoot();
  N.createNote(root, { title: 'Альфа', body: 'див. [[Бета]]' });
  N.createNote(root, { title: 'Бета' });
  const a = N.getNote(root, 'Inbox/альфа');
  assert.equal(a.links[0].id, 'Inbox/бета');
  assert.deepEqual(N.getNote(root, 'Inbox/бета').backlinks, [{ id: 'Inbox/альфа', title: 'Альфа' }]);
});

test('updateNote зберігає метадані та оновлює updated', () => {
  const root = tmpRoot();
  N.createNote(root, { title: 'Редаг', tags: 'old' });
  const u = N.updateNote(root, 'Inbox/редаг', { tags: 'new', body: '# Редаг\n\nНовий текст' });
  assert.deepEqual(u.tags, ['new']);
  assert.match(u.body, /Новий текст/);
  assert.equal(u.title, 'Редаг');
  assert.throws(() => N.updateNote(root, 'Inbox/редаг', { status: 'bad' }), (e) => e.status === 400);
  assert.throws(() => N.updateNote(root, 'Inbox/нема', {}), (e) => e.status === 404);
});

test('HTTP API: список, створення, перезапуск сервера зберігає дані', async () => {
  const root = tmpRoot();
  const start = () => new Promise((resolve) => {
    const s = createServer(root).listen(0, '127.0.0.1', () => resolve(s));
  });
  const stop = (s) => new Promise((r) => s.close(r));
  const call = async (s, p, opts) => {
    const r = await fetch(`http://127.0.0.1:${s.address().port}${p}`, opts);
    return { status: r.status, json: await r.json() };
  };

  let s = await start();
  const created = await call(s, '/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Через API', tags: 'api', body: 'вміст' }),
  });
  assert.equal(created.status, 201);
  await stop(s);

  s = await start(); // «перезапуск»
  const list = await call(s, '/api/notes?q=вміст');
  assert.equal(list.json.notes.length, 1);
  const empty = await call(s, '/api/notes?q=zzzzz');
  assert.equal(empty.json.notes.length, 0);
  assert.equal((await call(s, '/api/notes/Inbox/нема')).status, 404);
  const bad = await fetch(`http://127.0.0.1:${s.address().port}/api/notes`, { method: 'POST', body: '{не json' });
  assert.equal(bad.status, 400);
  const trav = await fetch(`http://127.0.0.1:${s.address().port}/..%2f..%2fpackage.json`);
  assert.equal(trav.status, 404);
  await stop(s);
});
