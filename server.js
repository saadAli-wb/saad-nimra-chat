'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PEER = { saad: 'nimra', nimra: 'saad' };
const DAY = 24 * 3600 * 1000;
const URL_RE = /^\/uploads\/[a-f0-9]+(\.[a-z0-9]+)?$/;
const hashPw = pw => crypto.scryptSync(String(pw), 'private-messenger', 32).toString('hex');

/* ---------- JSON file database ---------- */
const newUser = (id, name, pw) => ({ id, name, pass: hashPw(pw), avatar: null, wallpaper: null, contactName: null, lastSeen: null });
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = null; }
if (!db) {
  db = {
    users: {
      saad: newUser('saad', 'Saad', process.env.SAAD_PASS || 'saad123'),
      nimra: newUser('nimra', 'Nimra', process.env.NIMRA_PASS || 'nimra123')
    }
  };
}
db.messages ||= []; db.statuses ||= []; db.sessions ||= {}; db.seq ||= 0;

let saveTimer = null;
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const tmp = DB_FILE + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB_FILE); }
  catch { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('Save failed:', e.message); } }
}
const save = () => { if (!saveTimer) saveTimer = setTimeout(flush, 250); };
flush();
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { flush(); process.exit(0); }));

/* ---------- helpers ---------- */
const socks = { saad: new Set(), nimra: new Set() };
const isOn = id => socks[id].size > 0;
const emitTo = (id, ev, data) => socks[id].forEach(s => s.emit(ev, data));
// Who is who in a call, as seen by `viewer` (own real name for self, viewer's personal contact name for the other person)
const party = (viewer, id) => {
  const v = view(viewer);
  return id === viewer ? { id, name: v.me.name, avatar: v.me.avatar } : { id, name: v.peer.name, avatar: v.peer.avatar };
};
const callInfo = (c, viewer) => ({
  callId: c.id, kind: c.kind, callerId: c.caller, calleeId: c.callee,
  caller: party(viewer, c.caller), callee: party(viewer, c.callee)
});

function view(uid) {
  const me = db.users[uid], p = db.users[PEER[uid]];
  return {
    me: { id: me.id, name: me.name, avatar: me.avatar, wallpaper: me.wallpaper },
    peer: { id: p.id, name: me.contactName || p.name, realName: p.name, avatar: p.avatar, lastSeen: p.lastSeen, online: isOn(p.id) }
  };
}
const liveStatuses = () => db.statuses.filter(s => Date.now() - s.at < DAY);
const authUser = t => { const id = t && db.sessions[t]; return id && db.users[id] ? id : null; };
const auth = (req, res, next) => {
  const id = authUser((req.headers.authorization || '').replace('Bearer ', ''));
  if (!id) return res.status(401).json({ error: 'Please log in again' });
  req.uid = id; next();
};
function addMessage(m) {
  db.messages.push(m); save();
  emitTo(m.from, 'message', m); emitTo(m.to, 'message', m);
}

/* ---------- HTTP ---------- */
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
db.accessSessions ||= {};

const getCookie = (req, name) => {
  const cookies = String(req.headers.cookie || '').split(';');
  const item = cookies.find(c => c.trim().startsWith(name + '='));
  return item ? decodeURIComponent(item.trim().slice(name.length + 1)) : null;
};

const hasAccess = req => {
  const token = getCookie(req, 'chat_access');
  return token && db.accessSessions[token] && db.accessSessions[token] > Date.now();
};

app.post('/api/access', (req, res) => {
  const password = String(req.body.password || '');

  if (password !== String(process.env.CHAT_PASSWORD || '')) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const token = crypto.randomBytes(32).toString('hex');

  db.accessSessions[token] = true;
  save();

  res.setHeader(
    'Set-Cookie',
    `chat_access=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`
  );

  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (req.path === '/access.html' || req.path === '/api/access') return next();
  if (!hasAccess(req)) return res.redirect('/access.html');
  next();
});
app.get('/access.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'access.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, ''))
  }),
  limits: { fileSize: 150 * 1024 * 1024 }
});
const kindOf = mime => ['image', 'video', 'audio'].find(k => String(mime).startsWith(k + '/'));

