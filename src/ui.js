import OBR from '@owlbear-rodeo/sdk';
import { LIB_KEY, ST_KEY, EM_KEY, CH_UNLOCK, ytId, curPos, getLocal, setLocal, getStatus, fileKey, putFile, hasFile } from './shared.js';

const $ = (id) => document.getElementById(id);
let lib = [], st = {}, role = 'PLAYER', emCount = {}, built = '';
const uid = () => Math.random().toString(36).slice(2, 7);
const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const isGM = () => role === 'GM';

// ---------- เขียนสถานะที่ sync กับทุกคน (GM เท่านั้น) ----------
async function patchState(id, patch) {
  const md = await OBR.room.getMetadata();
  const cur = { ...(md[ST_KEY] || {}) };
  cur[id] = { p: 0, t: 0, o: 0, v: 0.8, l: 0, ...(cur[id] || {}), ...patch };
  await OBR.room.setMetadata({ [ST_KEY]: cur });
}
async function saveLib(newLib) {
  const size = JSON.stringify(newLib).length + JSON.stringify(st).length;
  if (size > 14000) { OBR.notification.show('รายการเสียงเต็มแล้ว (ข้อจำกัด metadata 16KB) ลบบางรายการก่อน', 'WARNING'); return false; }
  await OBR.room.setMetadata({ [LIB_KEY]: newLib });
  return true;
}
const curPosNow = (id) => {
  const s = st[id] || {}, status = getStatus();
  return curPos(s, (status.dur || {})[id]);
};
const play = (id) => { const s = st[id] || {}; return patchState(id, { p: 1, t: Date.now() - (s.o || 0) * 1000 }); };
const pause = (id) => patchState(id, { p: 0, o: curPosNow(id) });
const stop = (id) => patchState(id, { p: 0, o: 0 });
const seek = (id, sec) => ((st[id] || {}).p ? patchState(id, { t: Date.now() - sec * 1000 }) : patchState(id, { o: sec }));

// ---------- วาดรายการเสียง ----------
function build() {
  const sig = JSON.stringify(lib) + role;
  if (sig === built) return;
  built = sig;
  const box = $('list');
  box.innerHTML = '';
  if (!lib.length) { box.innerHTML = '<div class="empty">ยังไม่มีเสียง' + (isGM() ? ' — เพิ่มด้านบนได้เลย' : ' — รอ GM เพิ่มเสียง') + '</div>'; return; }
  for (const t of lib) {
    const d = document.createElement('div');
    d.className = 'track'; d.dataset.id = t.i;
    const icon = t.k === 'y' ? '▶️' : t.k === 'f' ? '📁' : '🔗';
    d.innerHTML = `
      <div class="top"><span>${icon}</span><span class="name"></span><span class="badge sp hidden">📍 อิงระยะ</span>
        <span class="badge miss hidden">⚠ ไม่มีไฟล์</span>
        ${isGM() ? `<button class="ghost bPlay">▶</button><button class="ghost bStop">⏹</button><button class="ghost bLoop">🔁</button><button class="ghost bDel">🗑</button>` : ''}</div>
      <div class="sub missRow hidden"><span style="grid-column:1/4">ต้องนำเข้าไฟล์ชื่อเดียวกัน: <label class="btn">เลือกไฟล์<input type="file" accept="audio/*" class="fMiss" hidden></label></span></div>
      ${isGM() ? `<div class="sub"><span>เวลา</span><input type="range" class="seek" min="0" max="1" step="1"><span class="time">0:00</span></div>
      <div class="sub"><span>ระดับเสียง (ทุกคน)</span><input type="range" class="gv" min="0" max="1" step="0.01"><span></span></div>` : ''}
      <div class="sub"><span>เสียงของฉัน</span><input type="range" class="pv" min="0" max="1" step="0.01"><button class="ghost bMute">🔈</button></div>`;
    d.querySelector('.name').textContent = t.n;
    d.querySelector('.name').title = t.n;
    const q = (c) => d.querySelector(c);
    if (isGM()) {
      q('.bPlay').onclick = () => ((st[t.i] || {}).p ? pause(t.i) : play(t.i));
      q('.bStop').onclick = () => stop(t.i);
      q('.bLoop').onclick = () => patchState(t.i, { l: (st[t.i] || {}).l ? 0 : 1 });
      q('.bDel').onclick = async () => { await saveLib(lib.filter((x) => x.i !== t.i)); await stop(t.i); };
      q('.gv').oninput = (e) => patchState(t.i, { v: +e.target.value });
      q('.seek').onchange = (e) => seek(t.i, +e.target.value);
    }
    q('.pv').oninput = (e) => { const l = getLocal(); l.t = l.t || {}; l.t[t.i] = { ...(l.t[t.i] || {}), v: +e.target.value }; setLocal(l); };
    q('.bMute').onclick = () => { const l = getLocal(); l.t = l.t || {}; const c = l.t[t.i] || {}; l.t[t.i] = { ...c, m: c.m ? 0 : 1 }; setLocal(l); refresh(); };
    q('.fMiss').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.name !== t.s || f.size !== t.z) { OBR.notification.show(`ไฟล์ไม่ตรง ต้องเป็น "${t.s}" ขนาด ${t.z} bytes`, 'ERROR'); return; }
      await putFile(fileKey(t), f); OBR.notification.show('นำเข้าแล้ว ✓');
    };
    box.appendChild(d);
  }
}
const active = (el) => document.activeElement === el;
function refresh() {
  const status = getStatus(), local = getLocal();
  $('unlock').classList.toggle('hidden', !status.blocked);
  $('notoken').classList.toggle('hidden', !(role !== 'GM' && Object.values(status.spatial || {}).some(Boolean) && !status.hasListener));
  if (!active($('master'))) $('master').value = local.master ?? 0.8;
  document.querySelectorAll('.gmOnly,#gmAdd').forEach((e) => e.classList.toggle('hidden', !isGM()));
  for (const d of document.querySelectorAll('.track')) {
    const id = d.dataset.id, s = st[id] || {}, q = (c) => d.querySelector(c);
    const mine = (local.t && local.t[id]) || {};
    if (!active(q('.pv'))) q('.pv').value = mine.v ?? 1;
    q('.bMute').textContent = mine.m ? '🔇' : '🔈';
    q('.sp').classList.toggle('hidden', !(emCount[id] > 0));
    const miss = (status.missing || []).includes(id);
    q('.miss').classList.toggle('hidden', !miss); q('.missRow').classList.toggle('hidden', !miss);
    if (isGM()) {
      q('.bPlay').textContent = s.p ? '⏸' : '▶'; q('.bPlay').classList.toggle('on', !!s.p);
      q('.bLoop').classList.toggle('on', !!s.l);
      if (!active(q('.gv'))) q('.gv').value = s.v ?? 0.8;
      const dur = (status.dur || {})[id] || 0, pos = curPosNow(id);
      const sk = q('.seek'); sk.max = Math.max(1, Math.floor(dur));
      if (!active(sk)) sk.value = Math.floor(pos);
      q('.time').textContent = fmt(pos) + (dur ? '/' + fmt(dur) : '');
    }
  }
  const total = JSON.stringify(lib).length + JSON.stringify(st).length;
  $('sizeInfo').textContent = `พื้นที่รายการ: ${(total / 1024).toFixed(1)} / 16 KB`;
}

