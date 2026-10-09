'use strict';
// Real messages render as plain text. No AI output is ever interpreted as game code or HTML.
(() => {
  const dialog = document.createElement('dialog'); dialog.className = 'bot-chat';
  dialog.setAttribute('aria-labelledby', 'chatTitle');
  dialog.innerHTML = `<div class="chat-heading"><div><div class="eyebrow">YOUR PARTY · A CONVERSATION</div><h2 id="chatTitle">Talk with your bots.</h2></div><button type="button" class="chat-close" aria-label="Close chat">×</button></div><label class="chat-select">Who’s on your mind?<select id="chatBot"></select></label><div class="chat-connections" role="group" aria-label="Chat connection"><button type="button" data-connection="relay" aria-pressed="true">My Grok bots</button><button type="button" data-connection="live" aria-pressed="false">Live Grok</button></div><p class="chat-note"></p><div class="chat-log" role="log" aria-label="Conversation" aria-live="polite"></div><p class="chat-status" role="status"></p><form class="chat-compose"><label for="chatText">Your message</label><textarea id="chatText" maxlength="2000" rows="3" placeholder="Tell them what’s on your mind…" required></textarea><div><small>Enter to send · Shift + Enter for a new line</small><button type="submit" class="primary">Send →</button></div></form>`;
  document.body.append(dialog);
  const select = dialog.querySelector('#chatBot'), text = dialog.querySelector('#chatText'), log = dialog.querySelector('.chat-log'), status = dialog.querySelector('.chat-status'), send = dialog.querySelector('[type=submit]');
  text.disabled = send.disabled = true;
  GameRoster.ALL.forEach(b => { const option = document.createElement('option'); option.value = b.id; option.textContent = b.name; select.append(option); });
  let mode = 'relay', config = { relay: false, live: false }, sending = false, pollTimer, polling = false, generation = 0, controller, retry;
  const threads = new Map(), threadKey = () => mode + ':' + select.value;
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
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'chat-empty'; empty.textContent = mode === 'relay' ? 'Messages and their replies from your shared Party HQ appear here.' : 'Start a fresh conversation with your guide.'; log.append(empty); }
    log.scrollTop = log.scrollHeight;
  }
  function connectionUI() {
    dialog.querySelectorAll('[data-connection]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.connection === mode)));
    dialog.querySelector('.chat-note').textContent = mode === 'relay' ? 'Your actual Grok bots’ shared inbox. Replies appear when the bot reads and responds in Party HQ.' : 'Live Grok, using your guide’s role and game progress. This is a fresh conversation; existing Grok app memory is not connected.';
    const available = !!config[mode]; text.disabled = !available; send.disabled = !available || sending;
    if (!available) status.textContent = config.local ? 'Local design: external chat is off.' : mode === 'relay' ? 'Connect Notion Party HQ to send messages to your existing bots.' : 'Add the private Grok API key to enable live replies.';
  }
  async function request(url, options = {}, signal) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: signal || AbortSignal.timeout(55000) });
    let data; try { data = await response.json(); } catch { throw Error('Your connection was interrupted. Try again.'); }
    if (!response.ok) throw Error(data.error || 'Your message could not be sent.'); return data;
  }
  async function refresh() {
    if (!dialog.open || mode !== 'relay' || !config.relay || polling || document.hidden) return;
    polling = true; const token = generation, bot = select.value, key = threadKey(), current = new AbortController(); controller = current;
    const timeout = setTimeout(() => current.abort(), 45000);
    try {
      const data = await request('/api/chat?bot=' + encodeURIComponent(bot), {}, current.signal);
      if (token !== generation) return;
      threads.set(key, data.messages); render();
      const pending = data.messages.filter(m => m.role === 'user' && !data.messages.some(r => r.role === 'assistant' && r.key === m.key));
      status.textContent = pending.length ? `${pending.length} delivered · waiting for ${GameRoster.find(bot).name} to reply` : data.messages.length ? 'Shared inbox up to date.' : 'Ready to message your bot.';
    } catch (e) { if (token === generation && e.name !== 'AbortError') status.textContent = e.message; }
    finally { clearTimeout(timeout); polling = false; if (token !== generation && dialog.open) refresh(); }
  }
  function changeConnection() { generation++; controller?.abort(); render(); status.textContent = ''; connectionUI(); refresh(); }
  select.onchange = changeConnection;
  dialog.querySelectorAll('[data-connection]').forEach(b => b.onclick = () => { mode = b.dataset.connection; changeConnection(); });
  dialog.querySelector('.chat-compose').onsubmit = async e => {
    e.preventDefault(); const content = text.value.trim(); if (!content || sending || !config[mode]) return;
    const key = threadKey(), bot = select.value, chosenMode = mode, token = generation;
    sending = true; connectionUI(); status.textContent = chosenMode === 'relay' ? 'Sending to your bot’s shared inbox…' : 'Grok is thinking…';
    const history = thread(key);
    const id = retry?.bot === bot && retry?.text === content ? retry.id : crypto.randomUUID(); retry = { bot, text: content, id };
    try {
      const recent = history.slice(-22).map(m => ({ role: m.role, content: m.content }));
      while (recent.reduce((n, m) => n + m.content.length, content.length) > 16000) recent.splice(0, 2);
      const body = chosenMode === 'relay' ? { mode: chosenMode, bot, text: content, id } : { mode: chosenMode, bot, messages: [...recent, { role: 'user', content }] };
      const data = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (chosenMode === 'live') history.push({ role: 'user', content }, { role: 'assistant', content: data.content });
      else history.push({ id, key: data.key, role: 'user', content, at: new Date().toISOString() });
      retry = null;
      if (token === generation) { text.value = ''; render(); status.textContent = chosenMode === 'relay' ? 'Delivered. Waiting for your bot to read and reply.' : 'Live Grok replied.'; }
    } catch (e) { if (token === generation) status.textContent = e.message + ' Your draft is still here; Send retries it.'; }
    finally { sending = false; connectionUI(); }
  };
  text.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); dialog.querySelector('form').requestSubmit(); } };
  const close = () => { generation++; clearInterval(pollTimer); controller?.abort(); dialog.close(); canvas.focus({ preventScroll: true }); };
  dialog.querySelector('.chat-close').onclick = close; dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  window.BotChat = {
    isOpen: () => dialog.open,
    mount: parent => { if (dialog.parentNode !== parent) parent.append(dialog); },
    open: async (bot = 'grok') => {
      if (GameRoster.find(bot)) select.value = bot; keys.clear(); travel = null;
      const parent = document.fullscreenElement || document.webkitFullscreenElement || document.querySelector('.world-frame.immersive') || document.body;
      BotChat.mount(parent); if (!dialog.open) dialog.showModal(); generation++; status.textContent = 'Connecting…'; render();
      const token = generation;
      try { const data = await request('/api/chat'); config = data; if (!dialog.open) return; connectionUI(); if (config[mode]) status.textContent = 'Ready to chat.'; await refresh(); }
      catch (e) { if (token === generation) status.textContent = e.message; }
      if (!dialog.open) return;
      clearInterval(pollTimer); pollTimer = setInterval(refresh, 12000); if (!text.disabled) text.focus();
    },
  };
  document.querySelector('#partyChat')?.addEventListener('click', () => BotChat.open());
  document.addEventListener('click', e => { const b = e.target.closest('[data-chat-bot]'); if (b) BotChat.open(b.dataset.chatBot); });
})();