app.post('/api/login', (req, res) => {
  const id = String(req.body.username || '').toLowerCase();
  const u = db.users[id];
  if (!u || u.pass !== hashPw(req.body.password || '')) return res.status(401).json({ error: 'Wrong password' });
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = id; save();
  res.json({ token });
});
app.post('/api/logout', auth, (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  delete db.sessions[t]; save(); res.json({ ok: true });
});
app.get('/api/bootstrap', auth, (req, res) => {
  res.json({ ...view(req.uid), messages: db.messages.filter(m => m.from === req.uid || m.to === req.uid), statuses: liveStatuses() });
});
app.get('/api/statuses', auth, (req, res) => res.json(liveStatuses()));
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  const kind = req.file && kindOf(req.file.mimetype);
  if (!kind) { if (req.file) fs.unlink(req.file.path, () => { }); return res.status(400).json({ error: 'Only images, videos and audio are allowed' }); }
  res.json({ kind, url: '/uploads/' + req.file.filename });
});
app.post('/api/profile', auth, (req, res) => {
  const u = db.users[req.uid], b = req.body || {};
  const okUrl = v => v === null || (typeof v === 'string' && URL_RE.test(v));
  if ('avatar' in b && okUrl(b.avatar)) { u.avatar = b.avatar; emitTo(PEER[u.id], 'peer:update', { avatar: u.avatar }); }
  if ('wallpaper' in b && okUrl(b.wallpaper)) u.wallpaper = b.wallpaper;
  if ('contactName' in b) u.contactName = String(b.contactName || '').trim().slice(0, 40) || null;
  save(); res.json(view(u.id));
});
app.post('/api/status', auth, (req, res) => {
  const { type, text, url } = req.body || {};
  const s = { id: ++db.seq, uid: req.uid, type, text: null, url: null, at: Date.now() };
  if (type === 'text' && String(text || '').trim()) s.text = String(text).trim().slice(0, 300);
  else if (type === 'image' && URL_RE.test(url || '')) s.url = url;
  else return res.status(400).json({ error: 'Invalid status' });
  db.statuses.push(s); save();
  emitTo(PEER[req.uid], 'status:new', { from: req.uid, type });
  res.json(s);
});
setInterval(() => { db.statuses = liveStatuses(); save(); }, 10 * 60 * 1000);

/* ---------- calls: one call at a time, all identities decided by the server ---------- */
let call = null; // { id, kind, caller, callee, answered, t, timer }
const clearCall = () => { if (call) { clearTimeout(call.timer); call = null; } };
const logCall = (c, result, secs = 0) => addMessage({
  id: ++db.seq, from: c.caller, to: c.callee, kind: 'call', callKind: c.kind, result, secs,
  at: Date.now(), delivered: true, seen: true
});
function terminate(uid, calleeReason = 'rejected') {
  const c = call; if (!c) return;
  const other = uid === c.caller ? c.callee : c.caller;
  if (!c.answered) {
    if (uid === c.callee) { logCall(c, 'rejected'); emitTo(c.caller, 'call:end', { callId: c.id, reason: calleeReason }); }
    else { logCall(c, 'missed'); emitTo(c.callee, 'call:end', { callId: c.id, reason: 'missed' }); }
  } else {
    logCall(c, 'ended', Math.round((Date.now() - c.t) / 1000));
    emitTo(other, 'call:end', { callId: c.id, reason: 'ended' });
  }
  emitTo(uid, 'call:end', { callId: c.id, reason: 'handled' });
  clearCall();
}

