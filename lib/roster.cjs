(function(root){
'use strict';
// Nivetha's Grok bots. Shared by the game (window.GameRoster) and the server (lib/roster.cjs must stay an exact copy).
// Roles follow each bot's charter (one job, explicit anti-jobs). Every bot follows the bot protocol on the
// NIVETHA LIFE OS Notion page; Bossman relays between them in the morning lineup and evening closeout.
// `home` is the world area a bot lives in; `regions`/`quests` say which claims level that bot up.
const BOTS=[
{id:'grok',name:'Grok Bot',aliases:['Grok'],role:'Main bot: routes tasks to the party and manages it',home:'camp',stat:'FOCUS',routes:true},
{id:'bossman',name:'Bossman',role:'Runs the bots: morning lineup, evening closeout, calendar blocks, charter checks',home:'camp',stat:'FOCUS',leads:true},
{id:'carmen',name:'Carmen',aliases:['Carmy'],role:'Work OS: projects, deadlines, demos, blockers, follow-ups',home:'citadel',stat:'LEVERAGE',regions:['citadel']},
{id:'jane',name:'Patrick Jane',aliases:['Jane'],role:'Life OS: personal tasks, attention, open loops, decisions',home:'camp',stat:'FOCUS',regions:['camp'],antiJobs:['career advice']},
{id:'goggins',name:'Goggins',role:'Training and recovery OS: daily WHOOP call of PUSH, NORMAL, LIGHT or RECOVER',home:'grove',stat:'END',regions:['grove']},
{id:'gilfoyle',name:'Gilfoyle',role:'Career OS: long-term strategy, skills, leverage, certs, achievements',home:'forge',stat:'BUILD',regions:['forge','summit'],antiJobs:['interview prep']},
{id:'fletcher',name:'Fletcher',role:'Interview prep: Java DSA, mocks and builds for SDE applications',home:'forge',stat:'INT',quests:['pattern','interview'],createdBy:'eggbot'},
{id:'beatrix',name:'Beatrix',aliases:['Bea'],role:'CCDF (Claude Certified Developer Foundations) prep',home:'temple',stat:'INT',regions:['temple']},
{id:'beth',name:'Beth Harmon',aliases:['Beth'],role:'ServiceNow CIS-SPM prep, test-first',home:'tower',stat:'INT',regions:['tower']},
{id:'dexter',name:'Dexter',role:'Systems OS: automation, subscriptions, devices, admin loops',home:'lab',stat:'BUILD',regions:['lab']},
{id:'eggbot',name:'dr eggbot',aliases:['eggbot','egg bot'],role:'Bot designer: one job and explicit anti-jobs per bot',home:'camp',stat:'BUILD'}
];
// Group chats appear as places where their members meet.
const COUNCILS=[
{id:'war-room',name:'The War Room',role:'Weekly planning across work, career and certs',home:'camp',stat:'FOCUS',moderator:'jane',members:['jane','carmen','gilfoyle','fletcher','beatrix','beth']},
{id:'career-council',name:'Career Council',role:'Career decisions: certs, ServiceNow vs SDE, resume-worthy work, exam priority',home:'summit',stat:'LEVERAGE',members:['gilfoyle','fletcher','beatrix','beth']},
{id:'exam-bunker',name:'Exam Bunker',role:'Balances study time between certs; Gilfoyle decides by career ROI and deadlines',home:'tower',stat:'INT',moderator:'gilfoyle',members:['gilfoyle','beatrix','beth']},
{id:'control-room',name:'Control Room',role:'Life system: sleep and recovery, routines, errands, devices, subscriptions',home:'camp',stat:'END',members:['jane','goggins','dexter'],quests:['lights-out']}
];
const ALL=[...BOTS,...COUNCILS],XP_STEPS=[20,40,60,100],LEVELS=[0,100,250,500,850,1300,1850,2500];
const norm=s=>String(s||'').toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,'');
function find(nameOrId){const n=norm(nameOrId);return n?ALL.find(b=>[b.id,b.name,...(b.aliases||[])].some(x=>norm(x)===n))||null:null;}
// Which bot a claim belongs to: the bot that logged it, else the quest's or area's owner, else the Life OS.
function owner(e){if(e&&e.bot&&find(e.bot))return find(e.bot).id;const q=ALL.find(b=>b.quests&&b.quests.includes(e.questId));if(q)return q.id;const r=BOTS.find(b=>b.regions&&b.regions.includes(e.region));return r?r.id:'jane';}
function level(xp){let l=1;while(l<LEVELS.length&&xp>=LEVELS[l])l++;return {level:l,start:LEVELS[l-1],next:LEVELS[l]??null};}
// Bots level up from the claims they own. Bossman tracks the whole party, Grok Bot everything the party
// logged for you, and each council its members plus its own claims.
function stats(state){const out={};for(const b of ALL)out[b.id]={xp:0,claims:0,last:null};for(const e of state.entries){const o=out[owner(e)];o.xp+=e.xp;o.claims++;if(!o.last||e.date>o.last)o.last=e.date;}
 out.bossman.xp=state.entries.reduce((n,e)=>n+e.xp,0);
 out.grok.xp=state.entries.filter(e=>e.bot&&find(e.bot)).reduce((n,e)=>n+e.xp,0);
 for(const c of COUNCILS)for(const m of c.members)out[c.id].xp+=out[m].xp;
 for(const id in out)Object.assign(out[id],level(out[id].xp));return out;}
function clampXp(v){const n=Number(v);if(!Number.isFinite(n))return 20;return XP_STEPS.filter(x=>x<=n).pop()||20;}
// A mission a bot posted in Notion, shaped like a quest so the quest log and claim dialog work unchanged.
function missionQuest(m){const b=find(m.bot)||find('grok');return {id:m.key,region:b.home,title:String(m.title).slice(0,120),detail:String(m.detail||'Mission from '+b.name+'.').slice(0,600),xp:clampXp(m.xp),stat:['INT','BUILD','FOCUS','END','LEVERAGE'].includes(m.stat)?m.stat:b.stat,repeat:false,unlock:1,bot:b.id,mission:true};}
const api={BOTS,COUNCILS,ALL,XP_STEPS,find,owner,level,stats,clampXp,missionQuest};
if(typeof module==='object'&&module.exports)module.exports=api;else root.GameRoster=api;
})(typeof window!=='undefined'?window:globalThis);
