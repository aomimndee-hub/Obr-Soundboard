// ตกแต่งหน้าตาเท่านั้น: เติมสีแถบเลื่อน, ป้ายชนิดเสียง และสถานะปุ่มปิดเสียง
(function () {
  const KINDS = { '▶️': 'YT', '📁': 'FILE', '🔗': 'URL' };
  function sync() {
    document.querySelectorAll('input[type=range]').forEach((r) => {
      const min = +r.min || 0, max = +r.max || 100;
      const p = max > min ? ((+r.value - min) / (max - min)) * 100 : 0;
      r.style.setProperty('--p', p + '%');
    });
    document.querySelectorAll('.track .top > span:first-child:not(.kind)').forEach((s) => {
      const label = KINDS[s.textContent.trim()];
      if (label) { s.textContent = label; s.classList.add('kind'); }
    });
    document.querySelectorAll('.bMute').forEach((b) => {
      b.classList.toggle('is-muted', b.textContent.includes('🔇'));
    });
  }
  document.addEventListener('input', sync, true);
  setInterval(sync, 200);
  sync();
})();
