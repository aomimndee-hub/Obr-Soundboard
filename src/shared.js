// ค่าคงที่และฟังก์ชันที่ใช้ร่วมกัน
export const NS = 'com.sbx.audio';
export const LIB_KEY = NS + '/lib'; // room metadata: รายการเสียงทั้งหมด
export const ST_KEY = NS + '/st';   // room metadata: สถานะการเล่นแต่ละเสียง
export const EM_KEY = NS + '/emitter'; // item metadata: แหล่งกำเนิดเสียงบนของ/token
export const CH_UNLOCK = NS + '/unlock';

// ---------- YouTube ----------
export function ytId(u) {
  try {
    const x = new URL(u.trim());
    if (x.hostname.includes('youtu.be')) return x.pathname.slice(1, 12);
    if (x.hostname.includes('youtube.com')) {
      if (x.searchParams.get('v')) return x.searchParams.get('v').slice(0, 11);
      const m = x.pathname.match(/\/(embed|shorts|live)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch (e) {}
  return null;
}

// ---------- ตำแหน่งเวลาที่ทุกคนต้องอยู่ตรงกัน ----------
// s = {p:เล่นอยู่?, t:เวลา(ms) ที่ตำแหน่ง 0 ควรเริ่ม, o:ตำแหน่งตอนหยุด(วินาที), v:ระดับเสียง, l:วนซ้ำ}
export function curPos(s, dur, now = Date.now()) {
  if (!s) return 0;
  let pos = s.p ? Math.max(0, (now - s.t) / 1000) : s.o || 0;
  if (dur && isFinite(dur) && dur > 0 && s.l) pos = pos % dur;
  return pos;
}

// ---------- เสียงตามระยะ (หน่วยเป็นช่องกริด) ----------
export function spatialGain(ePos, lPos, dpi, radius) {
  const dx = (ePos.x - lPos.x) / dpi;
  const dy = (ePos.y - lPos.y) / dpi;
  const d = Math.hypot(dx, dy);
  const inner = Math.min(1.5, radius * 0.15);
  const t = Math.min(1, Math.max(0, 1 - (d - inner) / Math.max(0.01, radius - inner)));
  const g = t * t;
  // ซ้าย/ขวา: emitter อยู่ขวาของ token -> pan +; ใกล้มากๆ ค่อยๆ กลับมากลาง
  const pan = Math.max(-1, Math.min(1, dx / (radius * 0.5))) * Math.min(1, d / 2);
  return { g, pan, d };
}

// ---------- ค่าตั้งส่วนตัว (เก็บในเครื่องผู้เล่นแต่ละคน) ----------
export const getLocal = () => {
  try { return JSON.parse(localStorage.getItem('sbx.local') || '{}'); } catch (e) { return {}; }
};
export const setLocal = (o) => localStorage.setItem('sbx.local', JSON.stringify(o));
export const getStatus = () => {
  try { return JSON.parse(localStorage.getItem('sbx.status') || '{}'); } catch (e) { return {}; }
};

// ---------- ไฟล์เสียงที่นำเข้า (IndexedDB ในเครื่อง) ----------
export const fileKey = (t) => t.s + '|' + t.z;
let dbp;
export function openDb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('sbx', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function putFile(key, blob) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function getFile(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction('files').objectStore('files').get(key);
    r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
  });
}
export async function hasFile(key) { return !!(await getFile(key)); }
