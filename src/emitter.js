import OBR from '@owlbear-rodeo/sdk';
import { LIB_KEY, EM_KEY } from './shared.js';
const $ = (id) => document.getElementById(id);
OBR.onReady(async () => {
  const sel = (await OBR.player.getSelection()) || [];
  $('cnt').textContent = sel.length;
  const lib = (await OBR.room.getMetadata())[LIB_KEY] || [];
  $('track').innerHTML = lib.map((t) => `<option value="${t.i}"></option>`).join('');
  [...$('track').options].forEach((o, i) => (o.textContent = lib[i].n));
  const items = await OBR.scene.items.getItems(sel);
  const ex = items.map((i) => i.metadata[EM_KEY]).find(Boolean);
  if (ex) { $('track').value = ex.tid; $('radius').value = ex.r; }
  $('rv').textContent = $('radius').value;
  $('radius').oninput = () => ($('rv').textContent = $('radius').value);
  $('apply').onclick = async () => {
    if (!$('track').value) return OBR.notification.show('ยังไม่มีเสียงในรายการ', 'WARNING');
    await OBR.scene.items.updateItems(sel, (its) => its.forEach((i) => { i.metadata[EM_KEY] = { tid: $('track').value, r: +$('radius').value }; }));
    OBR.popover.close('com.sbx.audio/menu/pop');
  };
  $('remove').onclick = async () => {
    await OBR.scene.items.updateItems(sel, (its) => its.forEach((i) => { delete i.metadata[EM_KEY]; }));
    OBR.popover.close('com.sbx.audio/menu/pop');
  };
});
