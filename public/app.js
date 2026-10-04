'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const IC = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  video: '<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  dots: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  clip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  mic: '<rect x="9" y="1" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>'
};
$$('[data-ic]').forEach(e => e.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[e.dataset.ic]}</svg>`);

const S = { token: sessionStorage.getItem('pm_token'), me: null, peer: null, msgs: [], sock: null, peerTyping: false, notif: localStorage.getItem('pm_notif') !== 'off' };
const COLORS = { saad: '#7c5cff', nimra: '#ff5c9d' };
const initialAv = (name, id) => {
  const ch = ((name || '?').trim()[0] || '?').replace(/[<>&'"]/g, '?').toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='${COLORS[id] || '#556'}'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif'>${ch}</text></svg>`);
};
const avatarOf = u => u.avatar || initialAv(u.name, u.id);
const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = t => {
  const d = new Date(t), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'Today';
  n.setDate(n.getDate() - 1);
  return d.toDateString() === n.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const cap = s => s[0].toUpperCase() + s.slice(1);

async function api(url, opt = {}) {
  const headers = { Authorization: 'Bearer ' + S.token };
  if (opt.body && !(opt.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { ...opt, headers });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { sessionStorage.removeItem('pm_token'); location.reload(); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
const postJson = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
async function uploadFile(file) { const f = new FormData(); f.append('file', file); return api('/api/upload', { method: 'POST', body: f }); }

function toast(title, body) {
  const t = mk('div', 'toast'); t.append(mk('b', '', title)); if (body) t.append(mk('span', '', body));
  $('#toasts').append(t); setTimeout(() => t.remove(), 5000);
}
function notify(title, body) {
  if (!S.notif) return;
  toast(title, body);
  if ((document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: S.peer ? avatarOf(S.peer) : undefined }); } catch { }
  }
}

/* ---------- login ---------- */
let picked = null;
$$('.tile').forEach(t => {
  const id = t.dataset.user;
  $('img', t).src = initialAv(id === 'saad' ? 'Saad' : 'Nimra', id);
  t.onclick = () => { picked = id; $$('.tile').forEach(x => x.classList.toggle('on', x === t)); $('#authForm').hidden = false; $('#pw').focus(); };
});
$('#authForm').onsubmit = async e => {
  e.preventDefault(); $('#authErr').textContent = '';
  if (!picked) return;
  try { const r = await postJson('/api/login', { username: picked, password: $('#pw').value }); S.token = r.token; sessionStorage.setItem('pm_token', r.token); location.reload(); }
  catch (er) { $('#authErr').textContent = er.message; }
};
$('#logoutBtn').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { } sessionStorage.removeItem('pm_token'); location.reload(); };

/* ---------- boot ---------- */
async function loadAll() {
  const d = await api('/api/bootstrap');
  S.me = d.me; S.peer = d.peer; S.msgs = d.messages;
  paintHeader(); paintMe(); paintWallpaper(); paintStream(); paintNotifBtn();
}
async function boot() {
  if (!S.token) return;
  try { await loadAll(); } catch { return; }
  $('#auth').hidden = true; $('#app').hidden = false;
  connect();
}

function connect() {
  const s = S.sock = io({ auth: { token: S.token } });
  let first = true;
  s.on('hello', h => {
    if (S.me && h.id !== S.me.id) { sessionStorage.removeItem('pm_token'); location.reload(); return; }
    if (S.ver && h.v && S.ver !== h.v) { location.reload(); return; }
    S.ver = h.v;
  });
  s.on('connect', () => { if (first) { first = false; markRead(); } else loadAll(); });
  s.on('message', onMessage);
  s.on('receipts', ({ ids, state }) => ids.forEach(id => {
    const m = S.msgs.find(x => x.id === id); if (!m) return;
    m[state] = true; if (state === 'seen') m.delivered = true; paintTick(m);
  }));
  s.on('presence', p => { S.peer.online = p.online; if (p.lastSeen) S.peer.lastSeen = p.lastSeen; if (!p.online) S.peerTyping = false; paintHeader(); });
  s.on('peer:update', p => { Object.assign(S.peer, p); paintHeader(); });
  s.on('typing', ({ on }) => { S.peerTyping = on; paintHeader(); });
  s.on('status:new', ({ type }) => { notify(S.peer.name, type === 'image' ? 'posted a photo status' : 'posted a new status'); if (!$('#statusModal').hidden) refreshStatus(); });
  s.on('call:ringing', onRinging);
  s.on('call:incoming', onIncoming);
  s.on('call:accepted', onAccepted);
  s.on('call:signal', onSignal);
  s.on('call:end', onCallEnd);
}

/* ---------- header / presence ---------- */
function paintHeader() {
  $('#hdrAv').src = avatarOf(S.peer); $('#hdrName').textContent = S.peer.name;
  const sub = $('#hdrSub'); sub.className = '';
  if (S.peer.online) { sub.textContent = S.peerTyping ? 'typing…' : 'Online'; sub.className = 'on'; }
  else sub.textContent = S.peer.lastSeen ? `last seen ${dayLabel(S.peer.lastSeen).toLowerCase()} at ${fmtTime(S.peer.lastSeen)}` : 'Offline';
}
function paintMe() { $('#sheetAv').src = avatarOf(S.me); $('#sheetMe').textContent = S.me.name; document.title = S.me.name + ' · Messenger'; }
function paintWallpaper() { $('#stream').style.backgroundImage = S.me.wallpaper ? `linear-gradient(#0c0f1ad0,#0c0f1ad0),url(${S.me.wallpaper})` : ''; }
function paintNotifBtn() { $('#notifBtn').textContent = 'Notifications: ' + (S.notif ? 'On' : 'Off'); }

/* ---------- messages ---------- */
const els = new Map(); let lastDay = '';
function callText(m) {
  const k = m.callKind === 'video' ? 'video' : 'voice', mine = m.from === S.me.id;
  if (m.result === 'missed') return mine ? `${cap(k)} call · No answer` : `Missed ${k} call`;
  if (m.result === 'rejected') return mine ? `${cap(k)} call · Declined` : `Declined ${k} call`;
  return `${cap(k)} call · ${fmtDur(m.secs || 0)}`;
}
const nearBottom = () => { const b = $('#stream'); return b.scrollHeight - b.scrollTop - b.clientHeight < 160; };
const toBottom = smooth => { const b = $('#stream'); b.scrollTo({ top: b.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
function appendMsg(m) {
  if (els.has(m.id)) return;
  const box = $('#stream'), day = new Date(m.at).toDateString();
  if (day !== lastDay) { lastDay = day; box.append(mk('div', 'chip', dayLabel(m.at))); }
  let el;
  if (m.kind === 'call') el = mk('div', 'chip', `${callText(m)} · ${fmtTime(m.at)}`);
  else {
    const mine = m.from === S.me.id;
    el = mk('div', 'bub ' + (mine ? 'out' : 'in'));
    if (m.kind === 'text') el.append(mk('div', 'txt', m.text));
    else if (m.kind === 'image') { const i = mk('img'); i.src = m.url; i.alt = ''; i.onclick = () => { $('#lbImg').src = m.url; $('#lightbox').hidden = false; }; i.onload = () => toBottom(false); el.append(i); }
    else if (m.kind === 'video') { const v = mk('video'); v.src = m.url; v.controls = true; v.playsInline = true; v.preload = 'metadata'; el.append(v); }
    else { const a = mk('audio'); a.src = m.url; a.controls = true; a.preload = 'metadata'; el.append(a); }
    const meta = mk('div', 'meta'); meta.append(mk('span', '', fmtTime(m.at)));
    if (mine) meta.append(mk('span', 'tick'));
    el.append(meta);
  }
  box.append(el); els.set(m.id, el);
  if (m.from === S.me.id && m.kind !== 'call') paintTick(m);
}
function paintTick(m) {
  const el = els.get(m.id), t = el && $('.tick', el); if (!t) return;
  t.textContent = m.delivered || m.seen ? '✓✓' : '✓'; t.classList.toggle('seen', !!m.seen);
}
function paintStream() {
  $('#stream').innerHTML = ''; els.clear(); lastDay = '';
  S.msgs.forEach(appendMsg); toBottom(false);
}
function onMessage(m) {
  if (S.msgs.some(x => x.id === m.id)) return;
  const stick = nearBottom() || m.from === S.me.id;
  S.msgs.push(m); appendMsg(m); if (stick) toBottom(true);
  if (m.from === S.peer.id && m.kind !== 'call') {
    markRead();
    const away = document.hidden || !document.hasFocus() || $$('.overlay:not([hidden])').length || !$('#callScreen').hidden;
    if (away) notify(S.peer.name, { text: m.text, image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message' }[m.kind]);
  }
}
function markRead() {
  if (document.hidden || !S.sock) return;
  if (S.msgs.some(m => m.to === S.me.id && !m.seen)) { S.msgs.forEach(m => { if (m.to === S.me.id) m.seen = true; }); S.sock.emit('read'); }
}
document.addEventListener('visibilitychange', markRead); window.addEventListener('focus', markRead);

/* ---------- composer ---------- */
const input = $('#msgInput'); let typingSent = false, typingIdle;
function syncComposer() { const has = input.value.trim().length > 0; $('#bSend').hidden = !has; $('#bMic').hidden = has; }
function setTypingOut(on) { if (typingSent !== on) { typingSent = on; S.sock.emit('typing', on); } }
function sendText() {
  const text = input.value.trim(); if (!text) return;
  S.sock.emit('send', { kind: 'text', text }); input.value = ''; syncComposer(); setTypingOut(false); $('#emoji').hidden = true;
}
input.oninput = () => { syncComposer(); setTypingOut(true); clearTimeout(typingIdle); typingIdle = setTimeout(() => setTypingOut(false), 2000); };
input.onkeydown = e => { if (e.key === 'Enter') sendText(); };
$('#bSend').onclick = sendText;

async function sendFile(file) {
  try { const r = await uploadFile(file); S.sock.emit('send', { kind: r.kind, url: r.url }); }
  catch (e) { toast('Upload failed', e.message); }
}
$('#bAttach').onclick = () => $('#fileMedia').click();
$('#fileMedia').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; for (const f of files) await sendFile(f); };

const EMOJI = {
  Smileys: '😀😃😄😁😆😅😂🤣🥲😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😜🤪🤨🧐🤓😎🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤯😳🥵🥶😱😨😰😥🤗🤔🤭🤫😶😐😑😬🙄😯😲🥱😴🤤😪😵🤐🤢🤧😷🤒🤕',
  Love: '❤️🧡💛💚💙💜🤎🖤🤍💔❣️💕💞💓💗💖💘💝💟💋💌💍🌹🌷🌸🌺🌻🌙⭐✨🔥',
  Hands: '👋🤚✋🖖👌🤌✌️🤞🤟🤘🤙👈👉👆👇👍👎✊👊👏🙌👐🤲🤝🙏💪👀🧠',
  Things: '🎉🎁🎂🍫🍕🍔🍟🍿☕🍉🍓🍎🏠✈️🚗📱💻📷🎧🎵🌈☀️❄️🕌📿'
};
Object.entries(EMOJI).forEach(([name, chars]) => {
  $('#emoji').append(mk('h5', '', name));
  const grid = mk('div');
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(chars)].forEach(({ segment }) => {
    const b = mk('button', '', segment); b.type = 'button';
    b.onclick = () => { input.value += segment; input.focus(); syncComposer(); };
    grid.append(b);
  });
  $('#emoji').append(grid);
});
$('#bEmoji').onclick = () => { $('#emoji').hidden = !$('#emoji').hidden; };

/* voice messages */
let rec = null, recChunks = [], recTimer, recStart = 0;
$('#bMic').onclick = async () => {
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Not supported', 'Voice recording needs localhost/HTTPS and a modern browser.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    rec = new MediaRecorder(stream, { mimeType: type }); recChunks = [];
    rec.ondataavailable = e => recChunks.push(e.data);
    rec.start(); recStart = Date.now();
    $('#recTime').textContent = '0:00'; $('#recBar').hidden = false;
    recTimer = setInterval(() => $('#recTime').textContent = fmtDur((Date.now() - recStart) / 1000), 400);
  } catch { toast('Microphone blocked', 'Allow microphone access in the browser to send voice messages.'); }
};
function stopRec(send) {
  if (!rec) return;
  clearInterval(recTimer); $('#recBar').hidden = true;
  const r = rec; rec = null;
  r.onstop = () => {
    r.stream.getTracks().forEach(t => t.stop());
    if (!send || Date.now() - recStart < 600) return;
    const mp4 = r.mimeType.includes('mp4'), type = mp4 ? 'audio/mp4' : 'audio/webm';
    sendFile(new File([new Blob(recChunks, { type })], 'voice.' + (mp4 ? 'm4a' : 'webm'), { type }));
  };
  r.stop();
}
$('#recCancel').onclick = () => stopRec(false); $('#recSend').onclick = () => stopRec(true);

/* ---------- settings / profile ---------- */
$$('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).hidden = true);
$('#lightbox').onclick = () => $('#lightbox').hidden = true;
$('#bMenu').onclick = () => { $('#nameInput').value = S.peer.name; $('#sheet').hidden = false; };
$('#avPick').onclick = () => $('#fileAvatar').click();
$('#fileAvatar').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const r = await uploadFile(f); if (r.kind !== 'image') throw new Error('Please choose an image'); const d = await postJson('/api/profile', { avatar: r.url }); S.me = d.me; paintMe(); toast('Profile picture updated'); }
  catch (er) { toast('Could not update', er.message); }
};
$('#nameSave').onclick = async () => {
  try { const d = await postJson('/api/profile', { contactName: $('#nameInput').value }); S.peer = d.peer; paintHeader(); $('#nameInput').value = S.peer.name; toast('Contact name saved', 'Only you will see this name.'); }
  catch (er) { toast('Could not save', er.message); }
};
$('#wallPick').onclick = () => $('#fileWall').click();
$('#fileWall').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const r = await uploadFile(f); if (r.kind !== 'image') throw new Error('Please choose an image'); const d = await postJson('/api/profile', { wallpaper: r.url }); S.me = d.me; paintWallpaper(); }
  catch (er) { toast('Could not update', er.message); }
};
$('#wallReset').onclick = async () => { const d = await postJson('/api/profile', { wallpaper: null }); S.me = d.me; paintWallpaper(); };
$('#notifBtn').onclick = async () => {
  S.notif = !S.notif; localStorage.setItem('pm_notif', S.notif ? 'on' : 'off'); paintNotifBtn();
  if (S.notif && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
};

/* ---------- status ---------- */
let stTab = 'peer';
$('#openStatus').onclick = () => { $('#sheet').hidden = true; $('#statusModal').hidden = false; refreshStatus(); };
$('#tabPeer').onclick = () => { stTab = 'peer'; paintStatus(); };
$('#tabMe').onclick = () => { stTab = 'me'; paintStatus(); };
async function refreshStatus() { S.statuses = await api('/api/statuses'); paintStatus(); }
function paintStatus() {
  $('#tabPeer').textContent = S.peer.name + "'s status";
  $('#tabPeer').classList.toggle('on', stTab === 'peer'); $('#tabMe').classList.toggle('on', stTab === 'me');
  $('#stCompose').hidden = stTab !== 'me';
  const uid = stTab === 'me' ? S.me.id : S.peer.id, list = $('#stList'); list.innerHTML = '';
  const items = S.statuses.filter(s => s.uid === uid && Date.now() - s.at < 864e5).reverse();
  if (!items.length) list.append(mk('p', 'muted', 'No status yet'));
  items.forEach(s => {
    const c = mk('div', 'card');
    if (s.type === 'text') c.append(mk('div', 'tx', s.text)); else { const i = mk('img'); i.src = s.url; i.alt = ''; c.append(i); }
    const left = Math.max(1, Math.ceil((864e5 - (Date.now() - s.at)) / 36e5));
    c.append(mk('small', '', `${dayLabel(s.at)}, ${fmtTime(s.at)} · expires in ~${left}h`)); list.append(c);
  });
}
$('#stPost').onclick = async () => {
  const text = $('#stText').value.trim(); if (!text) return;
  try { await postJson('/api/status', { type: 'text', text }); $('#stText').value = ''; refreshStatus(); } catch (e) { toast('Failed', e.message); }
};
$('#stPhoto').onclick = () => $('#fileStatus').click();
$('#fileStatus').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const r = await uploadFile(f); if (r.kind !== 'image') throw new Error('Please choose an image'); await postJson('/api/status', { type: 'image', url: r.url }); refreshStatus(); }
  catch (er) { toast('Failed', er.message); }
};

