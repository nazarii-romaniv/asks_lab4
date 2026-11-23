'use strict';
// Ядро Second Brain: читання/запис Markdown-нотаток з YAML frontmatter.
// Без зовнішніх залежностей, без мережевих викликів.
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archives'];
const DEFAULT_TYPE = {
  Inbox: 'inbox', Projects: 'project', Areas: 'area', Resources: 'resource', Archives: 'archive',
};
const META_ORDER = ['title', 'created', 'updated', 'type', 'status', 'tags', 'source'];
const STATUSES = ['draft', 'active', 'archived'];

class NoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'NoteError';
    this.status = status;
  }
}

// ---------- Парсинг ----------
function parseScalar(v) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
      (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    return s.slice(1, -1);
  }
  return s;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map(parseScalar).filter(Boolean) : [];
  }
  return parseScalar(v);
}

function parseNote(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    meta[line.slice(0, idx).trim()] = parseValue(line.slice(idx + 1));
  }
  return { meta, body: m[2] };
}

function serializeNote(meta, body) {
  const lines = ['---'];
  const keys = [...META_ORDER, ...Object.keys(meta).filter((k) => !META_ORDER.includes(k))];
  for (const k of keys) {
    const v = meta[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'tags') lines.push(`tags: [${toTags(v).join(', ')}]`);
    else if (k === 'title' || k === 'source') lines.push(`${k}: "${String(v).replace(/"/g, "'")}"`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n${body.replace(/^\n+/, '')}`;
}

function extractLinks(body) {
  const out = [];
  // посилання всередині кодових блоків та `inline code` — це приклади синтаксису, а не зв’язки
  body = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const t = m[1].trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

function toTags(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  for (const t of arr) {
    const tag = String(t).trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
    if (tag) seen.add(tag);
  }
  return [...seen];
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- Читання ----------
function loadNotes(root) {
  const notes = [];
  for (const category of CATEGORIES) {
    const dir = path.join(root, 'notes', category);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const { meta, body } = parseNote(text);
      const base = file.slice(0, -3);
      notes.push({
        id: `${category}/${base}`,
        category,
        file,
        title: String(meta.title || base),
        meta,
        tags: toTags(meta.tags),
        body,
        links: extractLinks(body),
      });
    }
  }
  return notes;
}

function filterNotes(notes, { q = '', tag = '', category = '' } = {}) {
  const needle = q.trim().toLowerCase();
  const t = tag.trim().toLowerCase().replace(/^#/, '');
  return notes.filter((n) => {
    if (category && n.category !== category) return false;
    if (t && !n.tags.includes(t)) return false;
    if (!needle) return true;
    return `${n.title}\n${n.tags.join(' ')}\n${n.body}`.toLowerCase().includes(needle);
  });
}

function summary(n) {
  const snippet = n.body.replace(/^#+\s.*$/gm, '').replace(/[*`>\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return {
    id: n.id, title: n.title, category: n.category,
    type: n.meta.type || '', status: n.meta.status || '',
    tags: n.tags, created: n.meta.created || '', updated: n.meta.updated || '', snippet,
  };
}

function stats(notes) {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const tagCount = new Map();
  for (const n of notes) {
    categories[n.category] += 1;
    for (const t of n.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  const tags = [...tagCount].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { categories, tags };
}

function resolveLinks(notes, note) {
  return note.links.map((title) => {
    const target = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    return { title, id: target ? target.id : null };
  });
}

function backlinks(notes, note) {
  const me = note.title.toLowerCase();
  return notes
    .filter((n) => n.id !== note.id && n.links.some((l) => l.toLowerCase() === me))
    .map((n) => ({ id: n.id, title: n.title }));
}

function getNote(root, id) {
  const notes = loadNotes(root);
  const note = notes.find((n) => n.id === id);
  if (!note) throw new NoteError('Нотатку не знайдено', 404);
  return {
    ...summary(note), meta: note.meta, body: note.body,
    links: resolveLinks(notes, note), backlinks: backlinks(notes, note),
  };
}

// ---------- Запис ----------
function slugify(title) {
  return title.toLowerCase().normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

function createNote(root, input = {}) {
  const title = String(input.title || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new NoteError('Назва обов’язкова');
  const category = input.category || 'Inbox';
  if (!CATEGORIES.includes(category)) throw new NoteError(`Невідома категорія: ${category}`);
  const slug = slugify(title);
  if (!slug) throw new NoteError('Назва має містити літери або цифри');

  const dir = path.join(root, 'notes', category);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);

  const date = today();
  const meta = {
    title,
    created: date,
    updated: date,
    type: input.type || DEFAULT_TYPE[category],
    status: input.status || (category === 'Inbox' ? 'draft' : 'active'),
    tags: toTags(input.tags),
    source: input.source || 'власний конспект',
  };
  if (!STATUSES.includes(meta.status)) throw new NoteError(`Невідомий статус: ${meta.status}`);
  const content = String(input.body || '').trim() || '## Короткий зміст\n\n';
  const body = /^#\s/m.test(content) ? content : `# ${title}\n\n${content}`;
  try {
    fs.writeFileSync(file, serializeNote(meta, `${body}\n`), { flag: 'wx' }); // не перезаписуємо наявне
  } catch (e) {
    if (e.code === 'EEXIST') throw new NoteError('Нотатка з такою назвою вже існує', 409);
    throw e;
  }
  return getNote(root, `${category}/${slug}`);
}

function updateNote(root, id, input = {}) {
  const notes = loadNotes(root);
  const note = notes.find((n) => n.id === id);
  if (!note) throw new NoteError('Нотатку не знайдено', 404);
  const meta = { ...note.meta };
  if (input.tags !== undefined) meta.tags = toTags(input.tags);
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new NoteError(`Невідомий статус: ${input.status}`);
    meta.status = input.status;
  }
  const body = input.body !== undefined ? String(input.body) : note.body;
  meta.updated = today();
  const file = path.join(root, 'notes', note.category, note.file);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeNote(meta, body));
  fs.renameSync(tmp, file); // атомарна заміна, щоб не втратити файл при збої
  return getNote(root, id);
}

module.exports = {
  CATEGORIES, STATUSES, NoteError,
  parseNote, serializeNote, extractLinks, toTags, slugify,
  loadNotes, filterNotes, summary, stats, getNote, createNote, updateNote,
};
