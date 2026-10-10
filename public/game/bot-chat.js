'use strict';
// Persistent companion dock. Only real mailbox replies render as bot messages.
(() => {
  const dock = document.createElement('aside'); dock.className = 'bot-chat companion-dock';
  dock.setAttribute('aria-label', 'Party companion');
  dock.innerHTML = `<div class="chat-heading"><div><div class="eyebrow">PARTY COMPANION</div><h2 id="chatTitle">A little company.</h2></div><button type="button" class="chat-close" aria-label="Expand conversation" aria-expanded="false">⌃</button></div><label class="chat-select" for="chatBot">Talk to<select id="chatBot"></select></label><div class="chat-tools"><button type="button" data-prompt="What should I focus on next?">Next move</button><button type="button" data-prompt="Help me close out today.">Closeout</button><button type="button" id="chatQuests" aria-expanded="false">Quests</button><button type="button" id="chatLocation">⌖ Life sync</button></div><div class="chat-content" hidden><div class="chat-log" role="log" aria-label="Conversation" aria-live="polite"></div></div><div class="chat-quests" hidden></div><p class="chat-status" role="status">Connecting your party…</p><form class="chat-compose"><label class="sr-only" for="chatText">Your message</label><textarea id="chatText" maxlength="2000" rows="1" placeholder="Tell Grok what’s on your mind…" required></textarea><div><small>Enter to send</small><button type="submit" class="primary">Send →</button></div></form>`;
  document.querySelector('.world-frame').after(dock);
  const select = dock.querySelector('#chatBot'), text = dock.querySelector('#chatText'), log = dock.querySelector('.chat-log');
  const status = dock.querySelector('.chat-status'), send = dock.querySelector('[type=submit]'), contentEl = dock.querySelector('.chat-content');
  const questPanel = dock.querySelector('.chat-quests'), toggle = dock.querySelector('.chat-close');
  GameRoster.ALL.forEach(b => { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; select.append(o); });
  const STORE = 'becoming-companion-session-v1', FAST_MS = 1500;
  let config = { relay: false }, configPromise, expanded = false, generation = 0, timer, refreshController, round = 0;
  const threads = new Map(), drafts = new Map(), pending = new Map(), sending = new Set();
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE));
    if (GameRoster.find(saved?.bot)) select.value = saved.bot;
    for (const [bot, value] of saved?.drafts || []) if (GameRoster.find(bot) && typeof value === 'string') drafts.set(bot, value.slice(0, 2000));
    for (const [bot, rows] of saved?.pending || []) if (GameRoster.find(bot) && Array.isArray(rows)) {
      const valid = rows.filter(r => typeof r?.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id) && typeof r.content === 'string' && r.content.length <= 2000).slice(-10);
      if (valid.length) pending.set(bot, valid.map(r => ({ ...r, delivery: r.delivery === 'sending' ? 'failed' : r.delivery })));
    }
  } catch {}
  function remember() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ bot: select.value, drafts: [...drafts], pending: [...pending] })); } catch {}
  }
  const botName = bot => GameRoster.find(bot)?.name || 'Your bot';
  const rowsFor = bot => {
    const remote = threads.get(bot) || [], local = pending.get(bot) || [];
    return [...remote, ...local.filter(m => !remote.some(r => r.role === 'user' && r.key === m.key)).map(m => ({ ...m, role: 'user' }))];
  };
  function expand(value = true) {
    expanded = value; contentEl.hidden = !value; dock.classList.toggle('expanded', value);
    toggle.textContent = value ? '⌄' : '⌃'; toggle.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-label', value ? 'Collapse conversation' : 'Expand conversation');
    if (value) log.scrollTop = log.scrollHeight;
  }
  function render() {
    const bot = select.value, rows = rowsFor(bot); log.replaceChildren();
    for (const r of rows) {
      const row = document.createElement('article'); row.className = 'chat-message ' + r.role;
      const name = document.createElement('b'); name.textContent = r.role === 'user' ? 'You' : botName(bot);
      const p = document.createElement('p'); p.textContent = r.content; row.append(name, p);
      if (r.delivery) {
        const stateEl = document.createElement('small'); stateEl.textContent = { sending: 'Sending…', delivered: 'Delivered', failed: 'Delivery unconfirmed' }[r.delivery]; row.append(stateEl);
        if (r.delivery === 'failed') { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.onclick = () => transmit(bot, r); row.append(retry); }
      }
      log.append(row);
    }
    const waiting = (pending.get(bot) || []).filter(r => r.delivery === 'delivered');
    if (waiting.length) {
      const row = document.createElement('div'); row.className = 'chat-thinking';
      const orb = document.createElement('span'); orb.className = 'thinking-orb'; orb.textContent = '✦'; orb.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = waiting.some(w => Date.now() - w.since > 180000) ? `${botName(bot)}’s reply is taking a while. You can keep exploring.` : `${botName(bot)} is thinking · you can keep exploring`;
      row.append(orb, label); log.append(row);
    } else if (!rows.length) { const p = document.createElement('p'); p.className = 'chat-empty'; p.textContent = 'Your real bots, right here. Pick a guide and send a message.'; log.append(p); }
    text.placeholder = `Message ${botName(bot)}…`;
    log.scrollTop = log.scrollHeight;
  }
  function connectionUI() {
    text.disabled = !!config.local;
    send.disabled = !config.relay || sending.has(select.value) || !navigator.onLine;
    if (config.local) status.textContent = 'Local preview · external bot chat is off.';
    else if (!navigator.onLine) status.textContent = 'Offline · your draft is safe. Reconnect to send.';
  }
  async function request(url, options = {}, signal) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: signal || AbortSignal.timeout(20000) });
    let data; try { data = await r.json(); } catch { throw Error('Connection interrupted. Please retry.'); }
    if (!r.ok) throw Error(data.error || 'Your party connection is unavailable.'); return data;
  }
  function connect(force = false) {
    if (configPromise && !force) return configPromise;
    configPromise = request('/api/chat').then(data => {
      config = data; connectionUI();
      if (!config.relay && !config.local) status.textContent = 'Party inbox unavailable. Your draft stays here.';
      else if (config.relay) status.textContent = 'Ready · replies arrive from your Grok bots.';
    }).catch(e => { configPromise = null; status.textContent = e.message; connectionUI(); });
    return configPromise;
  }
  function settle(bot, remote) {
    const rows = pending.get(bot) || [], keep = [];
    for (const row of rows) {
      if (remote.some(r => r.role === 'assistant' && r.key === row.key)) {
        if (bot !== select.value || !expanded) {
          status.textContent = `${botName(bot)} replied.`;
          toast(`${botName(bot)} replied · open the companion history to read it.`);
        }
      } else { if (remote.some(r => r.role === 'user' && r.key === row.key)) row.delivery = 'delivered'; keep.push(row); }
    }
    if (keep.length) pending.set(bot, keep); else pending.delete(bot); remember();
  }
  async function refresh(bot) {
    if (!config.relay || document.hidden || !navigator.onLine) return;
    const token = generation, current = new AbortController(); refreshController = current;
    const timeout = setTimeout(() => current.abort(), 18000);
    try {
      const data = await request('/api/chat?bot=' + encodeURIComponent(bot), {}, current.signal);
      const remote = Array.isArray(data.messages) ? data.messages : [];
      threads.set(bot, remote); settle(bot, remote);
      if (bot === select.value && token === generation) {
        render();
        if (!sending.has(bot)) status.textContent = (pending.get(bot) || []).some(r => r.delivery === 'delivered') ? 'Delivered · waiting for your bot’s reply.' : 'Shared inbox up to date.';
      }
    } catch (e) { if (bot === select.value && token === generation && e.name !== 'AbortError') status.textContent = e.message; }
    finally { clearTimeout(timeout); if (refreshController === current) refreshController = null; }
  }
  async function tick() {
    clearTimeout(timer); timer = null;
    if (!document.hidden && navigator.onLine) {
      if (!config.relay && !config.local) await connect(true);
      const bots = [...pending.keys()];
      // Rotate through every pending bot so a busy selected thread cannot starve other replies.
      await refresh(bots.length ? bots[round++ % bots.length] : select.value);
    }
    const active = [...pending.values()].some(rows => rows.some(r => r.delivery === 'delivered' && Date.now() - r.since < 180000));
    timer = setTimeout(tick, active ? FAST_MS : 15000);
  }
  function wake() { if (refreshController) return; clearTimeout(timer); timer = setTimeout(tick, 0); }
  async function transmit(bot, row) {
    if (sending.has(bot) || !config.relay || !navigator.onLine) return;
    sending.add(bot); row.delivery = 'sending'; remember(); connectionUI(); render();
    if (bot === select.value) status.textContent = 'Sending…';
    try {
      const data = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'relay', bot, text: row.content, id: row.id }) });
      row.key = data.key; row.delivery = 'delivered'; row.since = Date.now();
      if (bot === select.value) status.textContent = 'Delivered · your bot is thinking.';
      wake();
    } catch (e) {
      row.delivery = 'failed'; if (bot === select.value) status.textContent = `${e.message} Retry checks the same message; it won’t send a duplicate.`;
    } finally { sending.delete(bot); remember(); render(); connectionUI(); }
  }
  dock.querySelector('form').onsubmit = e => {
    e.preventDefault(); const value = text.value.trim(), bot = select.value;
    if (!value || !config.relay || sending.has(bot) || !navigator.onLine) return;
    const id = crypto.randomUUID(), row = { id, key: `chat:${bot}:${id}`, content: value, at: new Date().toISOString(), since: Date.now(), delivery: 'sending' };
    const rows = pending.get(bot) || []; rows.push(row); pending.set(bot, rows);
    text.value = ''; drafts.set(bot, ''); remember(); expand(); render(); transmit(bot, row);
  };
  let selected = select.value;
  function switchBot(bot) {
    drafts.set(selected, text.value); selected = bot; select.value = bot; text.value = drafts.get(bot) || '';
    generation++; refreshController?.abort(); remember(); render(); connectionUI(); if (!questPanel.hidden) renderQuestsInline(); wake();
  }
  select.onchange = () => switchBot(select.value);
  text.oninput = () => { drafts.set(select.value, text.value); remember(); };
  text.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); dock.querySelector('.chat-compose').requestSubmit(); }
    if (e.key === 'Escape') { expand(false); canvas.focus({ preventScroll: true }); }
  };
  // Nested quest forms must not bubble into the message sender.
  questPanel.addEventListener('submit', e => e.stopPropagation());
  function renderQuestsInline() {
    const b = partyMember(select.value), list = b ? botQuests(b).filter(q => available(q) && !E.completed(state, q)).slice(0, 4) : [];
    questPanel.innerHTML = `<div class="eyebrow">NEXT REAL-LIFE STEPS</div>${list.length ? list.map(q => `<details><summary>${esc(q.title)} <small>+${q.xp} XP</small></summary><p>${esc(q.detail)}</p><form data-inline-claim="${esc(q.id)}"><label>What did you finish?<textarea required maxlength="2000" name="proof" rows="2" placeholder="Evidence or a short note…"></textarea></label>${(q.checks || []).map(c => `<label class="check-row"><input type="checkbox" required>${esc(c)}</label>`).join('')}<label class="check-row"><input type="checkbox" required>I completed this in real life.</label><button type="submit" class="primary">Claim ${q.xp} XP ✦</button><p role="alert" class="error-message"></p></form></details>`).join('') : '<p>No open quests for this guide.</p>'}`;
    questPanel.querySelectorAll('form').forEach(form => form.onsubmit = e => {
      e.preventDefault(); e.stopPropagation(); const q = quests().find(q => q.id === form.dataset.inlineClaim);
      try { if (!q) throw Error('This quest is no longer available.'); E.award(state, q, new FormData(form).get('proof')); save(); update(); renderQuestsInline(); status.textContent = 'Progress claimed. A little closer to your next chapter.'; }
      catch (err) { form.querySelector('[role=alert]').textContent = err.message; }
    });
  }
  dock.querySelector('#chatQuests').onclick = () => { questPanel.hidden = !questPanel.hidden; dock.querySelector('#chatQuests').setAttribute('aria-expanded', String(!questPanel.hidden)); if (!questPanel.hidden) renderQuestsInline(); };
  dock.querySelector('#chatLocation').onclick = () => window.LifeSync?.open();
  dock.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { text.value = b.dataset.prompt; drafts.set(select.value, text.value); remember(); text.focus(); });
  toggle.onclick = () => expand(!expanded);
  window.BotChat = {
    isOpen: () => expanded,
    isFocused: () => dock.contains(document.activeElement),
    mount(parent) { const home = document.querySelector('#worldScreen'); if (parent === document.body) { if (dock.parentNode !== home) document.querySelector('.world-frame').after(dock); } else if (dock.parentNode !== parent) parent.append(dock); window.RewardMoments?.mount(); },
    open(bot = select.value) {
      if (screen !== 'world') showScreen('world');
      if ($('#modal').open) $('#modal').close();
      if (GameRoster.find(bot) && bot !== selected) switchBot(bot);
      keys.clear();
      const parent = document.fullscreenElement || document.webkitFullscreenElement || document.querySelector('.world-frame.immersive') || document.body;
      BotChat.mount(parent); expand(true); render(); connect(); wake(); if (parent === document.body && matchMedia('(max-width:760px)').matches) dock.scrollIntoView({ block: 'nearest', behavior: 'auto' }); if (!text.disabled) text.focus({ preventScroll: true });
    },
  };
  document.querySelector('#partyChat')?.addEventListener('click', () => BotChat.open());
  document.addEventListener('click', e => { const b = e.target.closest('[data-chat-bot]'); if (b) BotChat.open(b.dataset.chatBot); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { refreshController?.abort(); clearTimeout(timer); } else wake(); });
  window.addEventListener('online', () => { connectionUI(); wake(); }); window.addEventListener('offline', connectionUI);
  // Keep world shortcuts out of bot selectors, buttons and forms.
  dock.addEventListener('keydown', e => e.stopPropagation());
  text.value = drafts.get(select.value) || ''; render(); connectionUI(); connect().then(wake);
})();
