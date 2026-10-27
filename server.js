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

const newUser = (id, name, pw) => ({
  id,
  name,
  pass: hashPw(pw),
  avatar: null,
  wallpaper: null,
  contactName: null,
  lastSeen: null
});

let db;

try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  db = null;
}

if (!db) {
  db = {
    users: {
      saad: newUser('saad', 'Saad', process.env.SAAD_PASS || 'saad123'),
      nimra: newUser('nimra', 'Nimra', process.env.NIMRA_PASS || 'nimra123')
    }
  };
}

db.messages ||= [];
db.statuses ||= [];
db.sessions ||= {};
db.seq ||= 0;

let saveTimer = null;

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;

  const tmp = DB_FILE + '.tmp';

  try {
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db));
    } catch (e) {
      console.error('Save failed:', e.message);
    }
  }
}

const save = () => {
  if (!saveTimer) saveTimer = setTimeout(flush, 250);
};

flush();

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    flush();
    process.exit(0);
  });
});

/* ---------- helpers ---------- */

const socks = { saad: new Set(), nimra: new Set() };

const isOn = id => socks[id].size > 0;

const emitTo = (id, ev, data) => socks[id].forEach(socket => socket.emit(ev, data));

function view(uid) {
  const me = db.users[uid];
  const peer = db.users[PEER[uid]];

  return {
    me: {
      id: me.id,
      name: me.name,
      avatar: me.avatar,
      wallpaper: me.wallpaper
    },
    peer: {
      id: peer.id,
      name: me.contactName || peer.name,
      realName: peer.name,
      avatar: peer.avatar,
      lastSeen: peer.lastSeen,
      online: isOn(peer.id)
    }
  };
}

const party = (viewer, id) => {
  const v = view(viewer);

  return id === viewer
    ? { id, name: v.me.name, avatar: v.me.avatar }
    : { id, name: v.peer.name, avatar: v.peer.avatar };
};

const callInfo = (c, viewer) => ({
  callId: c.id,
  kind: c.kind,
  callerId: c.caller,
  calleeId: c.callee,
  caller: party(viewer, c.caller),
  callee: party(viewer, c.callee)
});

const liveStatuses = () => db.statuses.filter(status => Date.now() - status.at < DAY);

const authUser = token => {
  const id = token && db.sessions[token];
  return id && db.users[id] ? id : null;
};

const auth = (req, res, next) => {
  const id = authUser((req.headers.authorization || '').replace('Bearer ', ''));

  if (!id) {
    return res.status(401).json({ error: 'Please log in again' });
  }

  req.uid = id;
  next();
};

function addMessage(message) {
  db.messages.push(message);
  save();
  emitTo(message.from, 'message', message);
  emitTo(message.to, 'message', message);
}

/* tell both people that a message changed (edit / delete) */
function pushUpdate(m, fields) {
  const patch = { id: m.id, ...fields };
  emitTo(m.from, 'msg:update', patch);
  emitTo(m.to, 'msg:update', patch);
}

/* is an uploaded file still used anywhere? */
const urlInUse = url =>
  db.messages.some(m => m.url === url) ||
  db.statuses.some(s => s.url === url) ||
  Object.values(db.users).some(u => u.avatar === url || u.wallpaper === url);

/* ---------- HTTP ---------- */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const noStore = res => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

/* ---------- PRIVATE ACCESS SYSTEM ----------
   Every successful access password creates a one-time token.
   The token is required to open the chat page and is consumed
   immediately when the chat page opens.
   Password -> Chat. Reload -> Password again.
*/

const accessTokens = new Map();

app.post('/api/access', (req, res) => {
  const password = String(req.body.password || '');
  const correctPassword = String(process.env.CHAT_PASSWORD || '');

  if (!correctPassword || password !== correctPassword) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const token = crypto.randomBytes(32).toString('hex');

  accessTokens.set(token, Date.now());

  /* token expires after 60 seconds if it is not used */
  setTimeout(() => {
    accessTokens.delete(token);
  }, 60 * 1000);

  res.json({ ok: true, token });
});

/* protected chat page */
app.get('/', (req, res) => {
  const token = String(req.query.accessToken || '');

  if (!token || !accessTokens.has(token)) {
    return res.redirect('/access.html');
  }

  /* consume token immediately */
  accessTokens.delete(token);

  noStore(res);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* direct index.html protection */
app.get('/index.html', (req, res) => res.redirect('/access.html'));

/* access page */
app.get('/access.html', (req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, 'public', 'access.html'));
});

/* static files: html / js / css are always re-checked, so new code loads */
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    setHeaders: (res, filePath) => {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  })
);

app.use('/uploads', express.static(UPLOAD_DIR));

/* ---------- uploads ---------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      cb(
        null,
        crypto.randomBytes(16).toString('hex') +
          path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')
      );
    }
  }),
  limits: { fileSize: 150 * 1024 * 1024 }
});

const kindOf = mime =>
  ['image', 'video', 'audio'].find(kind => String(mime).startsWith(kind + '/'));

/* ---------- login / logout ---------- */

