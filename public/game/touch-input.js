'use strict';
// Touch owns its own input, so releasing a thumb never releases a physical keyboard key.
(() => {
  const frame = document.querySelector('.world-frame'), stick = document.getElementById('touchJoystick');
  const run = document.getElementById('touchRun'), jump = document.getElementById('touchJump');
  const input = { x: 0, z: 0, run: false }, jumpPointers = new Set();
  let pointer = null, pendingJump = false;
  if (navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches) { frame.classList.add('has-touch'); document.body.classList.add('touch-layout'); }
  const paint = () => {
    stick.style.setProperty('--stick-x', `${input.x * 30}px`); stick.style.setProperty('--stick-y', `${input.z * 30}px`);
    stick.classList.toggle('held', pointer !== null);
  };
  const move = e => {
    const r = stick.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dz = e.clientY - r.top - r.height / 2;
    const distance = Math.hypot(dx, dz), strength = Math.min(1, Math.max(0, (distance - 6) / (r.width * .32 - 6)));
    input.x = distance ? dx / distance * strength : 0; input.z = distance ? dz / distance * strength : 0;
    if (strength) travel = null;
    paint();
  };
  stick.addEventListener('pointerdown', e => {
    if (pointer !== null || e.button !== 0) return;
    e.preventDefault(); pointer = e.pointerId; stick.setPointerCapture(pointer); move(e);
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === pointer) { e.preventDefault(); move(e); } });
  const release = e => { if (e.pointerId !== pointer) return; pointer = null; input.x = input.z = 0; paint(); save(); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, release);
  // A keyboard user can focus the stick and still use the usual movement keys.
  stick.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); travel = null; }
  });
  stick.addEventListener('blur', () => keys.clear());
  const toggleRun = () => { input.run = !input.run; run.setAttribute('aria-pressed', String(input.run)); };
  run.addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); toggleRun(); } });
  run.addEventListener('click', e => { if (e.detail === 0) toggleRun(); });
  jump.addEventListener('pointerdown', e => {
    if (jump.disabled || e.button !== 0) return;
    e.preventDefault(); jumpPointers.add(e.pointerId); pendingJump = true; jump.setPointerCapture(e.pointerId); travel = null;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) jump.addEventListener(type, e => {
    const held = jumpPointers.delete(e.pointerId);
    if (held && type !== 'pointerup') pendingJump = false;
  });
  jump.addEventListener('click', e => { if (e.detail === 0) { pendingJump = true; travel = null; } });
  function reset() {
    const old = pointer; pointer = null; input.x = input.z = 0; pendingJump = false; jumpPointers.clear();
    if (input.run) { input.run = false; run.setAttribute('aria-pressed', 'false'); }
    if (old !== null && stick.hasPointerCapture(old)) stick.releasePointerCapture(old);
    paint();
  }
  const menuObserver = new MutationObserver(() => { if (document.querySelector('#modal').open || document.querySelector('#worldScreen').hidden || frame.classList.contains('talking') || frame.classList.contains('voyaging')) reset(); });
  menuObserver.observe(document.querySelector('#modal'), { attributes: true, attributeFilter: ['open'] });
  menuObserver.observe(document.querySelector('#worldScreen'), { attributes: true, attributeFilter: ['hidden'] });
  menuObserver.observe(frame, { attributes: true, attributeFilter: ['class'] });
  window.MovementInput = { get x() { return input.x; }, get z() { return input.z; }, get run() { return input.run; },
    takeJump() { const value = pendingJump || jumpPointers.size > 0; pendingJump = false; return value; },
    enableJump() { jump.disabled = false; }, reset };
  window.addEventListener('blur', reset); window.addEventListener('pagehide', reset);
  // Only a real change of layout (rotating the phone) lets go of the stick. A phone's address bar sliding away
  // changes the height alone, and used to drop the thumb mid-walk.
  let lastWidth = window.innerWidth; window.addEventListener('resize', () => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; reset(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
})();
