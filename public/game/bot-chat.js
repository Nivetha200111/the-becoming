'use strict';
// Real messages render as plain text. No AI output is ever interpreted as game code or HTML.
(() => {
  const dialog = document.createElement('dialog'); dialog.className = 'bot-chat';
  dialog.setAttribute('aria-labelledby', 'chatTitle');
  dialog.innerHTML = `<div class="chat-heading"><div><div class="eyebrow">YOUR PARTY · A CONVERSATION</div><h2 id="chatTitle">Talk with your bots.</h2></div><button type="button" class="chat-close" aria-label="Close chat">×</button></div><label class="chat-select">Who’s on your mind?<select id="chatBot"></select></label><div class="chat-log" role="log" aria-label="Conversation" aria-live="polite"></div><p class="chat-status" role="status"></p><form class="chat-compose"><label for="chatText">Your message</label><textarea id="chatText" maxlength="2000" rows="3" placeholder="Tell them what’s on your mind…" required></textarea><div><small>Enter to send · Shift + Enter for a new line</small><button type="submit" class="primary">Send →</button></div></form>`;
  document.body.append(dialog);
  const select = dialog.querySelector('#chatBot'), text = dialog.querySelector('#chatText'), log = dialog.querySelector('.chat-log'), status = dialog.querySelector('.chat-status'), send = dialog.querySelector('[type=submit]');
  text.disabled = send.disabled = true;
  GameRoster.ALL.forEach(b => { const option = document.createElement('option'); option.value = b.id; option.textContent = b.name; select.append(option); });
  let config = { relay: false }, sending = false, pollTimer, fastTimer, polling = false, generation = 0, controller, retry;
  // Bots awaiting a Reply to a message sent this session: bot id -> { key, since, timedOut }. Survives switching bots.
  const pending = new Map(), FAST_MS = 3000, FAST_LIMIT_MS = 180000;
  const threads = new Map(), threadKey = () => select.value;
  const thread = key => { if (!threads.has(key)) threads.set(key, []); return threads.get(key); };
  function message(role, content, at) {
    const row = document.createElement('article'); row.className = 'chat-message ' + role;
    const name = document.createElement('b'); name.textContent = role === 'user' ? 'You' : GameRoster.find(select.value).name;
    const p = document.createElement('p'); p.textContent = content; row.append(name, p);
    if (at) { const time = document.createElement('small'); time.textContent = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(at)); row.append(time); }
    return row;
  }
  function render() {
    const rows = thread(threadKey()); log.replaceChildren(...rows.map(r => message(r.role, r.content, r.at)));
    const wait = pending.get(threadKey());
    if (wait) {
      const row = document.createElement('div'); row.className = 'chat-typing' + (wait.timedOut ? ' slow' : '');
      if (wait.timedOut) row.textContent = 'Reply is taking longer than usual; it’ll appear here when ready.';
      else { row.setAttribute('aria-label', GameRoster.find(threadKey()).name + ' is typing…'); const b = document.createElement('b'); b.textContent = GameRoster.find(threadKey()).name + ' is typing…'; const dots = document.createElement('span'); dots.className = 'dots'; dots.innerHTML = '<i></i><i></i><i></i>'; row.append(b, dots); }
      log.append(row);
    } else if (!rows.length) { const empty = document.createElement('p'); empty.className = 'chat-empty'; empty.textContent = 'Messages and replies from your shared Notion inbox appear here.'; log.append(empty); }
    log.scrollTop = log.scrollHeight;
  }
  function connectionUI() {
    const available = !!config.relay; text.disabled = !!config.local; send.disabled = !available || sending;
    if (!available) status.textContent = config.local ? 'Local design: external chat is off.' : 'Notion is not connected yet. Your draft stays here until setup is complete.';
  }
  async function request(url, options = {}, signal) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: signal || AbortSignal.timeout(55000) });
    let data; try { data = await response.json(); } catch { throw Error('Your connection was interrupted. Try again.'); }
    if (!response.ok) throw Error(data.error || 'Your message could not be sent.'); return data;
  }
  function settle(bot, messages) {
    const wait = pending.get(bot);
    if (wait && messages.some(r => r.role === 'assistant' && r.key === wait.key)) pending.delete(bot);
  }
  async function refresh(bot = select.value) {
    if (!dialog.open || !config.relay || polling || document.hidden) return;
    const shown = bot === select.value;
    polling = true; const token = generation, key = bot, current = new AbortController(); controller = current;
    const timeout = setTimeout(() => current.abort(), 45000);
    try {
      const data = await request('/api/chat?bot=' + encodeURIComponent(bot), {}, current.signal);
      threads.set(key, data.messages); settle(bot, data.messages);
      if (token !== generation || bot !== select.value) return;
      render();
      const pending = data.messages.filter(m => m.role === 'user' && !data.messages.some(r => r.role === 'assistant' && r.key === m.key));
      status.textContent = pending.length ? `${pending.length} delivered · waiting for ${GameRoster.find(bot).name} to reply` : data.messages.length ? 'Shared inbox up to date.' : 'Ready to message your bot.';
    } catch (e) { if (shown && token === generation && e.name !== 'AbortError') status.textContent = e.message; }
    finally { clearTimeout(timeout); polling = false; if (token !== generation && dialog.open) refresh(); }
  }
  // Fast reply polling: one request every 3 s, only for a bot with a pending message, only while the tab is visible.
  function fastTick() {
    clearTimeout(fastTimer); fastTimer = null;
    if (!dialog.open || !pending.size) return;
    const now = Date.now();
    for (const [bot, wait] of pending) if (!wait.timedOut && now - wait.since > FAST_LIMIT_MS) { wait.timedOut = true; if (bot === select.value) render(); }
    const active = [...pending].filter(([, w]) => !w.timedOut);
    if (!active.length) return;
    if (!document.hidden) { const bot = pending.get(select.value) && !pending.get(select.value).timedOut ? select.value : active[0][0]; refresh(bot); }
    fastTimer = setTimeout(fastTick, FAST_MS);
  }
  const startFast = () => { if (!fastTimer) fastTimer = setTimeout(fastTick, FAST_MS); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open && pending.size) fastTick(); });
  function changeConnection() { generation++; controller?.abort(); render(); status.textContent = ''; connectionUI(); refresh(); }
  select.onchange = changeConnection;
  dialog.querySelector('.chat-compose').onsubmit = async e => {
    e.preventDefault(); const content = text.value.trim(); if (!content || sending || !config.relay) return;
    const key = threadKey(), bot = select.value, token = generation;
    sending = true; connectionUI(); status.textContent = 'Sending your character’s message to Notion…';
    const history = thread(key);
    const id = retry?.bot === bot && retry?.text === content ? retry.id : crypto.randomUUID(); retry = { bot, text: content, id };
    try {
      const body = { mode: 'relay', bot, text: content, id };
      const data = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      history.push({ id, key: data.key, role: 'user', content, at: new Date().toISOString() });
      retry = null;
      pending.set(bot, { key: data.key, since: Date.now(), timedOut: false }); startFast();
      if (token === generation) { text.value = ''; render(); status.textContent = 'Delivered to Notion. Waiting for your bot to read and reply.'; }
    } catch (e) { if (token === generation) status.textContent = e.message + ' Your draft is still here; Send retries it.'; }
    finally { sending = false; connectionUI(); }
  };
  text.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); dialog.querySelector('form').requestSubmit(); } };
  const close = () => { generation++; clearInterval(pollTimer); clearTimeout(fastTimer); fastTimer = null; controller?.abort(); dialog.close(); canvas.focus({ preventScroll: true }); };
  dialog.querySelector('.chat-close').onclick = close; dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  window.BotChat = {
    isOpen: () => dialog.open,
    mount: parent => { if (dialog.parentNode !== parent) parent.append(dialog); },
    open: async (bot = 'grok') => {
      if (GameRoster.find(bot)) select.value = bot; keys.clear(); travel = null;
      const parent = document.fullscreenElement || document.webkitFullscreenElement || document.querySelector('.world-frame.immersive') || document.body;
      BotChat.mount(parent); if (!dialog.open) dialog.showModal(); generation++; status.textContent = 'Connecting…'; render();
      const token = generation;
      try { const data = await request('/api/chat'); config = data; if (!dialog.open) return; connectionUI(); if (config.relay) status.textContent = 'Ready to chat.'; await refresh(); }
      catch (e) { if (token === generation) status.textContent = e.message; }
      if (!dialog.open) return;
      clearInterval(pollTimer); pollTimer = setInterval(() => refresh(), 30000); if (pending.size) startFast(); if (!text.disabled) text.focus();
    },
  };
  document.querySelector('#partyChat')?.addEventListener('click', () => BotChat.open());
  document.addEventListener('click', e => { const b = e.target.closest('[data-chat-bot]'); if (b) BotChat.open(b.dataset.chatBot); });
})();