app.post('/api/login', (req, res) => {
  const id = String(req.body.username || '').toLowerCase();
  const user = db.users[id];

  if (!user || user.pass !== hashPw(req.body.password || '')) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const token = crypto.randomBytes(24).toString('hex');

  db.sessions[token] = id;
  save();

  res.json({ token });
});

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');

  delete db.sessions[token];
  save();

  res.json({ ok: true });
});

/* ---------- bootstrap ---------- */

app.get('/api/bootstrap', auth, (req, res) => {
  res.json({
    ...view(req.uid),
    messages: db.messages.filter(m => m.from === req.uid || m.to === req.uid),
    statuses: liveStatuses()
  });
});

/* ---------- statuses ---------- */

app.get('/api/statuses', auth, (req, res) => {
  res.json(liveStatuses());
});

/* ---------- upload ---------- */

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  const kind = req.file && kindOf(req.file.mimetype);

  if (!kind) {
    if (req.file) fs.unlink(req.file.path, () => {});

    return res.status(400).json({ error: 'Only images, videos and audio are allowed' });
  }

  res.json({ kind, url: '/uploads/' + req.file.filename });
});

/* ---------- profile ---------- */

app.post('/api/profile', auth, (req, res) => {
  const user = db.users[req.uid];
  const body = req.body || {};

  const okUrl = value => value === null || (typeof value === 'string' && URL_RE.test(value));

  if ('avatar' in body && okUrl(body.avatar)) {
    user.avatar = body.avatar;
    emitTo(PEER[user.id], 'peer:update', { avatar: user.avatar });
  }

  if ('wallpaper' in body && okUrl(body.wallpaper)) {
    user.wallpaper = body.wallpaper;
  }

  if ('contactName' in body) {
    user.contactName = String(body.contactName || '').trim().slice(0, 40) || null;
  }

  save();

  res.json(view(user.id));
});

/* ---------- status post ---------- */