// ---------- เพิ่มเสียง ----------
async function addUrl() {
  const u = $('urlIn').value.trim(); if (!u) return;
  const id = ytId(u);
  const name = $('nameIn').value.trim();
  const t = id ? { i: uid(), n: name || 'YouTube ' + id, k: 'y', s: id } : { i: uid(), n: name || decodeURIComponent(u.split('/').pop().split('?')[0]) || 'เสียง', k: 'u', s: u };
  if (!id && !/^https?:\/\//.test(u)) { OBR.notification.show('ลิงก์ไม่ถูกต้อง', 'ERROR'); return; }
  if (await saveLib([...lib, t])) { $('urlIn').value = ''; $('nameIn').value = ''; }
}
$('addUrl').onclick = addUrl;
$('urlIn').onkeydown = (e) => e.key === 'Enter' && addUrl();
$('fileIn').onchange = async (e) => {
  const add = [];
  for (const f of e.target.files) {
    const t = { i: uid(), n: f.name.replace(/\.[^.]+$/, ''), k: 'f', s: f.name, z: f.size };
    await putFile(fileKey(t), f); add.push(t);
  }
  e.target.value = '';
  if (add.length) await saveLib([...lib, ...add]);
};
$('stopAll').onclick = async () => {
  const md = await OBR.room.getMetadata(); const cur = { ...(md[ST_KEY] || {}) };
  for (const k in cur) cur[k] = { ...cur[k], p: 0, o: 0 };
  await OBR.room.setMetadata({ [ST_KEY]: cur });
};
$('master').oninput = (e) => { const l = getLocal(); l.master = +e.target.value; setLocal(l); };
$('unlockBtn').onclick = () => OBR.broadcast.sendMessage(CH_UNLOCK, {}, { destination: 'LOCAL' });
document.addEventListener('pointerdown', () => OBR.broadcast.sendMessage(CH_UNLOCK, {}, { destination: 'LOCAL' }).catch(() => {}), { once: true });

// ---------- เริ่มต้น ----------
async function countEmitters() {
  try {
    if (!(await OBR.scene.isReady())) { emCount = {}; return; }
    const its = await OBR.scene.items.getItems((i) => i.metadata && i.metadata[EM_KEY]);
    emCount = {}; for (const i of its) { const k = i.metadata[EM_KEY].tid; emCount[k] = (emCount[k] || 0) + 1; }
  } catch (e) {}
}
OBR.onReady(async () => {
  role = await OBR.player.getRole();
  OBR.player.onChange((p) => { role = p.role; build(); refresh(); });
  const apply = (md) => { lib = md[LIB_KEY] || []; st = md[ST_KEY] || {}; build(); refresh(); };
  apply(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(apply);
  let unsub = null;
  const onScene = async (ready) => {
    if (unsub) { unsub(); unsub = null; }
    await countEmitters();
    if (ready) unsub = OBR.scene.items.onChange(async () => { await countEmitters(); refresh(); });
  };
  OBR.scene.onReadyChange(onScene);
  onScene(await OBR.scene.isReady());
  setInterval(refresh, 500);
});
