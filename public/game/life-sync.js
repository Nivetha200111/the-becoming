'use strict';
(() => {
  const KEY = 'becoming-life-sync-device-v1';
  let settings = { office: null, enabled: false }, watch = null, epoch = 0, place = 'unknown', lastArrival = 0, pinning = false;
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (LifeCore.validOffice(saved?.office)) settings = { office: saved.office, enabled: saved.enabled === true }; } catch {}
  const bar = document.createElement('section'); bar.className = 'life-bar'; bar.setAttribute('aria-label', 'Real-life presence');
  bar.innerHTML = '<span class="life-marker" aria-hidden="true">⌖</span><div><strong id="lifePlace">Your life, in your world.</strong><small id="lifeStatus" role="status">Connect your office, or check in yourself.</small></div><button type="button" id="visitOffice">Office →</button><button type="button" id="lifeSettings">Life sync</button>';
  document.querySelector('.world-frame').before(bar);
  const label = bar.querySelector('#lifePlace'), status = bar.querySelector('#lifeStatus');
  const show = message => { status.textContent = message; const el = document.getElementById('lifeError'); if (el) el.textContent = message; };
  function remember() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; }
    catch { show('Device storage is unavailable. Office settings last only for this visit.'); return false; }
  }
  function stop() { epoch++; if (watch !== null) navigator.geolocation?.clearWatch(watch); watch = null; }
  function locationError(error) {
    const message = error.code === 1 ? 'Location permission is off. Enable it in your browser, or use manual check-in.' :
      error.code === 2 ? 'Location unavailable. Try near a window or check in yourself.' : 'Location took too long. Try again, or check in yourself.';
    show(message);
    if (error.code === 1) { stop(); settings.enabled = false; remember(); updateButtons(); }
  }
  function updateButtons() {
    const button = document.getElementById('toggleLife');
    if (button) { button.textContent = settings.enabled ? (watch === null ? 'Resume location sync' : 'Pause location sync') : 'Enable location sync'; button.disabled = !settings.office; }
    const pause = document.getElementById('pauseLife'); if (pause) pause.hidden = !settings.enabled || watch !== null;
    const name = document.getElementById('officePinStatus');
    if (name) name.textContent = settings.office ? `Office saved on this device · ${settings.office.radius} m arrival zone` : 'No office pinned yet.';
  }
  function visitOffice() {
    if ($('#modal').open) $('#modal').close();
    showScreen('world');
    if (window.WorldTravel) WorldTravel.office();
    else { goTo(390, 192, () => toast('Office check-in · the Contract Citadel is your 2D work destination.')); }
  }
  function arrival(manual = false) {
    lastArrival = Date.now(); label.textContent = manual ? 'At the office · manual check-in' : 'At the office · location confirmed';
    visitOffice();
    window.RewardMoments?.show({ kind: 'presence', title: 'Welcome to your office', detail: 'Settle in, or take a little trip to Hush Hollow.' });
  }
  function applyFix(position) {
    const c = position.coords, fix = { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy, timestamp: position.timestamp };
    const next = LifeCore.presence(settings.office, fix, place);
    if (next === 'unknown') { show('Waiting for a recent, more precise location. Manual check-in is always available.'); return; }
    const before = place; place = next;
    if (place === 'office') {
      label.textContent = 'At the office · location confirmed'; show('Your avatar is free to explore. Your next arrival will bring you back.');
      // One arrival per entry, with a cooldown for GPS drift. Updates never keep pulling her back.
      if (before !== 'office' && Date.now() - lastArrival > 60000) arrival();
    } else { label.textContent = 'Out in the real world'; show('Office sync on · your world is yours to explore.'); }
  }
  function start(explicit = false) {
    if (!settings.office || !settings.enabled || document.hidden || watch !== null) return;
    if (!window.isSecureContext || !navigator.geolocation) { show('Location needs HTTPS and a supported browser. You can still check in yourself.'); return; }
    const token = ++epoch;
    const begin = () => {
      if (token !== epoch || !settings.enabled || document.hidden) return;
      show('Finding your location…');
      try { watch = navigator.geolocation.watchPosition(p => { if (token === epoch) applyFix(p); }, e => { if (token === epoch) locationError(e); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }); updateButtons(); }
      catch { show('Your browser could not start location sync. Manual check-in is available.'); }
    };
    if (explicit) begin();
    else if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then(p => {
      if (token !== epoch) return;
      if (p.state === 'granted') begin(); else show('Resume location sync from Life sync when you’re ready.');
    }).catch(() => show('Resume location sync from Life sync when you’re ready.'));
    else show('Resume location sync from Life sync when you’re ready.');
  }
  function open() {
    modal(`<div class="eyebrow">REAL LIFE → YOUR WORLD</div><h2>A place for your working day.</h2><p>When you arrive at your real office, your avatar arrives at the Office island. You can leave for Hush Hollow or any other destination whenever you like.</p><p>Location runs only while this game is open and visible. Your office coordinates stay on this device, outside cloud saves. No route or location history is recorded. Arriving earns no XP.</p><p id="officePinStatus"></p><label for="officeRadius">Office arrival zone</label><select id="officeRadius"><option value="150">150 metres</option><option value="250">250 metres</option><option value="500">500 metres</option></select><div class="dialog-actions"><button type="button" class="primary" id="pinOffice">I’m at the office · pin this spot</button><button type="button" class="secondary" id="toggleLife"></button><button type="button" class="secondary" id="pauseLife" hidden>Turn location sync off</button></div><details class="office-coordinate-entry"><summary>Pin an office with coordinates</summary><form id="officeCoordinates"><label for="officeLat">Latitude</label><input id="officeLat" type="number" min="-90" max="90" step="any" required><label for="officeLon">Longitude</label><input id="officeLon" type="number" min="-180" max="180" step="any" required><button class="secondary" type="submit">Save office</button></form></details><p id="lifeError" role="status"></p><div class="dialog-actions"><button class="secondary" id="manualOffice">Check in at office myself</button><button class="secondary" id="lifeHollow">Visit Hush Hollow</button><button class="danger" id="forgetOffice">Forget office & stop tracking</button></div>`);
    $('#officeRadius').value = String(settings.office?.radius || 250); updateButtons();
    $('#officeRadius').onchange = () => { if (settings.office) { settings.office.radius = Number($('#officeRadius').value); remember(); place = 'unknown'; updateButtons(); } };
    $('#pinOffice').disabled = pinning;
    $('#pinOffice').onclick = () => {
      if (!window.isSecureContext || !navigator.geolocation) { show('Location needs HTTPS. Use coordinates or manual check-in.'); return; }
      pinning = true; const btn = $('#pinOffice'), radius = Number($('#officeRadius').value); btn.disabled = true; show('Pinning your office…');
      const token = epoch;
      navigator.geolocation.getCurrentPosition(p => {
        pinning = false; if (btn.isConnected) btn.disabled = false;
        if (token !== epoch) return;
        if (!Number.isFinite(p.coords.accuracy) || p.coords.accuracy < 0 || p.coords.accuracy > radius / 2 || !Number.isFinite(p.timestamp) || Date.now() - p.timestamp > 120000 || p.timestamp > Date.now() + 10000) { show('This location is too imprecise to pin your office. Try again near a window, choose a wider zone, or use coordinates.'); return; }
        const office = { latitude: p.coords.latitude, longitude: p.coords.longitude, radius };
        if (!LifeCore.validOffice(office)) { show('Your browser returned an invalid location. Try again.'); return; }
        stop(); settings = { office, enabled: false }; place = 'unknown'; remember(); updateButtons(); show('Office pinned. Enable location sync when you’re ready.');
      }, e => { pinning = false; if (btn.isConnected) btn.disabled = false; if (token === epoch) locationError(e); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    };
    $('#officeCoordinates').onsubmit = e => {
      e.preventDefault(); const office = { latitude: Number($('#officeLat').value), longitude: Number($('#officeLon').value), radius: Number($('#officeRadius').value) };
      if (!LifeCore.validOffice(office)) { show('Use valid latitude and longitude coordinates.'); return; }
      stop(); settings = { office, enabled: false }; place = 'unknown'; remember(); updateButtons(); show('Office saved. Enable location sync when you’re ready.');
    };
    $('#toggleLife').onclick = () => {
      if (settings.enabled && watch === null) { start(true); return; }
      settings.enabled = !settings.enabled; remember(); updateButtons();
      if (settings.enabled) start(true); else { stop(); place = 'unknown'; label.textContent = 'Location sync paused'; show('Your office is saved. Manual check-in is still available.'); }
    };
    $('#pauseLife').onclick = () => { stop(); settings.enabled = false; place = 'unknown'; remember(); updateButtons(); label.textContent = 'Location sync paused'; show('Tracking is off. Your office stays saved on this device.'); };
    $('#manualOffice').onclick = () => { place = 'office'; arrival(true); show('Manual check-in · explore anywhere from here.'); };
    $('#lifeHollow').onclick = () => { $('#modal').close(); showScreen('world'); if (window.WorldTravel) WorldTravel.to('hollow'); else toast('Hush Hollow needs the 3D world. Your work area is available below.'); };
    $('#forgetOffice').onclick = () => { stop(); settings = { office: null, enabled: false }; place = 'unknown'; remember(); label.textContent = 'Your life, in your world.'; updateButtons(); show('Office forgotten. Location tracking is off.'); };
  }
  window.LifeSync = { open, visitOffice };
  bar.querySelector('#lifeSettings').onclick = open; bar.querySelector('#visitOffice').onclick = visitOffice;
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); if (settings.enabled) show('Location paused while the game is hidden.'); } else start(); });
  window.addEventListener('pagehide', stop);
  if (settings.office) label.textContent = 'Your office is connected';
  // Wait for world initialization; a stored permission never causes a fresh prompt on load.
  window.addEventListener('load', () => start());
})();