app.post('/api/status', auth, (req, res) => {
  const { type, text, url } = req.body || {};

  const status = {
    id: ++db.seq,
    uid: req.uid,
    type,
    text: null,
    url: null,
    at: Date.now()
  };

  if (type === 'text' && String(text || '').trim()) {
    status.text = String(text).trim().slice(0, 300);
  } else if (type === 'image' && URL_RE.test(url || '')) {
    status.url = url;
  } else {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.statuses.push(status);
  save();

  emitTo(PEER[req.uid], 'status:new', { from: req.uid, type });

  res.json(status);
});

/* clean old statuses */
setInterval(() => {
  db.statuses = liveStatuses();
  save();
}, 10 * 60 * 1000);

/* ---------- calls ---------- */

let call = null;

const clearCall = () => {
  if (call) {
    clearTimeout(call.timer);
    call = null;
  }
};

const logCall = (c, result, secs = 0) =>
  addMessage({
    id: ++db.seq,
    from: c.caller,
    to: c.callee,
    kind: 'call',
    callKind: c.kind,
    result,
    secs,
    at: Date.now(),
    delivered: true,
    seen: true
  });

function terminate(uid, calleeReason = 'rejected') {
  const c = call;

  if (!c) return;

  const other = uid === c.caller ? c.callee : c.caller;

  if (!c.answered) {
    if (uid === c.callee) {
      logCall(c, 'rejected');
      emitTo(c.caller, 'call:end', { callId: c.id, reason: calleeReason });
    } else {
      logCall(c, 'missed');
      emitTo(c.callee, 'call:end', { callId: c.id, reason: 'missed' });
    }
  } else {
    logCall(c, 'ended', Math.round((Date.now() - c.t) / 1000));
    emitTo(other, 'call:end', { callId: c.id, reason: 'ended' });
  }

  emitTo(uid, 'call:end', { callId: c.id, reason: 'handled' });

  clearCall();
}

/* ---------- socket authentication ---------- */

io.use((socket, next) => {
  const id = authUser(socket.handshake.auth && socket.handshake.auth.token);

  if (!id) {
    return next(new Error('unauthorized'));
  }

  socket.uid = id;
  next();
});

/* ---------- socket connection ---------- */

io.on('connection', socket => {
  const me = socket.uid;
  const peer = PEER[me];

  const first = !isOn(me);

  socks[me].add(socket);

  socket.emit('hello', { id: me, name: db.users[me].name });

  if (first) {
    emitTo(peer, 'presence', { online: true, lastSeen: db.users[me].lastSeen });
  }

  const got = [];

  db.messages.forEach(message => {
    if (message.to === me && !message.delivered) {
      message.delivered = true;
      got.push(message.id);
    }
  });

  if (got.length) {
    save();
    emitTo(peer, 'receipts', { ids: got, state: 'delivered' });
  }

  /* ---------- send (text / image / video / audio, optional reply) ---------- */

  socket.on('send', payload => {
    payload = payload || {};

    const message = {
      id: ++db.seq,
      from: me,
      to: peer,
      kind: payload.kind,
      text: null,
      url: null,
      at: Date.now(),
      delivered: isOn(peer),
      seen: false
    };

    if (payload.kind === 'text') {
      message.text = String(payload.text || '').trim().slice(0, 4000);

      if (!message.text) return;
    } else if (['image', 'video', 'audio'].includes(payload.kind) && URL_RE.test(payload.url || '')) {
      message.url = payload.url;
    } else {
      return;
    }

    /* reply to an earlier message of this chat */
    const rid = Number(payload.replyTo);

    if (rid && db.messages.some(m => m.id === rid && m.kind !== 'call' && (m.from === me || m.to === me))) {
      message.replyTo = rid;
    }

    addMessage(message);
  });

  /* ---------- edit own text message ---------- */

  socket.on('edit', payload => {
    const { id, text } = payload || {};
    const m = db.messages.find(x => x.id === Number(id) && x.from === me);
    const t = String(text || '').trim().slice(0, 4000);

    if (!m || m.kind !== 'text' || m.deleted || !t || t === m.text) return;

    m.text = t;
    m.edited = true;
    save();

    pushUpdate(m, { text: m.text, edited: true });
  });

  /* ---------- delete own message (for everyone) ---------- */

  socket.on('delete', payload => {
    const { id } = payload || {};
    const m = db.messages.find(x => x.id === Number(id) && x.from === me);

    if (!m || m.kind === 'call' || m.deleted) return;

    const url = m.url;

    m.deleted = true;
    m.text = null;
    m.url = null;
    save();

    if (url && !urlInUse(url)) {
      fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
    }

    pushUpdate(m, { deleted: true, text: null, url: null });
  });

  /* ---------- read ---------- */

  socket.on('read', () => {
    const ids = [];

    db.messages.forEach(message => {
      if (message.to === me && !message.seen) {
        message.seen = true;
        message.delivered = true;
        ids.push(message.id);
      }
    });

    if (ids.length) {
      save();
      emitTo(peer, 'receipts', { ids, state: 'seen' });
    }
  });

  /* ---------- typing ---------- */

  socket.on('typing', on => {
    emitTo(peer, 'typing', { on: !!on });
  });

  /* ---------- call start ---------- */

  socket.on('call:start', payload => {
    let { kind } = payload || {};

    kind = kind === 'video' ? 'video' : 'voice';

    if (call && (!isOn(call.caller) || !isOn(call.callee))) {
      clearCall();
    }

    if (call) {
      return socket.emit('call:end', { reason: 'busy' });
    }

    const c = {
      id: crypto.randomUUID(),
      kind,
      caller: me,
      callee: peer,
      answered: false
    };

    if (!isOn(peer)) {
      logCall(c, 'missed');

      return socket.emit('call:end', { reason: 'offline' });
    }

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

  /* ---------- call accept ---------- */

  socket.on('call:accept', payload => {
    const { callId } = payload || {};

    if (!call || call.id !== callId || call.callee !== me || call.answered) return;

    call.answered = true;
    call.t = Date.now();

    clearTimeout(call.timer);

    emitTo(call.caller, 'call:accepted', { callId });
  });

  /* ---------- call reject ---------- */

  socket.on('call:reject', payload => {
    const { callId } = payload || {};

    if (call && (!callId || call.id === callId) && call.callee === me && !call.answered) {
      terminate(me);
    }
  });

  /* ---------- call busy ---------- */

  socket.on('call:busy', payload => {
    const { callId } = payload || {};

    if (call && call.id === callId && call.callee === me && !call.answered) {
      terminate(me, 'busy');
    }
  });

  /* ---------- call cancel ---------- */

  socket.on('call:cancel', payload => {
    const { callId } = payload || {};

    if (call && (!callId || call.id === callId) && call.caller === me && !call.answered) {
      terminate(me);
    }
  });

  /* ---------- call hangup ---------- */

  socket.on('call:hangup', payload => {
    const { callId } = payload || {};

    if (call && call.id === callId && call.answered && (call.caller === me || call.callee === me)) {
      terminate(me);
    }
  });

  /* ---------- call signal ---------- */

  socket.on('call:signal', payload => {
    const { callId, data } = payload || {};

    if (call && call.id === callId && call.answered && (call.caller === me || call.callee === me)) {
      emitTo(peer, 'call:signal', { callId, data });
    }
  });

  /* ---------- disconnect ---------- */

  socket.on('disconnect', () => {
    socks[me].delete(socket);

    if (isOn(me)) return;

    db.users[me].lastSeen = Date.now();
    save();

    emitTo(peer, 'presence', { online: false, lastSeen: db.users[me].lastSeen });

    if (call && (call.caller === me || call.callee === me)) {
      terminate(me);
    }
  });
});

/* ---------- start ---------- */

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Private Messenger running → http://localhost:${PORT}`);
});
