import OBR from '@owlbear-rodeo/sdk';
import { LIB_KEY, ST_KEY, EM_KEY, CH_UNLOCK, curPos, spatialGain, fileKey, getFile, getLocal } from './shared.js';

const NS_MENU = 'com.sbx.audio/menu';
let lib = [], st = {}, items = [], dpi = 150, role = 'PLAYER', myId = '', selection = [];
let sceneReady = false, unsubItems = null;
const players = new Map();
let ctx = null;
const getCtx = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

// ================= Player แบบไฟล์/URL (ใช้ Web Audio -> เสียงซ้ายขวาได้) =================
class AudioPlayer {
  constructor(track) {
    this.track = track; this.missing = false; this.web = true; this.el = null;
    this.gain = null; this.panner = null; this.lastInit = 0;
    this.init();
  }
  async init() {
    this.lastInit = Date.now();
    let src;
    if (this.track.k === 'f') {
      const blob = await getFile(fileKey(this.track));
      if (!blob) { this.missing = true; return; }
      this.missing = false; src = URL.createObjectURL(blob);
    } else src = this.track.s;
    this.src = src; this.build(true);
  }
  build(useWeb) {
    if (this.el) { this.el.pause(); this.el.removeAttribute('src'); }
    const el = new Audio();
    el.preload = 'auto';
    this.web = useWeb;
    if (useWeb && this.track.k === 'u') el.crossOrigin = 'anonymous';
    el.src = this.src;
    if (useWeb) {
      const c = getCtx();
      this.node = c.createMediaElementSource(el);
      this.gain = c.createGain(); this.gain.gain.value = 0;
      this.panner = c.createStereoPanner();
      this.node.connect(this.gain).connect(this.panner).connect(c.destination);
    }
    el.addEventListener('error', () => {
      // เซิร์ฟเวอร์ไม่อนุญาต CORS -> เล่นแบบธรรมดา (ปรับเสียงได้ แต่แยกซ้ายขวาไม่ได้)
      if (this.web && this.track.k === 'u') this.build(false);
    });
    this.el = el;
  }
  get ready() { return !!this.el && !this.missing; }
  dur() { return this.el && isFinite(this.el.duration) ? this.el.duration : 0; }
  cur() { return this.el ? this.el.currentTime : 0; }
  playing() { return this.el && !this.el.paused; }
  seek(s) { try { this.el.currentTime = s; } catch (e) {} }
  loop(l) { if (this.el) this.el.loop = !!l; }
  play() { if (this.el) this.el.play().catch(() => {}); }
  pause() { if (this.el && !this.el.paused) this.el.pause(); }
  level(g, pan) {
    if (!this.el) return;
    if (this.web) {
      const t = getCtx().currentTime;
      this.gain.gain.setTargetAtTime(g, t, 0.025);
      this.panner.pan.setTargetAtTime(pan, t, 0.025);
    } else this.el.volume = Math.max(0, Math.min(1, g));
  }
  destroy() { this.pause(); if (this.el) this.el.removeAttribute('src'); }
}

// ================= Player แบบ YouTube (ปรับเสียงได้ แต่แยกซ้ายขวาไม่ได้) =================
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return ytReady;
}
class YtPlayer {
  constructor(track) {
    this.track = track; this.ok = false; this.fails = 0; this.pending = false;
    this.div = document.createElement('div');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px;opacity:0.01;pointer-events:none;';
    host.appendChild(this.div); document.body.appendChild(host); this.host = host;
    loadYT().then(() => {
      this.p = new YT.Player(this.div, {
        width: 200, height: 200, videoId: track.s,
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: { onReady: () => { this.ok = true; } },
      });
    });
  }
  get ready() { return this.ok; }
  dur() { return this.ok ? this.p.getDuration() || 0 : 0; }
  cur() { return this.ok ? this.p.getCurrentTime() : 0; }
  state() { return this.ok ? this.p.getPlayerState() : -1; }
  playing() { const s = this.state(); return s === 1 || s === 3; }
  seek(s) { if (this.ok) this.p.seekTo(s, true); }
  loop() {}
  play() { if (this.ok) this.p.playVideo(); }
  pause() { if (this.ok && this.state() === 1) this.p.pauseVideo(); }
  level(g) { if (this.ok) this.p.setVolume(Math.round(Math.max(0, Math.min(1, g)) * 100)); }
  destroy() { try { this.p && this.p.destroy(); } catch (e) {} this.host.remove(); }
}

