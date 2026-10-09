// Live feed from Party HQ, the Notion database Nivetha's Grok bots write into.
// Exposes missions (as quests), check-ins and per-bot stats for the world, quest log and Party screens.
window.PartyFeed=(function(){
 const R=window.GameRoster,SEEN_KEY='nivetha-party-seen-v1',POLL_MS=180000;
 let missions=[],checkins=[],status='',busy=false,lastRun=0,failures=0,timer;const listeners=[];
 function say(s){status=s;const el=document.getElementById('partyStatus');if(el)el.textContent=s;}
 function seen(){try{return new Set(JSON.parse(localStorage.getItem(SEEN_KEY))||[]);}catch(e){return new Set();}}
 function remember(ids){try{localStorage.setItem(SEEN_KEY,JSON.stringify([...ids].slice(-200)));}catch(e){}}
 function apply(data){
  missions=(data.missions||[]).map(m=>Object.assign(R.missionQuest(m),{from:m.date,sample:!!m.sample}));
  checkins=(data.checkins||[]).filter(c=>R.find(c.bot));
  // Announce check-ins once per device, only fresh ones.
  const known=seen(),fresh=checkins.filter(c=>!known.has(c.id)&&Date.now()-Date.parse(c.at||c.date)<12*3600000);
  for(const c of checkins)known.add(c.id);remember(known);
  if(fresh.length&&typeof toast==='function')toast(fresh.length===1?`${R.find(fresh[0].bot).name}: ${fresh[0].title||fresh[0].message.slice(0,90)}`:`${fresh.length} new check-ins from your party.`);
  for(const fn of listeners)try{fn();}catch(e){}
  if(typeof update==='function')update();
 }
 async function poll(force){
  if(busy||!force&&Date.now()-lastRun<60000)return;busy=true;lastRun=Date.now();clearTimeout(timer);let again=0;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),65000);
  try{const r=await fetch('/api/party',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});let data={};try{data=await r.json();}catch(e){}
   if(!r.ok)throw Error(data.error);failures=0;
   if(data.status==='unconfigured'){say('Party HQ not set up');return;}
   apply(data);
   if(data.imported){window.CloudSave&&CloudSave.refresh();typeof toast==='function'&&toast(`Your party logged ${data.imported} completion${data.imported===1?'':'s'} ✦ XP counted.`);}
   if(data.pending)again=3000;
   say(`Party HQ synced${data.rejected?` · ${data.rejected} entr${data.rejected===1?'y':'ies'} sent back`:''}`);
  }catch(e){failures++;again=Math.min(600000,30000*2**Math.min(failures-1,4));say('Party HQ paused · will retry');}
  finally{clearTimeout(timeout);busy=false;}
  if(again)timer=setTimeout(()=>poll(true),again);
 }
 // Local design mode never contacts Notion; it shows a labelled sample so the party can be designed.
 const SAMPLE={missions:[{key:'party:sample-fletcher',bot:'fletcher',title:'LC 20 Valid Parentheses in Java',detail:'Sample mission (local design only). Lunch slot, stacks first. Record the pattern and one edge case.',xp:40,stat:'INT',sample:true},{key:'party:sample-beatrix',bot:'beatrix',title:'CCDF mock under exam conditions',detail:'Sample mission (local design only). Timed, without notes; review every miss against the docs.',xp:60,stat:'INT',sample:true}],
  checkins:[{id:'sample-bossman',bot:'bossman',title:'Lineup',message:'Sample check-in. Three priorities: one CCDF block with Beatrix, lunch LeetCode with Fletcher, and today\'s WHOOP call with Goggins.',date:'',at:''},{id:'sample-goggins',bot:'goggins',title:'NORMAL',message:'Sample check-in. Recovery is fine: one hour of cardio, one hour of strength.',date:'',at:''}]};
 function init(){
  if(window.LOCAL_DESIGN_MODE){say('Party HQ sample · local design');apply(SAMPLE);return;}
  poll(true);setInterval(()=>{if(document.visibilityState==='visible')poll();},POLL_MS);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
 }
 document.addEventListener('DOMContentLoaded',init);
 return {roster:R,missions:()=>missions,checkins:()=>checkins,latest:id=>checkins.find(c=>c.bot===id)||null,stats:state=>R.stats(state),status:()=>status,refresh:()=>poll(true),onChange(fn){listeners.push(fn);}};
})();
