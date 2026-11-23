'use strict';
// Локальний HTTP-сервер: JSON API + статичний інтерфейс. Лише node:*, слухає 127.0.0.1.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const notes = require('./notes');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new notes.NoteError('Запит завеликий', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new notes.NoteError('Некоректний JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function createServer(root) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;

      if (pathname === '/api/notes' && req.method === 'GET') {
        const all = notes.loadNotes(root);
        const found = notes.filterNotes(all, {
          q: url.searchParams.get('q') || '',
          tag: url.searchParams.get('tag') || '',
          category: url.searchParams.get('category') || '',
        });
        return send(res, 200, { total: all.length, notes: found.map(notes.summary), ...notes.stats(all) });
      }
      if (pathname === '/api/notes' && req.method === 'POST') {
        return send(res, 201, notes.createNote(root, await readJson(req)));
      }
      if (pathname.startsWith('/api/notes/')) {
        const id = decodeURIComponent(pathname.slice('/api/notes/'.length));
        if (req.method === 'GET') return send(res, 200, notes.getNote(root, id));
        if (req.method === 'PUT') return send(res, 200, notes.updateNote(root, id, await readJson(req)));
        return send(res, 405, { error: 'Метод не підтримується' });
      }
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Невідомий маршрут' });
      if (req.method !== 'GET') return send(res, 405, { error: 'Метод не підтримується' });
      return serveStatic(res, pathname);
    } catch (e) {
      if (e instanceof notes.NoteError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Внутрішня помилка' });
    }
  });
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const port = Number(process.env.PORT) || 3000;
  createServer(root).listen(port, '127.0.0.1', () => {
    console.log(`Second Brain: http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