// ================= หา "ผู้ฟัง" และคำนวณระดับเสียงต่อ track =================
function listeners() {
  const chars = items.filter((i) => i.layer === 'CHARACTER');
  if (role === 'GM') {
    const sel = chars.filter((i) => selection.includes(i.id));
    return sel;               // GM ฟังจาก token ที่เลือกอยู่ (ถ้าไม่เลือก = ได้ยินเต็ม)
  }
  return chars.filter((i) => i.createdUserId === myId);
}
function levelFor(track, ls) {
  const ems = items.filter((i) => i.metadata && i.metadata[EM_KEY] && i.metadata[EM_KEY].tid === track.i);
  if (!ems.length) return { g: 1, pan: 0, spatial: false };
  if (!ls.length) return { g: role === 'GM' ? 1 : 0, pan: 0, spatial: true };
  let best = { g: 0, pan: 0 };
  for (const e of ems) for (const l of ls) {
    const r = spatialGain(e.position, l.position, dpi, e.metadata[EM_KEY].r || 8);
    if (r.g >= best.g) best = r;
  }
  return { g: best.g, pan: best.pan, spatial: true };
}

// ================= ลูปหลัก: ทำให้เสียงตรงกับสถานะที่ sync กันไว้ =================
let tickN = 0, blocked = false;
function tick() {
  tickN++;
  const c = getCtx();
  if (c.state !== 'running') { c.resume().catch(() => {}); }
  blocked = c.state !== 'running';

  const local = getLocal();
  const master = local.master ?? 0.8;
  const ls = listeners();
  const ids = new Set(lib.map((t) => t.i));
  for (const [id, p] of players) if (!ids.has(id)) { p.destroy(); players.delete(id); }

  const status = { blocked, hasListener: ls.length > 0, role, pos: {}, dur: {}, missing: [], spatial: {}, ts: Date.now() };
  for (const t of lib) {
    const s = st[t.i] || {};
    let p = players.get(t.i);
    if (!p && s.p) { p = t.k === 'y' ? new YtPlayer(t) : new AudioPlayer(t); players.set(t.i, p); }
    if (!p) continue;
    if (p instanceof AudioPlayer && p.missing) {
      status.missing.push(t.i);
      if (Date.now() - p.lastInit > 3000) p.init();
      continue;
    }
    if (!p.ready) continue;

    const dur = p.dur();
    const pos = curPos(s, dur);
    status.pos[t.i] = s.p ? pos : s.o || 0; status.dur[t.i] = dur;
    p.loop(s.l);
    const finished = !s.l && dur && pos >= dur;
    if (s.p && !finished) {
      if (!p.playing()) { p.seek(pos); p.play(); }
      else if (tickN % 12 === 0 && Math.abs(p.cur() - pos) > 1.2) p.seek(pos); // แก้ drift
      if (p instanceof YtPlayer && !p.playing() && ++p.fails > 8) blocked = true;
    } else { p.pause(); }

    const lv = levelFor(t, ls);
    status.spatial[t.i] = lv.spatial;
    const mine = (local.t && local.t[t.i]) || {};
    const personal = mine.m ? 0 : (mine.v ?? 1);
    p.level((s.v ?? 0.8) * lv.g * master * personal, lv.pan);
  }
  status.blocked = blocked;
  if (tickN % 2 === 0) localStorage.setItem('sbx.status', JSON.stringify(status));
}

