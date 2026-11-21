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
      this.gain.gain.setTargetAtTime(g, t, 0.08);
      this.panner.pan.setTargetAtTime(pan, t, 0.08);
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
OBR.onReady(async () => {
  myId = OBR.player.id;
  role = await OBR.player.getRole();
  selection = (await OBR.player.getSelection()) || [];
  OBR.player.onChange((p) => { role = p.role; selection = p.selection || []; });
  applyRoom(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(applyRoom);

  const onScene = async (ready) => {
    sceneReady = ready;
    if (unsubItems) { unsubItems(); unsubItems = null; }
    if (ready) { await loadScene(); unsubItems = OBR.scene.items.onChange((i) => { items = i; }); }
    else items = [];
  };
  OBR.scene.onReadyChange(onScene);
  onScene(await OBR.scene.isReady());

  OBR.broadcast.onMessage(CH_UNLOCK, () => { getCtx().resume().catch(() => {}); tick(); });
  setInterval(tick, 250);

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
