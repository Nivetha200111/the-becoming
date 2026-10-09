(function(root){
'use strict';
// Nivetha's Grok bots. Shared by the game (window.GameRoster) and the server (lib/roster.cjs must stay an exact copy).
// `home` is the world area a bot lives in; `regions`/`quests` say which claims level that bot up.
const BOTS=[
{id:'grok',name:'Grok Bot',role:'Day-to-day help and check-ins',home:'camp',stat:'FOCUS',quests:['human']},
{id:'bossman',name:'Bossman',role:'Runs the party: 06:58 lineup, 21:02 closeout, calendar blocks',home:'camp',stat:'FOCUS',leads:true},
{id:'carmen',name:'Carmen',role:'Current job and its projects',home:'citadel',stat:'LEVERAGE',regions:['citadel']},
{id:'jane',name:'Patrick Jane',role:'Life priorities, kept clear',home:'camp',stat:'FOCUS',regions:['camp']},
{id:'goggins',name:'Goggins',role:'Training and recovery from WHOOP data',home:'grove',stat:'END',regions:['grove']},
{id:'gilfoyle',name:'Gilfoyle',role:'Long-term career and engineering growth',home:'forge',stat:'BUILD',regions:['forge','summit']},
{id:'fletcher',name:'Fletcher',role:'SDE interview prep and LeetCode',home:'forge',stat:'INT',quests:['pattern','interview']},
{id:'beatrix',name:'Beatrix',role:'CCDF (Claude) certification prep',home:'temple',stat:'INT',regions:['temple']},
{id:'beth',name:'Beth Harmon',role:'ServiceNow certifications such as CIS-SPM',home:'tower',stat:'INT',regions:['tower']},
{id:'dexter',name:'Dexter',role:'Systems and tooling that remove recurring friction',home:'lab',stat:'BUILD',regions:['lab']},
{id:'eggbot',name:'dr eggbot',role:'Designs and hatches new bots',home:'camp',stat:'BUILD'}
];
// Group bots appear as places where their members meet.
const COUNCILS=[
{id:'war-room',name:'The War Room',role:'Weekly planning across work, career and certs',home:'camp',stat:'FOCUS',moderator:'jane',members:['jane','carmen','gilfoyle','fletcher','beatrix','beth']},
{id:'career-council',name:'Career Council',role:'Career decisions such as certs, ServiceNow vs SDE',home:'summit',stat:'LEVERAGE',members:['gilfoyle','fletcher','beth','beatrix']},
{id:'exam-bunker',name:'Exam Bunker',role:'Balances the cert workload between Beatrix and Beth',home:'tower',stat:'INT',members:['beatrix','beth']},
{id:'control-room',name:'Control Room',role:'Life admin: sleep, routines, errands, subscriptions',home:'camp',stat:'FOCUS',members:['grok','goggins','dexter']}
];
const ALL=[...BOTS,...COUNCILS],XP_STEPS=[20,40,60,100],LEVELS=[0,100,250,500,850,1300,1850,2500];
const norm=s=>String(s||'').toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,'');
function find(nameOrId){const n=norm(nameOrId);return n?ALL.find(b=>norm(b.id)===n||norm(b.name)===n)||null:null;}
// Which bot a claim belongs to: the bot that logged it, else the quest's or area's guide.
function owner(e){if(e&&e.bot&&find(e.bot))return find(e.bot).id;const q=BOTS.find(b=>b.quests&&b.quests.includes(e.questId));if(q)return q.id;const r=BOTS.find(b=>b.regions&&b.regions.includes(e.region));return r?r.id:'grok';}
function level(xp){let l=1;while(l<LEVELS.length&&xp>=LEVELS[l])l++;return {level:l,start:LEVELS[l-1],next:LEVELS[l]??null};}
// Bots level up from the claims they own; Bossman tracks the whole party; councils add their members' XP.
function stats(state){const out={};for(const b of ALL)out[b.id]={xp:0,claims:0,last:null};for(const e of state.entries){const o=out[owner(e)];o.xp+=e.xp;o.claims++;if(!o.last||e.date>o.last)o.last=e.date;}
 const total=state.entries.reduce((n,e)=>n+e.xp,0);out.bossman.xp=total;
 for(const c of COUNCILS)for(const m of c.members)out[c.id].xp+=out[m].xp;
 for(const id in out)Object.assign(out[id],level(out[id].xp));return out;}
function clampXp(v){const n=Number(v);if(!Number.isFinite(n))return 20;return XP_STEPS.filter(x=>x<=n).pop()||20;}
// A mission a bot posted in Notion, shaped like a quest so the quest log and claim dialog work unchanged.
function missionQuest(m){const b=find(m.bot)||find('grok');return {id:m.key,region:b.home,title:String(m.title).slice(0,120),detail:String(m.detail||'Mission from '+b.name+'.').slice(0,600),xp:clampXp(m.xp),stat:['INT','BUILD','FOCUS','END','LEVERAGE'].includes(m.stat)?m.stat:b.stat,repeat:false,unlock:1,bot:b.id,mission:true};}
const api={BOTS,COUNCILS,ALL,XP_STEPS,find,owner,level,stats,clampXp,missionQuest};
if(typeof module==='object'&&module.exports)module.exports=api;else root.GameRoster=api;
})(typeof window!=='undefined'?window:globalThis);