// ================= เริ่มต้น =================
function applyRoom(md) {
  lib = md[LIB_KEY] || [];
  st = md[ST_KEY] || {};
  for (const [id, p] of players) {          // แหล่งเสียงเปลี่ยน -> สร้างใหม่
    const t = lib.find((x) => x.i === id);
    if (t && t.s !== p.track.s) { p.destroy(); players.delete(id); }
  }
}
async function loadScene() {
  items = await OBR.scene.items.getItems();
  dpi = await OBR.scene.grid.getDpi();
}
// อัปเดตเฉพาะระดับเสียงและซ้าย-ขวาทันทีเมื่อ token เปลี่ยน โดยไม่รอลูปหลัก
function updateLevels() {
  const local = getLocal(), master = local.master ?? 0.8, ls = listeners();
  for (const t of lib) {
    const s = st[t.i] || {}, p = players.get(t.i);
    if (!p || !p.ready || !s.p) continue;
    const lv = levelFor(t, ls), mine = (local.t && local.t[t.i]) || {};
    p.level((s.v ?? 0.8) * lv.g * master * (mine.m ? 0 : (mine.v ?? 1)), lv.pan);
  }
}

// วงรัศมีเสียง: เป็น local item จึงเห็นเฉพาะ GM เครื่องนี้
const RING_PREFIX = 'com.sbx.audio/ring/';
const ringMap = new Map();
let ringBusy = false, ringAgain = false;
function makeRing(item, id, radius, style) {
  const now = new Date().toISOString(), size = radius * 2 * dpi;
  return {
    id, type: 'SHAPE', name: 'Sound radius', visible: true, locked: true, createdUserId: myId, zIndex: Date.now(),
    lastModified: now, lastModifiedUserId: myId, position: { x: item.position.x, y: item.position.y }, rotation: 0,
    scale: { x: 1, y: 1 }, metadata: {}, layer: 'DRAWING', attachedTo: item.id, disableHit: true,
    disableAttachmentBehavior: ['SCALE', 'ROTATION', 'LOCKED', 'COPY'], width: size, height: size, shapeType: 'CIRCLE', style,
  };
}
async function clearRings() {
  ringMap.clear();
  try {
    const ids = (await OBR.scene.local.getItems()).filter((i) => i.id.startsWith(RING_PREFIX)).map((i) => i.id);
    if (ids.length) await OBR.scene.local.deleteItems(ids);
  } catch (e) { console.warn(e); }
}
async function syncRings() {
  if (ringBusy) { ringAgain = true; return; }
  ringBusy = true;
  try {
    do {
      ringAgain = false;
      if (!sceneReady) break;
      const want = new Map();
      if (role === 'GM') for (const i of items) { const m = i.metadata && i.metadata[EM_KEY]; if (m) want.set(i.id, { item: i, r: m.r || 8 }); }
      const del = [], add = [];
      for (const [id, k] of ringMap) { const w = want.get(id); if (!w || w.r !== k.r || k.d !== dpi) { del.push(...k.ids); ringMap.delete(id); } }
      for (const [id, w] of want) {
        if (ringMap.has(id)) continue;
        const outer = RING_PREFIX + id + '/outer', inner = RING_PREFIX + id + '/inner';
        add.push(
          makeRing(w.item, outer, w.r, { fillColor: '#17aef5', fillOpacity: 0.07, strokeColor: '#17aef5', strokeOpacity: 0.9, strokeWidth: 5, strokeDash: [24, 14] }),
          makeRing(w.item, inner, Math.min(1.5, w.r * 0.15), { fillColor: '#ffd83d', fillOpacity: 0.1, strokeColor: '#ffd83d', strokeOpacity: 0.9, strokeWidth: 3, strokeDash: [] }),
        );
        ringMap.set(id, { r: w.r, d: dpi, ids: [outer, inner] });
      }
      if (del.length) await OBR.scene.local.deleteItems(del);
      if (add.length) await OBR.scene.local.addItems(add);
    } while (ringAgain);
  } catch (e) { console.warn(e); } finally { ringBusy = false; }
}

