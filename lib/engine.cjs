(function(root){
'use strict';
const thresholds=[0,500,1000,1750,2500,3250,4000];
const stats=['INT','BUILD','FOCUS','END','LEVERAGE'];
function day(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function fresh(){return {version:1,entries:[],custom:[],purchases:[],rewards:[],equipped:'sage',mode:'normal',position:{x:555,y:380},seenIntro:false};}
function total(s){return s.entries.reduce((n,e)=>n+e.xp,0);}
function level(xp){for(let i=0;i<thresholds.length-1;i++)if(xp<thresholds[i+1])return i+1;return 7+Math.floor((xp-4000)/750);}
function bounds(xp){let l=level(xp);return {level:l,start:l<=7?thresholds[l-1]:4000+(l-7)*750,next:l<7?thresholds[l]:4000+(l-6)*750};}
function coins(s){return s.entries.reduce((n,e)=>n+Math.floor(e.xp/10),0)-s.purchases.reduce((n,e)=>n+e.cost,0);}
// Gold is the real-life reward currency. Like coins it is derived from claimed quests and never stored, so it cannot drift.
// A claim earns 40 gold per XP (boss battles x1.5), plus 5% for every day of an unbroken claiming streak (up to +50%).
// The 40 LPA job offer is a once-in-a-lifetime milestone: it adds 1,500,000 gold and unseals the Mythic tier.
const GOLD_PER_XP=40,MILESTONE='offer-40lpa',MILESTONE_GOLD=1500000;
const TIERS=[
 {id:'common',name:'Common',level:1,items:[['monster','A new Monster flavour','🥤',15000],['coffee','Vietnamese cold coffee','☕',15000],['cocoa','Premium hot chocolate','🍫',18000],['ramen','Korean ramen','🍜',20000],['chocolates','Premium chocolates','🍬',20000],['book','A new book','📚',25000],['kdrama','K-drama snack box','🍿',30000]]},
 {id:'rare',name:'Rare',level:2,items:[['iem','IEM earphones','🎧',100000],['desk-acc','Desk accessories','🖥️',100000],['gym-acc','Gym accessories','💪',110000],['tech-acc','Premium tech accessories','🔌',120000],['workout-fit','New workout outfit','🏋️',140000],['run-gear','New running gear','🏃‍♀️',150000],['book-spree','Book shopping spree','📖',160000]]},
 {id:'epic',name:'Epic',level:4,items:[['gaming-acc','Gaming accessories','🎮',350000],['nc-earbuds','Noise-cancelling earbuds','🎧',400000],['mech-kb','Mechanical keyboard','⌨️',450000],['run-shoes','Premium running shoes','👟',450000],['fitness-eq','Fitness equipment','🏋️',500000],['headphones','Premium headphones','🎵',550000],['desk-setup','Desk setup upgrade','💻',600000]]},
 {id:'legendary',name:'Legendary',level:6,items:[['shokz','SHOKZ OpenRun Pro headphones','🎧',1200000],['hi-kb','High-end mechanical keyboard','⌨️',1300000],['smartwatch','Premium fitness smartwatch','⌚',1500000],['monitor','Premium monitor','🖥️',1800000],['console','Gaming console','🎮',2000000],['workstation','Complete coding workstation upgrade','💻',2500000]]},
 {id:'mythic',name:'Mythic',milestone:MILESTONE,items:[['gadget','Premium tech gadget of choice','✨',3000000],['macbook','MacBook upgrade','💻',4000000],['gaming-pc','Dream gaming PC','🖥️',5000000],['home-office','Ultimate home office setup','🚀',5000000]]}
].map(t=>({...t,items:t.items.map(([id,name,icon,cost])=>({id,name,icon,cost,tier:t.id}))}));
const REWARDS=Object.fromEntries(TIERS.flatMap(t=>t.items.map(i=>[i.id,i])));
function shift(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function claimDays(s){return new Set(s.entries.map(e=>e.date));}
function streakAt(days,date){let n=0;while(days.has(date)){n++;date=shift(date,-1);}return n;}
function streak(s,date=day()){const days=claimDays(s);return streakAt(days,date)||streakAt(days,shift(date,-1));}
function streakBonus(n){return Math.min(Math.max(n-1,0),10)*.05;}
function questGold(q,streakDays=1){return Math.round(q.xp*GOLD_PER_XP*(q.boss?1.5:1)*(1+streakBonus(streakDays)))+((q.questId||q.id)===MILESTONE?MILESTONE_GOLD:0);}
function goldEarned(s){const days=claimDays(s);return s.entries.reduce((n,e)=>n+questGold(e,streakAt(days,e.date)),0);}
function gold(s){return goldEarned(s)-(s.rewards||[]).reduce((n,r)=>n+r.cost,0);}
function tierOpen(s,t){t=typeof t==='string'?TIERS.find(x=>x.id===t):t;return t.milestone?s.entries.some(e=>e.questId===t.milestone):level(total(s))>=t.level;}
function redeem(s,id,date=day()){const r=REWARDS[id];if(!r)throw Error('Unknown reward.');if(!tierOpen(s,r.tier))throw Error(r.tier==='mythic'?'The Mythic tier opens with the 40 LPA offer.':'This tier is still locked.');if(gold(s)<r.cost)throw Error('Not enough gold yet.');(s.rewards||=[]).push({id:'rw-'+date+'-'+Math.random().toString(36).slice(2,10),item:id,cost:r.cost,date});return s;}
function statTotals(s){return Object.fromEntries(stats.map(k=>[k,s.entries.filter(e=>e.stat===k).reduce((n,e)=>n+e.xp,0)]));}
function key(q,date=day()){return q.repeat?q.id+':'+date:q.id;}
function completed(s,q,date=day()){return s.entries.some(e=>e.key===key(q,date));}
function award(s,q,note,date=day()){if(completed(s,q,date))throw Error('This quest has already been claimed.');if(!note.trim())throw Error('Add a short completion note first.');if(level(total(s))<(q.unlock||1))throw Error('This area is still locked.');s.entries.push({key:key(q,date),questId:q.id,title:q.title,stat:q.stat,xp:q.xp,note:note.trim().slice(0,2000),date,region:q.region,boss:!!q.boss,...(q.bot?{bot:String(q.bot).slice(0,40)}:{})});return s;}
function validate(s){if(!s||s.version!==1||!Array.isArray(s.entries)||s.entries.length>10000||!Array.isArray(s.custom)||s.custom.length>500||!Array.isArray(s.purchases))throw Error('That file is not a valid game save.');const keys=new Set();for(const e of s.entries){if(!e||typeof e.key!=='string'||keys.has(e.key)||!Number.isInteger(e.xp)||e.xp<0||e.xp>250||!stats.includes(e.stat)||typeof e.title!=='string'||typeof e.note!=='string'||e.bot!==undefined&&(typeof e.bot!=='string'||e.bot.length>40)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date))throw Error('The save contains an invalid quest entry.');keys.add(e.key);}for(const q of s.custom)if(!q||typeof q.id!=='string'||!q.id.startsWith('custom-')||typeof q.title!=='string'||!stats.includes(q.stat)||![20,40,60,100,250].includes(q.xp)||!['camp','forge','citadel','grove','tower','temple','lab','summit'].includes(q.region)||!Number.isInteger(q.unlock)||q.unlock<1||q.unlock>5||typeof q.detail!=='string'||typeof q.repeat!=='boolean')throw Error('The save contains an invalid custom quest.');const purchased=new Set();for(const p of s.purchases){if(!p||!['ember','midnight','rose'].includes(p.id)||purchased.has(p.id)||p.cost!==({ember:30,midnight:60,rose:90})[p.id])throw Error('Invalid reward purchase.');purchased.add(p.id);}if(coins(s)<0)throw Error('Invalid coin balance.');if(!['sage','ember','midnight','rose'].includes(s.equipped)||s.equipped!=='sage'&&!purchased.has(s.equipped))throw Error('Invalid equipped cloak.');if(s.rewards===undefined)s.rewards=[];if(!Array.isArray(s.rewards)||s.rewards.length>5000)throw Error('Invalid real-life rewards.');const rid=new Set();for(const r of s.rewards){if(!r||typeof r.id!=='string'||r.id.length>60||rid.has(r.id)||!REWARDS[r.item]||r.cost!==REWARDS[r.item].cost||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))throw Error('Invalid real-life reward.');rid.add(r.id);}if(!['normal','recovery'].includes(s.mode))throw Error('Invalid play mode.');if(!s.position||!Number.isFinite(s.position.x)||!Number.isFinite(s.position.y)||s.position.x<40||s.position.x>1060||s.position.y<40||s.position.y>690)s.position={x:555,y:380};return s;}
const api={day,fresh,total,level,bounds,coins,statTotals,key,completed,award,validate,stats,GOLD_PER_XP,MILESTONE,MILESTONE_GOLD,TIERS,REWARDS,streak,streakBonus,questGold,goldEarned,gold,tierOpen,redeem};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GameEngine=api;
})(typeof window!=='undefined'?window:globalThis);
