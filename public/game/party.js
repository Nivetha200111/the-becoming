'use strict';
// Nivetha's party: the Grok bots from GameRoster (roster.js), plus how each one looks and where they stand.
// Roles, homes and levelling rules live in roster.js; this file owns appearance, voice and the Party screen.
const LOOKS={
grok:{x:628,y:372,color:'#23272e',skin:'#e4ddd4',hair:'#f1f1ee',style:'android',line:'Tell me what you need. I route it to the right bot and keep the whole party moving.'},
bossman:{x:601,y:420,color:'#726283',skin:'#d7b795',hair:'#292b36',style:'cape',line:'Morning lineup sets three priorities. The evening closeout says what actually happened.'},
carmen:{x:450,y:187,color:'#647b89',skin:'#d0a382',hair:'#6b553d',style:'apron',line:'One workflow, every step verified. Let’s make the handoff something we can stand behind.'},
jane:{x:499,y:420,color:'#69848a',skin:'#e2b892',hair:'#cda766',style:'coat',line:'One open loop, one clear decision. What can we finish today?'},
goggins:{x:855,y:500,color:'#808b65',skin:'#9a6e4e',hair:'#393a32',style:'athlete',line:'Check the WHOOP call: PUSH, NORMAL, LIGHT or RECOVER. Then keep the promise you made to yourself.'},
gilfoyle:{x:287,y:332,color:'#414b46',skin:'#c6a07e',hair:'#3d3029',style:'glasses',line:'Play the long game. Which skill compounds, which cert pays, which work belongs on the résumé?'},
fletcher:{x:185,y:362,color:'#1b1b1d',skin:'#d9ab86',hair:'#2a2a2a',style:'tee',line:'Lunch slot. Java. One problem, explained properly, with the edge case. Then we talk.'},
beatrix:{x:956,y:316,color:'#ccb25d',skin:'#d9b18a',hair:'#d8b874',style:'suit',line:'Read the docs, then take the mock without notes. Precision is what survives the hard case.'},
beth:{x:765,y:205,color:'#3f6b5a',skin:'#f0cfb4',hair:'#9a3b22',style:'lab',line:'Questions first, cold. Then read only what you missed. That’s how the board opens up.'},
dexter:{x:390,y:566,color:'#9b8c77',skin:'#c89c76',hair:'#785139',style:'shirt',line:'Find the repeated friction. Remove it cleanly. Leave a system that works tomorrow.'},
eggbot:{x:470,y:330,color:'#f3f1e8',skin:'#f6ecd6',hair:'#f6ecd6',style:'egg',line:'Every bot gets one job and explicit anti-jobs. Shall I hatch a quest for you?'}
};
const COUNCIL_SPOTS={'war-room':{x:515,y:258,color:'#b5613f',icon:'⚑'},'control-room':{x:600,y:258,color:'#3f7f8a',icon:'◎'},'exam-bunker':{x:640,y:165,color:'#7d8b55',icon:'✎'},'career-council':{x:865,y:145,color:'#bd9b55',icon:'✦'}};
const PARTY=GameRoster.BOTS.map(b=>({...b,region:b.home,...LOOKS[b.id]}));
const PARTY_COUNCILS=GameRoster.COUNCILS.map(c=>({...c,region:c.home,council:true,...COUNCIL_SPOTS[c.id]}));
const callName=b=>b.council?b.name:({jane:'Jane',eggbot:'dr eggbot'})[b.id]||b.name.split(' ')[0];
const partyMember=id=>PARTY.find(b=>b.id===id)||PARTY_COUNCILS.find(c=>c.id===id)||null;
const partyUnlocked=b=>E.level(E.total(state))>=WORLD.find(r=>r.id===b.region).unlock;
function partyStats(){try{return (window.PartyFeed?PartyFeed.stats(state):GameRoster.stats(state));}catch(e){return {};}}
// A bot's latest Party HQ check-in, if one exists; otherwise its scripted line.
function liveLine(b){const c=window.PartyFeed&&PartyFeed.latest(b.id);return c?{text:(c.title?c.title+': ':'')+c.message,live:true,sample:!c.at&&!c.date}:{text:b.line||b.role,live:false};}
// Which quests a bot or council offers, best first: its own Party HQ missions, then recovery on recovery days, then dailies before bosses.
function botQuests(b){
 const all=quests(),pick=q=>q.bot===b.id||(b.quests||[]).includes(q.id)||(!q.bot&&(b.regions||[]).includes(q.region));
 let list;
 if(b.council)list=all.filter(q=>(b.quests||[]).includes(q.id)||b.members.some(id=>{const m=partyMember(id);return m&&(q.bot===id||(m.quests||[]).includes(q.id)||(!q.bot&&(m.regions||[]).includes(q.region)));}));
 else if(b.routes||b.leads)list=all;
 else if(b.id==='eggbot')list=state.custom.slice();
 else list=all.filter(pick);
 const rank=q=>(q.bot===b.id?0:q.mission?1:3)+(state.mode==='recovery'&&q.recovery?-2:0)+(q.boss?4:0)+(E.completed(state,q)?10:0)+(available(q)?0:20);
 return list.map((q,i)=>[q,rank(q)*100+i]).sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
}
function nextQuestFor(b,after){const open=botQuests(b).filter(q=>available(q)&&!E.completed(state,q));if(!open.length)return null;const i=after?open.findIndex(q=>q.id===after.id):-1;return open[(i+1)%open.length];}
function botPortrait(b){
 if(b.council)return councilPortrait(b);
 const st=b.style,hairPath=`<path d="M30 43Q25 10 52 16Q77 16 70 46L64 32Q49 23 34 36Z" fill="${b.hair}"/>`;
 const head=st==='egg'?`<ellipse cx="50" cy="40" rx="22" ry="30" fill="${b.skin}"/><path d="M33 40h34" stroke="#7a6a52" stroke-width="2"/><circle cx="42" cy="40" r="6" fill="#bfe6ef" stroke="#5a4c3a" stroke-width="2"/><circle cx="58" cy="40" r="6" fill="#bfe6ef" stroke="#5a4c3a" stroke-width="2"/>`:`<ellipse cx="50" cy="45" rx="19" ry="25" fill="${b.skin}"/>`;
 const hair=st==='athlete'||st==='tee'||st==='egg'?'':hairPath;
 const eyes=st==='glasses'?'<path d="M32 44h15v10H32zm22 0h15v10H54zM47 48h7" fill="none" stroke="#293c35" stroke-width="2"/><path d="M35 59Q50 76 65 59L62 70Q50 80 38 70Z" fill="#3d3029"/>':st==='android'?'<rect x="31" y="42" width="38" height="8" rx="4" fill="#7ef0ff"/>':st==='egg'?'':'<path d="M40 46h3m14 0h3" stroke="#3c3730" stroke-width="2.5" stroke-linecap="round"/>';
 const outfit=st==='apron'?'<path d="M38 72h24l7 38H31Z" fill="#ebe5d4"/>':st==='lab'||st==='egg'?'<path d="M36 69L48 80L40 110H25L30 76ZM64 69L52 80L60 110H75L70 76Z" fill="#f3f1e8"/>':st==='cape'?'<path d="M30 73L45 90L30 110H18ZM70 73L55 90L70 110H82Z" fill="#51415f"/><circle cx="50" cy="79" r="4" fill="#d2b66d"/>':st==='android'?'<circle cx="50" cy="86" r="4" fill="#7ef0ff"/>':'';
 return `<svg viewBox="0 0 100 110" role="img" aria-label="${esc(b.name)} portrait"><circle cx="50" cy="48" r="43" fill="${b.color}26"/><path d="M20 110Q20 75 37 69H63Q80 75 80 110Z" fill="${b.color}"/>${head}${hair}${eyes}${st==='egg'?'':'<path d="M45 59q5 3 10 0" stroke="#865c48" fill="none" stroke-width="1.5"/>'}${outfit}</svg>`;
}
function councilPortrait(c){const ms=c.members.map(partyMember).filter(Boolean),n=ms.length;return `<svg viewBox="0 0 100 110" role="img" aria-label="${esc(c.name)} emblem"><circle cx="50" cy="52" r="44" fill="${c.color}24"/><ellipse cx="50" cy="66" rx="30" ry="12" fill="#8a6a46"/><ellipse cx="50" cy="62" rx="30" ry="12" fill="#b08a5c"/>${ms.map((m,i)=>{const a=Math.PI*(1.05+i/(Math.max(1,n-1))*.9),x=50+Math.cos(a)*34,y=50+Math.sin(a)*18;return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${m.color}" stroke="#fff" stroke-width="1.5"/>`;}).join('')}<text x="50" y="68" text-anchor="middle" font-size="15" fill="#fff6dd" font-family="Georgia">${c.icon||'✦'}</text></svg>`;}
const levelChip=(s)=>s?`<span class="lv-chip">Lv ${s.level}</span>`:'';
function xpTrack(s){if(!s)return '';const pct=s.next?Math.round((s.xp-s.start)/(s.next-s.start)*100):100;return `<div class="bot-xp" aria-label="${s.xp} XP${s.next?', '+(s.next-s.xp)+' to next level':''}"><i style="width:${pct}%"></i></div><small class="bot-xp-text">${s.xp} XP${s.next?' · '+(s.next-s.xp)+' to Lv '+(s.level+1):' · max level'}</small>`;}
function botTalk(b){
 const r=WORLD.find(r=>r.id===b.region),qs=botQuests(b),s=partyStats()[b.id],ln=liveLine(b);
 const extra=b.id==='eggbot'?'<button class="primary" id="hatchQuest">Hatch a new quest ✦</button>':'';
 modal(`<div class="bot-dialog-top"><div class="bot-face">${botPortrait(b)}</div><div><div class="eyebrow">${esc(b.role.toUpperCase())}</div><h2>${esc(b.name)} ${levelChip(s)}</h2><small>${esc(r.name)}${b.council?' · '+b.members.map(id=>esc(partyMember(id)?.name||id)).join(', '):''}</small></div></div><blockquote class="bot-line">“${esc(ln.text)}”${ln.live?`<small class="live-tag">${ln.sample?'Sample check-in · local design':'Party HQ check-in'}</small>`:''}</blockquote>${extra}<div class="region-dialog-list">${qs.length?qs.map(q=>`<button data-bot-quest="${esc(q.id)}"><span>${E.completed(state,q)?'✓ ':q.boss?'♜ ':q.mission?'✉ ':''}${esc(q.title)}</span><small>${E.completed(state,q)?'CLAIMED':available(q)?'+'+q.xp+' XP':'LV '+q.unlock}</small></button>`).join(''):'<p class="info-note">No quests here yet.</p>'}</div><p class="info-note">${ln.live?'Lines come from your Grok bots’ Party HQ check-ins.':'This guide’s dialogue is scripted.'} Quest completion is based on actions you record.</p>`);
 all('[data-bot-quest]').forEach(el=>el.onclick=()=>questDialog(el.dataset.botQuest));
 if($('#hatchQuest'))$('#hatchQuest').onclick=()=>{$('#modal').close();$('#newQuest').click();};
}
function councilTalk(c){botTalk(c);}
function renderParty(){
 if(!$('#partyGrid'))return;const st=partyStats();
 const card=b=>{const r=WORLD.find(r=>r.id===b.region),locked=!partyUnlocked(b),ln=liveLine(b),s=st[b.id];return `<article class="bot-card${b.council?' council':''}${locked?' locked':''}" style="--bot:${b.color}"><div class="bot-portrait">${botPortrait(b)}${s?`<span class="bot-level">Lv ${s.level}</span>`:''}</div><div class="eyebrow">${esc(b.council?b.members.length+' MEMBERS · '+r.name.toUpperCase():b.role.toUpperCase())}</div><h3>${esc(b.name)}</h3>${xpTrack(s)}<p>${ln.live?'<span class="live-dot" aria-hidden="true"></span>':''}${esc(ln.text.length>170?ln.text.slice(0,167)+'…':ln.text)}</p><button class="secondary" data-talk="${b.id}">${locked?'Meet at level '+r.unlock:b.council?'Join the council →':'Talk to '+esc(callName(b))+' →'}</button></article>`;};
 $('#partyGrid').innerHTML=PARTY.map(card).join('')+`<div class="party-section"><span class="eyebrow">THE COUNCILS</span><h3>Where your bots meet.</h3></div>`+PARTY_COUNCILS.map(card).join('');
 all('[data-talk]').forEach(el=>el.onclick=()=>{const b=partyMember(el.dataset.talk);if(!partyUnlocked(b))visit(b.region);else if(b.council)councilTalk(b);else botTalk(b);});
}
const partyNav=document.createElement('button');partyNav.className='nav';partyNav.dataset.screen='party';partyNav.textContent='Party';partyNav.onclick=()=>showScreen('party');$('nav').append(partyNav);
const partyScreen=document.createElement('div');partyScreen.id='partyScreen';partyScreen.className='screen';partyScreen.hidden=true;partyScreen.innerHTML='<div id="partyGrid" class="party-grid"></div>';$('.stage').insertBefore(partyScreen,$('footer'));
headings.party=['YOUR PARTY · 11 BOTS · 4 COUNCILS','You don’t travel alone.','Your Grok bots level up with you. Each has one job, a home in the world, and a quest to hand you.'];
const updateWithoutParty=update;update=function(){updateWithoutParty();renderParty();};
// Party HQ missions are tagged with the bot who sent them, in the quest log and the quest dialog.
const missionTag=q=>{const b=partyMember(q.bot);return b?`<div class="mission-tag"><span class="mini-face">${botPortrait(b)}</span><span>Mission from <b>${esc(b.name)}</b>${q.sample?' · sample':''}</span></div>`:'';};
const renderQuestsBase=renderQuests;renderQuests=function(){renderQuestsBase();all('[data-q]').forEach(btn=>{const q=quests().find(q=>q.id===btn.dataset.q),card=btn.closest('.quest-card');if(q&&q.mission&&card&&!card.querySelector('.mission-tag')){card.classList.add('mission');card.insertAdjacentHTML('afterbegin',missionTag(q));}});};
const questDialogBase=questDialog;questDialog=function(id){questDialogBase(id);const q=quests().find(q=>q.id===id);if(q&&q.mission&&$('#modal').open&&!$('#modalBody .mission-tag'))$('#modalBody').insertAdjacentHTML('afterbegin',missionTag(q));};
// 2D fallback sprites (the 3D world draws its own characters).
function drawBot(b,t){ctx.save();ctx.translate(b.x,b.y+Math.sin(t*1.5+PARTY.indexOf(b))*.6);ellipse(0,11,12,4,'#61755628');rect(-6,4,4,8,'#4d5143');rect(3,4,4,8,'#4d5143');poly([[-6,-12],[-12,8],[12,8],[6,-12]],b.color);if(b.style==='apron'||b.style==='lab'||b.style==='egg')poly([[-4,-9],[-7,8],[7,8],[4,-9]],'#ebe6d3');if(b.style==='cape')poly([[-9,-10],[-17,10],[13,9],[5,-10]],'#665376');if(b.style==='egg')ellipse(0,-20,9,12,b.skin);else ellipse(0,-18,8,10,b.skin);if(!['athlete','tee','egg'].includes(b.style))poly([[-8,-18],[-7,-26],[1,-30],[8,-25],[8,-17],[3,-22],[-4,-21]],b.hair);if(b.style==='glasses'||b.style==='egg'){rect(-7,-20,5,4,'#344137');rect(2,-20,5,4,'#344137');rect(-2,-19,4,1,'#344137');}else if(b.style==='android')rect(-7,-20,14,3,'#5fd6e6');else{rect(-4,-19,2,1,'#4d4133');rect(3,-19,2,1,'#4d4133');}ctx.font='9px Segoe UI';ctx.textAlign='center';const w=ctx.measureText(b.name).width+14;ctx.fillStyle='#f8f5e8ed';ctx.beginPath();ctx.roundRect(-w/2,18,w,17,4);ctx.fill();ctx.fillStyle='#60725a';ctx.fillText(b.name,0,30);ctx.fillStyle='#a99461';ctx.font='12px Georgia';ctx.fillText(nextQuestFor(b)?'!':'…',0,-36);ctx.restore();}
const worldDraw=draw;draw=function(t){worldDraw(t);for(const b of PARTY)if(partyUnlocked(b))drawBot(b,t);};
canvas.addEventListener('click',e=>{const p=position(e),b=PARTY.find(b=>Math.hypot(p.x-b.x,p.y-(b.y-7))<23&&partyUnlocked(b));if(!b)return;e.stopImmediatePropagation();canvas.focus();goTo(b.x-18,b.y+10,()=>botTalk(b));},{capture:true});
renderParty();