io.use((s, next) => {
  const id = authUser(s.handshake.auth && s.handshake.auth.token);
  if (!id) return next(new Error('unauthorized'));
  s.uid = id; next();
});
io.on('connection', s => {
  const me = s.uid, peer = PEER[me];
  const first = !isOn(me); socks[me].add(s);
  s.emit('hello', { id: me, name: db.users[me].name });
  if (first) emitTo(peer, 'presence', { online: true, lastSeen: db.users[me].lastSeen });

  const got = [];
  db.messages.forEach(m => { if (m.to === me && !m.delivered) { m.delivered = true; got.push(m.id); } });
  if (got.length) { save(); emitTo(peer, 'receipts', { ids: got, state: 'delivered' }); }

  s.on('send', p => {
    p = p || {};
    const m = { id: ++db.seq, from: me, to: peer, kind: p.kind, text: null, url: null, at: Date.now(), delivered: isOn(peer), seen: false };
    if (p.kind === 'text') { m.text = String(p.text || '').trim().slice(0, 4000); if (!m.text) return; }
    else if (['image', 'video', 'audio'].includes(p.kind) && URL_RE.test(p.url || '')) m.url = p.url;
    else return;
    addMessage(m);
  });
  s.on('read', () => {
    const ids = [];
    db.messages.forEach(m => { if (m.to === me && !m.seen) { m.seen = true; m.delivered = true; ids.push(m.id); } });
    if (ids.length) { save(); emitTo(peer, 'receipts', { ids, state: 'seen' }); }
  });
  s.on('typing', on => emitTo(peer, 'typing', { on: !!on }));

  s.on('call:start', ({ kind } = {}) => {
    kind = kind === 'video' ? 'video' : 'voice';
    if (call && (!isOn(call.caller) || !isOn(call.callee))) clearCall();
    if (call) return s.emit('call:end', { reason: 'busy' });
    const c = { id: crypto.randomUUID(), kind, caller: me, callee: peer, answered: false };
    if (!isOn(peer)) { logCall(c, 'missed'); return s.emit('call:end', { reason: 'offline' }); }
    call = c;
    c.timer = setTimeout(() => {
      if (call !== c || c.answered) return;
      logCall(c, 'missed');
      emitTo(c.caller, 'call:end', { callId: c.id, reason: 'noanswer' });
      emitTo(c.callee, 'call:end', { callId: c.id, reason: 'missed' });
      clearCall();
    }, 45000);
    emitTo(c.caller, 'call:ringing', callInfo(c, c.caller));
    emitTo(c.callee, 'call:incoming', callInfo(c, c.callee));
  });
  s.on('call:accept', ({ callId } = {}) => {
    if (!call || call.id !== callId || call.callee !== me || call.answered) return;
    call.answered = true; call.t = Date.now(); clearTimeout(call.timer);
    emitTo(call.caller, 'call:accepted', { callId });
  });
  s.on('call:reject', ({ callId } = {}) => { if (call && (!callId || call.id === callId) && call.callee === me && !call.answered) terminate(me); });
  s.on('call:busy', ({ callId } = {}) => { if (call && call.id === callId && call.callee === me && !call.answered) terminate(me, 'busy'); });
  s.on('call:cancel', ({ callId } = {}) => { if (call && (!callId || call.id === callId) && call.caller === me && !call.answered) terminate(me); });
  s.on('call:hangup', ({ callId } = {}) => { if (call && call.id === callId && call.answered && (call.caller === me || call.callee === me)) terminate(me); });
  s.on('call:signal', ({ callId, data } = {}) => {
    if (call && call.id === callId && call.answered && (call.caller === me || call.callee === me)) emitTo(peer, 'call:signal', { callId, data });
  });

  s.on('disconnect', () => {
    socks[me].delete(s);
    if (isOn(me)) return;
    db.users[me].lastSeen = Date.now(); save();
    emitTo(peer, 'presence', { online: false, lastSeen: db.users[me].lastSeen });
    if (call && (call.caller === me || call.callee === me)) terminate(me);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Private Messenger running → http://localhost:${PORT}`));