/* ---------- calls (WebRTC) ---------- */
const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let C = null, ringTimer = null; // C = { id, kind, dir:'out'|'in', phase:'ringing'|'connecting'|'connected', pc, local, queue, timer }
let audioCtx = null;
function unlockAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { }
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio));
document.addEventListener('click', () => {
  if (S.notif && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}, { once: true });
function ring(on) {
  clearInterval(ringTimer); if (!on) return;
  const beep = () => {
    try {
      unlockAudio(); const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 460; g.gain.value = 0.15; o.connect(g); g.connect(audioCtx.destination); o.start(); setTimeout(() => o.stop(), 380);
    } catch { }
  };
  beep(); ringTimer = setInterval(beep, 1600);
}
async function getMedia(kind) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Calls unavailable', 'Open the app on localhost or HTTPS.'); return null; }
  try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false }); }
  catch {
    if (kind === 'video') { try { const a = await navigator.mediaDevices.getUserMedia({ audio: true }); toast('Camera unavailable', 'Continuing with audio only.'); return a; } catch { } }
    toast('Permission needed', 'Allow microphone' + (kind === 'video' ? ' and camera' : '') + ' access for calls.'); return null;
  }
}
function paintCall() {
  const scr = $('#callScreen'); if (!C) { scr.hidden = true; return; }
  const peer = C.other, k = C.kind, ringing = C.phase === 'ringing', incoming = C.dir === 'in' && ringing;
  scr.hidden = false;
  scr.classList.toggle('vid', k === 'video'); scr.classList.toggle('live', C.phase === 'connected'); scr.classList.toggle('ring', ringing);
  $('#cAv').src = avatarOf(peer); $('#cName').textContent = peer.name;
  $('#cSelf').textContent = `Signed in as ${S.me.name}`;
  $('#cTitle').textContent = C.phase === 'connected' ? '' : incoming ? `Incoming ${k} call from ${peer.name}` : C.dir === 'out' && ringing ? `Calling ${peer.name}…` : 'Connecting…';
  if (C.phase !== 'connected') $('#cSub').textContent = '';
  $('#cAccept').hidden = !incoming; $('#cMute').hidden = incoming;
  $('#cCam').hidden = incoming || !(C.local && C.local.getVideoTracks().length);
  $('#cEnd small').textContent = incoming ? 'Reject' : ringing ? 'Cancel' : 'End';
  if (C.local) $('#localV').srcObject = C.local;
}
async function startCall(kind) {
  if (C) return;
  if (!S.sock.connected) return toast('Offline', 'Reconnecting… try again in a moment.');
  C = { id: null, kind, dir: 'out', phase: 'ringing', queue: [], other: { id: S.peer.id, name: S.peer.name, avatar: S.peer.avatar } }; paintCall();
  const local = await getMedia(kind);
  if (!C) { if (local) local.getTracks().forEach(t => t.stop()); return; }
  if (!local) return finishCall();
  C.local = local; paintCall(); ring(true); S.sock.emit('call:start', { kind });
}
$('#bVoice').onclick = () => startCall('voice'); $('#bVideo').onclick = () => startCall('video');
function onRinging(info) {
  if (!C || C.dir !== 'out' || C.id || info.callerId !== S.me.id) return;
  C.id = info.callId; C.other = info.callee; paintCall();
}
function onIncoming(info) {
  const callerId = info.callerId || info.from;
  if (!callerId || callerId === S.me.id || (info.calleeId && info.calleeId !== S.me.id)) return;
  const caller = info.caller || { id: callerId, name: S.peer.name, avatar: S.peer.avatar };
  if (C) { S.sock.emit('call:busy', { callId: info.callId }); return; }
  C = { id: info.callId, kind: info.kind, dir: 'in', phase: 'ringing', queue: [], other: caller };
  paintCall(); ring(true);
  document.title = `📞 Incoming call from ${caller.name}`;
  notify(`Incoming ${info.kind} call`, `from ${caller.name}`);
}
function makePC() {
  const pc = C.pc = new RTCPeerConnection(RTC_CFG);
  C.local.getTracks().forEach(t => pc.addTrack(t, C.local));
  pc.onicecandidate = e => { if (e.candidate && C) S.sock.emit('call:signal', { callId: C.id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => { const r = $('#remoteV'); r.srcObject = e.streams[0]; r.play().catch(() => { }); };
  pc.onconnectionstatechange = () => {
    if (!C || C.pc !== pc) return;
    if (pc.connectionState === 'connected' && C.phase !== 'connected') {
      C.phase = 'connected'; ring(false); const t0 = Date.now(); paintCall();
      C.timer = setInterval(() => { $('#cSub').textContent = fmtDur((Date.now() - t0) / 1000); }, 500); $('#cSub').textContent = '0:00';
    } else if (pc.connectionState === 'failed') { toast('Call failed', 'Connection lost.'); hangup(); }
  };
}
$('#cAccept').onclick = async () => {
  if (!C || C.dir !== 'in' || C.phase !== 'ringing') return;
  ring(false); const cur = C; C.phase = 'connecting'; paintCall();
  const local = await getMedia(cur.kind);
  if (C !== cur) { if (local) local.getTracks().forEach(t => t.stop()); return; }
  if (!local) { S.sock.emit('call:reject', { callId: cur.id }); return finishCall(); }
  C.local = local; makePC(); paintCall(); S.sock.emit('call:accept', { callId: C.id });
};
async function onAccepted({ callId }) {
  if (!C || C.id !== callId || !C.local) return;
  C.phase = 'connecting'; paintCall(); makePC();
  const offer = await C.pc.createOffer(); await C.pc.setLocalDescription(offer);
  S.sock.emit('call:signal', { callId, data: { sdp: C.pc.localDescription } });
}
async function onSignal({ callId, data }) {
  if (!C || C.id !== callId || !C.pc) return;
  const pc = C.pc;
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of C.queue) await pc.addIceCandidate(c); C.queue = [];
      if (data.sdp.type === 'offer') { const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); S.sock.emit('call:signal', { callId, data: { sdp: pc.localDescription } }); }
    } else if (data.candidate) { pc.remoteDescription ? await pc.addIceCandidate(data.candidate) : C.queue.push(data.candidate); }
  } catch (e) { console.error('signal error', e); }
}
function hangup() {
  if (!C) return;
  const id = C.id;
  if (C.phase === 'ringing') S.sock.emit(C.dir === 'out' ? 'call:cancel' : 'call:reject', { callId: id });
  else S.sock.emit('call:hangup', { callId: id });
  finishCall();
}
$('#cEnd').onclick = hangup;
function onCallEnd({ callId, reason }) {
  if (reason === 'handled') { if (C && C.id === callId && C.dir === 'in' && C.phase === 'ringing') finishCall(); return; }
  if (!C || (callId && C.id && C.id !== callId)) return;
  const kind = C.kind, dir = C.dir, who = C.other.name; finishCall();
  if (reason === 'missed' && dir === 'in') notify(`Missed ${kind} call`, `from ${who}`);
  else if (reason === 'rejected') toast('Call declined', `${who} declined your call.`);
  else if (reason === 'noanswer') toast('No answer', `${who} did not pick up.`);
  else if (reason === 'offline') toast('Not reachable', `${who} is offline right now.`);
  else if (reason === 'busy') toast('Busy', 'A call is already in progress.');
  else if (reason === 'ended') toast('Call ended');
}
function finishCall() {
  ring(false);
  if (C) {
    clearInterval(C.timer);
    if (C.local) C.local.getTracks().forEach(t => t.stop());
    if (C.pc) { C.pc.onconnectionstatechange = null; C.pc.close(); }
  }
  C = null; $('#remoteV').srcObject = null; $('#localV').srcObject = null;
  if (S.me) document.title = S.me.name + ' · Messenger';
  ['cMute', 'cCam'].forEach(id => { $('#' + id).classList.remove('off'); });
  $('#cMute small').textContent = 'Mute'; $('#cCam small').textContent = 'Camera off';
  paintCall();
}
$('#cMute').onclick = e => {
  const t = C && C.local && C.local.getAudioTracks()[0]; if (!t) return;
  t.enabled = !t.enabled; e.currentTarget.classList.toggle('off', !t.enabled); $('#cMute small').textContent = t.enabled ? 'Mute' : 'Unmute';
};
$('#cCam').onclick = e => {
  const t = C && C.local && C.local.getVideoTracks()[0]; if (!t) return;
  t.enabled = !t.enabled; e.currentTarget.classList.toggle('off', !t.enabled); $('#cCam small').textContent = t.enabled ? 'Camera off' : 'Camera on';
};

boot();
