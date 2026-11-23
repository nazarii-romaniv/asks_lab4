'use strict';
const state = { q: '', tag: '', category: '', data: null };
const $ = (s) => document.querySelector(s);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// ---------- Мінімальний Markdown (безпечний: спершу екранування) ----------
function inline(text, linkMap) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, t) => {
    const key = t.trim().toLowerCase();
    const id = linkMap.get(key);
    return id
      ? `<a href="#/note/${encodeURIComponent(id)}" class="wikilink">${t.trim()}</a>`
      : `<span class="broken" title="Нотатки з такою назвою немає">${t.trim()}</span>`;
  });
}

function renderMd(body, links) {
  const linkMap = new Map(links.filter((l) => l.id).map((l) => [esc(l.title).toLowerCase(), l.id]));
  const out = [];
  let list = false;
  let fence = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('```')) { closeList(); out.push(fence ? '</pre>' : '<pre>'); fence = !fence; continue; }
    if (fence) { out.push(esc(line)); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2], linkMap)}</h${h[1].length + 1}>`); }
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1], linkMap)}</li>`); }
    else if (line.trim() === '') closeList();
    else { closeList(); out.push(`<p>${inline(line, linkMap)}</p>`); }
  }
  closeList();
  return out.join('\n');
}

// ---------- Список ----------
async function loadList() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.tag) p.set('tag', state.tag);
  if (state.category) p.set('category', state.category);
  state.data = await api(`/api/notes?${p}`);
  renderList();
}

function renderList() {
  const d = state.data;
  $('#categories').innerHTML = `<li><button data-cat="" class="${state.category ? '' : 'on'}">Усі (${d.total})</button></li>` +
    Object.entries(d.categories).map(([c, n]) =>
      `<li><button data-cat="${c}" class="${state.category === c ? 'on' : ''}">${c} (${n})</button></li>`).join('');
  $('#tags').innerHTML = d.tags.map((t) =>
    `<button class="tag ${state.tag === t.tag ? 'on' : ''}" data-tag="${esc(t.tag)}">#${esc(t.tag)} ${t.count}</button>`).join(' ');
  $('#count').textContent = d.notes.length
    ? `Знайдено нотаток: ${d.notes.length}`
    : 'Нічого не знайдено. Змініть запит або скиньте фільтри.';
  $('#results').innerHTML = d.notes.map((n) => `
    <li class="card">
      <a href="#/note/${encodeURIComponent(n.id)}"><strong>${esc(n.title)}</strong></a>
      <span class="meta">${esc(n.category)} · ${esc(n.type)} · ${esc(n.status)} · ${esc(n.updated)}</span>
      <p>${esc(n.snippet)}</p>
      <span>${n.tags.map((t) => `<span class="tag small">#${esc(t)}</span>`).join(' ')}</span>
    </li>`).join('');
}

// ---------- Перегляд / редагування ----------
async function showNote(id) {
  try {
    const n = await api(`/api/notes/${encodeURIComponent(id)}`);
    $('#list-view').hidden = true;
    const v = $('#note-view');
    v.hidden = false;
    v.innerHTML = `
      <p><a href="#/">← До списку</a></p>
      <p class="meta">${esc(n.category)} · ${esc(n.type)} · ${esc(n.status)} · створено ${esc(n.created)} · оновлено ${esc(n.updated)}</p>
      <div class="body">${renderMd(n.body, n.links)}</div>
      <p>${n.tags.map((t) => `<span class="tag small">#${esc(t)}</span>`).join(' ')}</p>
      ${n.backlinks.length ? `<h3>Зворотні посилання</h3><ul>${n.backlinks.map((b) =>
        `<li><a href="#/note/${encodeURIComponent(b.id)}">${esc(b.title)}</a></li>`).join('')}</ul>` : ''}
      <button id="edit-btn" type="button">Редагувати</button>`;
    $('#edit-btn').onclick = () => editNote(n);
  } catch (e) {
    $('#list-view').hidden = true;
    $('#note-view').hidden = false;
    $('#note-view').innerHTML = `<p class="error">${esc(e.message)}</p><p><a href="#/">← До списку</a></p>`;
  }
}

function editNote(n) {
  $('#note-view').innerHTML = `
    <form id="edit-form">
      <label>Теги <input name="tags" value="${esc(n.tags.join(', '))}"></label>
      <label>Статус <select name="status">${['draft', 'active', 'archived'].map((s) =>
        `<option ${s === n.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Текст <textarea name="body" rows="18">${esc(n.body)}</textarea></label>
      <p id="edit-error" class="error" role="alert"></p>
      <div class="actions"><button type="submit">Зберегти</button>
      <button type="button" id="cancel-edit">Скасувати</button></div>
    </form>`;
  $('#cancel-edit').onclick = () => showNote(n.id);
  $('#edit-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      await api(`/api/notes/${encodeURIComponent(n.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: f.get('tags'), status: f.get('status'), body: f.get('body') }),
      });
      await loadList();
      showNote(n.id);
    } catch (e) { $('#edit-error').textContent = e.message; }
  };
}

// ---------- Маршрутизація ----------
async function route() {
  const m = /^#\/note\/(.+)$/.exec(location.hash);
  if (m) { await showNote(decodeURIComponent(m[1])); return; }
  $('#note-view').hidden = true;
  $('#list-view').hidden = false;
  await loadList();
}

// ---------- Події ----------
let timer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = e.target.value; if (location.hash.startsWith('#/note/')) location.hash = '#/'; else loadList(); }, 200);
});
$('#categories').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cat]');
  if (b) { state.category = b.dataset.cat; location.hash = '#/'; loadList(); }
});
$('#tags').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tag]');
  if (b) { state.tag = state.tag === b.dataset.tag ? '' : b.dataset.tag; location.hash = '#/'; loadList(); }
});
window.addEventListener('hashchange', route);

$('#new-btn').onclick = () => { $('#form-error').textContent = ''; $('#new-dialog').showModal(); };
$('#cancel-new').onclick = () => $('#new-dialog').close();
$('#new-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try {
    const n = await api('/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
    });
    ev.target.reset();
    $('#new-dialog').close();
    location.hash = `#/note/${encodeURIComponent(n.id)}`;
    await loadList();
  } catch (e) { $('#form-error').textContent = e.message; }
};

route();