var MOVE_CHANNEL = "com.sbx.audio/pos", MOVE_TOOL = "com.sbx.audio/move", moveDrag = null, moveLast = 0;
function moveApply(id, p) { let i = items.find((x) => x.id === id); if (i) { i.position = { x: p.x, y: p.y }; updateLevels(); } }
function moveRings(id, p) { OBR.scene.local.updateItems((i) => i.id.startsWith(RING_PREFIX + id + "/"), (l) => { for (let r of l) r.position = { x: p.x, y: p.y }; }).catch(() => {}); }
function moveSend(id, p) { OBR.broadcast.sendMessage(MOVE_CHANNEL, { id, p }, { destination: "REMOTE" }).catch(() => {}); }
function moveInit() {
  OBR.broadcast.onMessage(MOVE_CHANNEL, (e) => { let d = e.data; if (d && d.id && d.p) moveApply(d.id, d.p); });
  OBR.tool.createMode({
    id: MOVE_TOOL,
    icons: [{ icon: new URL("move.svg", location.href).href, label: "ลากพร้อมเสียง", filter: { activeTools: ["rodeo.owlbear.tool/move"], roles: ["GM"] } }],
    onToolDragStart: async (c, e) => {
      let t = e.target;
      if (role !== "GM" || !t || t.locked || !["CHARACTER", "PROP", "MOUNT"].includes(t.layer)) return;
      let d = { id: t.id, start: { x: t.position.x, y: t.position.y }, p: t.position, off: { x: t.position.x - e.pointerPosition.x, y: t.position.y - e.pointerPosition.y }, update: null, stop: null, done: false };
      moveDrag = d;
      if (t.layer === "CHARACTER" && !(t.metadata && t.metadata[EM_KEY])) OBR.player.select([t.id]).catch(() => {});
      try { let [u, st] = await OBR.interaction.startItemInteraction(t); if (d.done) st(); else { d.update = u; d.stop = st; } } catch (x) { console.warn(x); }
    },
    onToolDragMove: (c, e) => {
      let d = moveDrag; if (!d) return;
      let p = { x: e.pointerPosition.x + d.off.x, y: e.pointerPosition.y + d.off.y };
      d.p = p;
      if (d.update) d.update((x) => { x.position = p; });
      moveApply(d.id, p);
      let n = Date.now();
      if (n - moveLast >= 100) { moveLast = n; moveSend(d.id, p); moveRings(d.id, p); }
    },
    onToolDragEnd: async () => {
      let d = moveDrag; if (!d) return;
      moveDrag = null; d.done = true;
      let p = d.p;
      try { p = await OBR.scene.grid.snapPosition(d.p); } catch (x) {}
      moveApply(d.id, p); moveSend(d.id, p); moveRings(d.id, p);
      try { await OBR.scene.items.updateItems([d.id], (l) => { for (let i of l) i.position = p; }); } catch (x) { console.warn(x); }
      if (d.stop) d.stop();
    },
    onToolDragCancel: () => {
      let d = moveDrag; if (!d) return;
      moveDrag = null; d.done = true;
      moveApply(d.id, d.start); moveSend(d.id, d.start); moveRings(d.id, d.start);
      if (d.stop) d.stop();
    },
  });
}

OBR.onReady(async () => {
  myId = OBR.player.id;
  role = await OBR.player.getRole();
  selection = (await OBR.player.getSelection()) || [];
  OBR.player.onChange((p) => { role = p.role; selection = p.selection || []; updateLevels(); syncRings(); });
  applyRoom(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(applyRoom);

  const onScene = async (ready) => {
    sceneReady = ready;
    if (unsubItems) { unsubItems(); unsubItems = null; }
    if (ready) { await loadScene(); await clearRings(); syncRings(); updateLevels(); unsubItems = OBR.scene.items.onChange((i) => { items = i; updateLevels(); syncRings(); }); }
    else { items = []; ringMap.clear(); }
  };
  OBR.scene.onReadyChange(onScene);
  onScene(await OBR.scene.isReady());

  OBR.broadcast.onMessage(CH_UNLOCK, () => { getCtx().resume().catch(() => {}); tick(); });
  setInterval(tick, 250);
  moveInit();

  // เมนูคลิกขวาบนของ/token (GM) -> ผูกเสียง
  OBR.contextMenu.create({
    id: NS_MENU,
    icons: [{
      icon: new URL('icon.svg', location.href).href,
      label: 'ผูกเสียงกับของชิ้นนี้',
      filter: { min: 1, roles: ['GM'] },
    }],
    onClick: () => OBR.popover.open({
      id: NS_MENU + '/pop', url: new URL('emitter.html', location.href).href, width: 340, height: 330,
    }),
  });
});
