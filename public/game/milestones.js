'use strict';
(() => {
  const layer = document.createElement('div'); layer.className = 'reward-floats';
  layer.setAttribute('role', 'status'); layer.setAttribute('aria-live', 'polite'); document.body.append(layer);
  const clone = () => JSON.parse(JSON.stringify(state));
  let previous = clone(), queue = [], timer;
  const known = new Set(previous.entries.map(e => e.key));
  function mount() {
    const parent = document.fullscreenElement || document.webkitFullscreenElement ||
      document.querySelector('.world-frame.immersive') || document.body;
    if (layer.parentNode !== parent) parent.append(layer);
  }
  function next() {
    clearTimeout(timer); timer = null; if (!queue.length) return;
    mount(); const e = queue.shift(), card = document.createElement('div'); card.className = 'reward-float ' + e.kind;
    const symbol = document.createElement('span'); symbol.className = 'reward-spark'; symbol.textContent = e.kind === 'xp' ? '✧' : '✦'; symbol.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = e.title; detail.textContent = e.detail; copy.append(title, detail); card.append(symbol, copy);
    if (e.area) { const go = document.createElement('button'); go.type = 'button'; go.textContent = 'Explore →'; go.onclick = () => { card.remove(); visit(e.area); }; card.append(go); }
    if (layer.childElementCount >= 3) layer.firstElementChild.remove();
    layer.append(card); setTimeout(() => card.remove(), 6500); timer = setTimeout(next, 900);
  }
  window.RewardMoments = {
    show(event) { queue.push(event); if (!timer) next(); },
    mount,
  };
  const original = update;
  update = function () {
    original();
    // Baseline already loaded progress; only newly observed claims celebrate, including cloud bot claims.
    const fresh = state.entries.filter(e => !known.has(e.key));
    if (fresh.length) {
      const events = LifeCore.milestones(previous, state, E, WORLD);
      fresh.forEach(e => known.add(e.key));
      queue.push(...events); if (!timer || !layer.childElementCount) next();
    }
    previous = clone();
  };
  document.addEventListener('fullscreenchange', mount);
  document.addEventListener('webkitfullscreenchange', mount);
})();
