import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import Engine from '../lib/engine.cjs';
import Roster from '../lib/roster.cjs';
import { syncParty,PARTY,rowRecord,applyCompletions,builtInQuests } from '../lib/party-sync.mjs';

const TOKEN='test-only-notion-token-0000',PARTY_DB='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',LOG_DB='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',TODAY='2026-10-09';
const env={NOTION_TOKEN:TOKEN,NOTION_PARTY_DATABASE_ID:PARTY_DB};
const txt=s=>[{type:'text',text:{content:s},plain_text:s}];

// Mock Notion: two databases, filters and sorts evaluated the way the real API does for the shapes we use.
function fakeNotion(){
 const pages=[];let seq=0;const calls=[];
 function matches(page,f){
  if(f.and)return f.and.every(x=>matches(page,x));if(f.or)return f.or.some(x=>matches(page,x));
  if(f.timestamp)return page[f.timestamp].slice(0,10)>=f[f.timestamp].on_or_after;
  const p=page.properties[f.property];
  if(f.select){const v=p?.select?.name||null;if('equals' in f.select)return v===f.select.equals;if(f.select.is_empty)return !v;}
  if(f.date){const v=p?.date?.start;return !!v&&v>=f.date.on_or_after;}
  if(f.rich_text?.is_not_empty)return (p?.rich_text||[]).some(r=>r.plain_text);
  throw Error('unsupported filter '+JSON.stringify(f));
 }
 const fill=props=>JSON.parse(JSON.stringify(props),(k,v)=>v&&v.type==='text'&&v.text?{...v,plain_text:v.text.content}:v);
 function add(source,props,created){const page={object:'page',id:'0000000000000000000000000000'+String(++seq).padStart(4,'0'),source,created_time:created||`${TODAY}T0${Math.min(9,seq%10)}:00:00.000Z`,in_trash:false,properties:fill(props)};page.last_edited_time=page.created_time;pages.push(page);return page;}
 // Notion rejects compound filters nested more than two levels deep.
 const depth=f=>f.and||f.or?1+Math.max(...(f.and||f.or).map(depth)):0;
 const fetcher=async(url,opts)=>{
  const path=url.replace('https://api.notion.com/v1','');const body=opts.body?JSON.parse(opts.body):undefined;calls.push({method:opts.method,path,body});
  assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
  const db=path.match(/^\/databases\/(\w+)$/);if(db)return Response.json({id:db[1],data_sources:[{id:'ds-'+db[1]}]});
  const q=path.match(/^\/data_sources\/ds-(\w+)\/query$/);
  if(q){assert(depth(body.filter)<=2,'filter nested too deeply for Notion');let list=pages.filter(p=>p.source===q[1]&&!p.in_trash&&matches(p,body.filter));const s=body.sorts?.[0];if(s)list.sort((a,b)=>(a.created_time<b.created_time?-1:a.created_time>b.created_time?1:0)*(s.direction==='descending'?-1:1));const start=Number(body.start_cursor||0),end=start+body.page_size;return Response.json({results:list.slice(start,end),has_more:end<list.length,next_cursor:end<list.length?String(end):null});}
  if(opts.method==='POST'&&path==='/pages')return Response.json(add(body.parent.data_source_id.slice(3),body.properties));
  const pg=path.match(/^\/pages\/(\w+)$/);
  if(opts.method==='PATCH'&&pg){const page=pages.find(p=>p.id===pg[1]);if(body.in_trash)page.in_trash=true;if(body.properties)Object.assign(page.properties,fill(body.properties));page.last_edited_time=`${TODAY}T12:00:00.000Z`;return Response.json(page);}
  return Response.json({code:'invalid_request_url'},{status:400});
 };
 const row=({name='',bot='Goggins',type='Completion',status,quest,stat,xp,details='',date,created})=>add(PARTY_DB,{[PARTY.title]:{title:txt(name)},[PARTY.bot]:{select:bot?{name:bot}:null},[PARTY.type]:{select:{name:type}},[PARTY.status]:{select:status?{name:status}:null},[PARTY.quest]:{rich_text:quest?txt(quest):[]},[PARTY.stat]:{select:stat?{name:stat}:null},[PARTY.xp]:{number:xp??null},[PARTY.details]:{rich_text:details?txt(details):[]},[PARTY.date]:{date:date?{start:date}:null},[PARTY.key]:{rich_text:[]},[PARTY.note]:{rich_text:[]}},created);
 const get=(page,prop)=>rowRecord(page)[prop];
 return {fetcher,pages,calls,row,get,writes:()=>calls.filter(c=>c.method==='PATCH'||c.method==='POST'&&c.path==='/pages')};
}
// In-memory save store with the same compare-and-swap contract as /api/state.
function fakeStore(state=Engine.fresh()){
 const s={revision:1,state:JSON.parse(JSON.stringify(state)),saves:0,interfere:null};
 s.load=async()=>({status:200,data:{revision:s.revision,state:JSON.parse(JSON.stringify(s.state))}});
 s.save=async body=>{if(s.interfere){const f=s.interfere;s.interfere=null;f(s);}if(body.expectedRevision!==s.revision)return {status:409,data:{revision:s.revision,state:s.state}};Engine.validate(body.state);s.state=JSON.parse(JSON.stringify(body.state));s.revision++;s.saves++;return {status:200,data:{revision:s.revision,state:s.state}};};
 return s;
}
const opts=n=>({fetcher:n.fetcher,sleep:async()=>{},today:TODAY});
const claim=(s,id,note='done',date=TODAY)=>Engine.award(s,builtInQuests().find(q=>q.id===id),note,date);

test('a bot-logged completion becomes exactly one entry with XP for you and the bot',async()=>{
 const n=fakeNotion(),store=fakeStore();const r=n.row({name:'Zone 2 walk, 35 min',bot:'Goggins',xp:75,details:'WHOOP strain 9.4, recovery 71%',date:TODAY});
 const out=await syncParty(env,opts(n),store);
 assert.equal(out.imported,1);assert.equal(out.revision,2);
 const [e]=store.state.entries;assert.equal(e.key,'party:'+r.id);assert.equal(e.bot,'goggins');assert.equal(e.xp,60,'free-form XP snaps down to an allowed step');assert.equal(e.stat,'END');assert.equal(e.note,'WHOOP strain 9.4, recovery 71%');
 assert.equal(n.get(r,'status'),'Counted');assert.equal(n.get(r,'key'),'party:'+r.id);
 assert.equal(Roster.stats(store.state).goggins.xp,60);assert.equal(Roster.stats(store.state)['control-room'].xp,60,'councils include their members');
 for(let i=0;i<3;i++){const again=await syncParty(env,opts(n),store);assert.equal(again.imported,0);}
 assert.equal(store.state.entries.length,1);assert.equal(store.saves,1);
});

test('a Quest ID never double-counts a quest you already claimed in the game',async()=>{
 const n=fakeNotion(),store=fakeStore(claim(Engine.fresh(),'train','ran 5k'));
 const dup=n.row({name:'Run',bot:'Goggins',quest:'train',details:'Strava 5k',date:TODAY});const fresh=n.row({name:'Focus',bot:'Patrick Jane',quest:'focus',details:'Deep work 9-9:25 on deck',date:TODAY});
 const out=await syncParty(env,opts(n),store);
 assert.equal(out.imported,1);assert.deepEqual(store.state.entries.map(e=>e.key).sort(),['focus:'+TODAY,'train:'+TODAY]);
 assert.equal(store.state.entries.find(e=>e.key==='focus:'+TODAY).bot,'jane');assert.equal(store.state.entries.find(e=>e.key==='focus:'+TODAY).xp,20,'quest XP comes from the game, not the bot');
 assert.equal(n.get(dup,'status'),'Counted');assert.match(rowRecord(dup).details,/Strava/);
 assert.equal(n.get(fresh,'status'),'Counted');
});

test('invalid bot entries are sent back with a reason and change nothing',async()=>{
 const n=fakeNotion(),store=fakeStore();
 const rows=[n.row({name:'x',bot:'Nobody',details:'e',date:TODAY}),n.row({name:'No proof',bot:'Fletcher',date:TODAY}),n.row({name:'Tomorrow',bot:'Fletcher',details:'e',date:'2026-10-10'}),n.row({name:'Old',bot:'Fletcher',details:'e',date:'2026-09-01'}),n.row({name:'Locked',bot:'Dexter',quest:'automation',details:'e',date:TODAY}),n.row({name:'Typo',bot:'Beth Harmon',quest:'spm-typo',details:'e',date:TODAY})];
 const out=await syncParty(env,opts(n),store);
 assert.equal(out.imported,0);assert.equal(out.rejected,6);assert.equal(store.saves,0);
 assert.deepEqual(rows.map(r=>n.get(r,'status')),Array(6).fill('Rejected'));
 assert.match(rowRecord(rows[0]).title,/x/);
 const notes=rows.map(r=>r.properties[PARTY.note].rich_text[0].plain_text);
 for(const [i,re] of [[0,/Unknown bot/],[1,/evidence/],[2,/future/],[3,/Older/],[4,/locked/],[5,/Unknown Quest ID/]])assert.match(notes[i],re);
});

test('a save conflict reloads, re-applies and keeps the other device’s progress',async()=>{
 const n=fakeNotion(),store=fakeStore();n.row({name:'Mock exam review',bot:'Beth Harmon',xp:40,stat:'INT',details:'Reviewed 12 errors',date:TODAY});
 store.interfere=s=>{claim(s.state,'focus');s.revision++;};
 const out=await syncParty(env,opts(n),store);
 assert.equal(out.imported,1);assert.equal(store.state.entries.length,2);assert.equal(out.revision,3);
});

test('undo in the game tells the bot, and the bot can re-send it',async()=>{
 const n=fakeNotion(),store=fakeStore();const r=n.row({name:'Ship fix',bot:'Carmen',xp:60,details:'PR merged',date:TODAY});
 await syncParty(env,opts(n),store);store.state.entries=[];store.revision++;
 await syncParty(env,opts(n),store);assert.equal(n.get(r,'status'),'Undone');assert.equal(store.state.entries.length,0);
 r.properties[PARTY.status]={select:{name:'New'}};
 const out=await syncParty(env,opts(n),store);assert.equal(out.imported,1);assert.equal(n.get(r,'status'),'Counted');
});

test('missions become quests; claiming marks them Done and undo reopens them',async()=>{
 const n=fakeNotion(),store=fakeStore();const m=n.row({name:'Two mediums, explained aloud',bot:'Fletcher',type:'Mission',xp:40,stat:'INT',details:'Record the pattern used.'});
 let out=await syncParty(env,opts(n),store);
 assert.equal(out.missions.length,1);assert.equal(n.get(m,'status'),'Open');
 const q=Roster.missionQuest(out.missions[0]);assert.equal(q.id,'party:'+m.id);assert.equal(q.bot,'fletcher');assert.equal(q.region,'forge');
 Engine.award(store.state,q,'Two Sum II and LRU cache',TODAY);store.revision++;
 out=await syncParty(env,opts(n),store);assert.equal(n.get(m,'status'),'Done');assert.equal(out.missions[0].done,true);
 assert.equal(store.state.entries[0].bot,'fletcher');
 store.state.entries=[];store.revision++;
 out=await syncParty(env,opts(n),store);assert.equal(n.get(m,'status'),'Open');
 n.row({name:'Cancelled one',bot:'Fletcher',type:'Mission',status:'Cancelled'});out=await syncParty(env,opts(n),store);assert.equal(out.missions.length,1);
});

test('check-ins arrive newest first and only from the last week',async()=>{
 const n=fakeNotion(),store=fakeStore();
 n.row({name:'06:58 lineup',bot:'Bossman',type:'Check-in',details:'Three priorities.',created:`${TODAY}T01:28:00.000Z`});
 n.row({name:'21:02 closeout',bot:'Bossman',type:'Check-in',details:'Two of three done.',created:`${TODAY}T15:32:00.000Z`});
 n.row({name:'Old',bot:'Bossman',type:'Check-in',details:'x',created:'2026-09-20T01:00:00.000Z'});
 n.row({name:'Weekly plan',bot:'The War Room',type:'Check-in',details:'Moderated by Patrick Jane.',created:`${TODAY}T10:00:00.000Z`});
 const out=await syncParty(env,opts(n),store);
 assert.deepEqual(out.checkins.map(c=>c.title),['21:02 closeout','Weekly plan','06:58 lineup']);assert.equal(out.checkins[1].bot,'war-room');
 assert.deepEqual(n.writes().map(w=>w.body.properties?.Type?.select?.name),['Scoreboard'],'reading check-ins writes nothing but the scoreboard');
});

test('large backlogs are processed in batches',async()=>{
 const n=fakeNotion(),store=fakeStore();for(let i=0;i<53;i++)n.row({name:'Task '+i,bot:'Control Room',details:'done',date:TODAY,created:`${TODAY}T00:${String(i).padStart(2,'0')}:00.000Z`});
 let out=await syncParty(env,opts(n),store);assert.equal(out.imported,50);assert.equal(out.pending,true);
 out=await syncParty(env,opts(n),store);assert.equal(out.imported,3);assert.equal(out.pending,false);
 assert.equal(store.state.entries.length,53);assert.equal(Roster.stats(store.state)['control-room'].claims,53);
});

test('bot-logged claims are mirrored to the Quest log with the bot attached',async()=>{
 const n=fakeNotion(),store=fakeStore();n.row({name:'Remove a manual step',bot:'Dexter',xp:100,details:'Cron replaces the weekly export',date:TODAY});
 await syncParty({...env,NOTION_DATABASE_ID:LOG_DB},opts(n),store);
 const log=n.pages.filter(p=>p.source===LOG_DB);assert.equal(log.length,1);assert.equal(log[0].properties.Bot.select.name,'Dexter');
});

test('local design mode and missing configuration never contact Notion or the save',async()=>{
 const forbidden={fetcher:()=>{throw Error('must not contact Notion');}},store={load:()=>{throw Error('no');},save:()=>{throw Error('no');}};
 assert.deepEqual(await syncParty({...env,NODE_ENV:'development',LOCAL_DESIGN_MODE:'true'},forbidden,store),{status:'local'});
 assert.deepEqual(await syncParty({NOTION_TOKEN:TOKEN},forbidden,store),{status:'unconfigured'});
});

test('roster: shared copy, ownership, councils and bot field validation',()=>{
 assert.equal(fs.readFileSync('public/game/roster.js','utf8'),fs.readFileSync('lib/roster.cjs','utf8'));
 assert.equal(Roster.BOTS.length+Roster.COUNCILS.length,15);
 for(const [name,id] of [['Grok Bot','grok'],['bossman','bossman'],['Patrick Jane','jane'],['The War Room','war-room'],['War Room','war-room'],['DR EGGBOT','eggbot'],['Beth Harmon','beth'],['Beth','beth'],['Carmy','carmen'],['Jane','jane']])assert.equal(Roster.find(name).id,id);
 const s=Engine.fresh();claim(s,'pattern');claim(s,'build');claim(s,'human');
 const st=Roster.stats(s);assert.equal(st.fletcher.xp,40);assert.equal(st.gilfoyle.xp,60);assert.equal(st.jane.xp,20,'life claims belong to the Life OS');assert.equal(st.grok.xp,0,'Grok Bot levels from what the party logs');assert.equal(st.bossman.xp,120);assert.equal(st['career-council'].xp,100);
 const bad=Engine.fresh();bad.entries.push({...s.entries[0],bot:{}});assert.throws(()=>Engine.validate(bad),/invalid quest entry/);
 const pure=applyCompletions(Engine.fresh(),[],builtInQuests(),TODAY);assert.equal(pure.added,0);
});

test('one scoreboard row tells the bots your level, XP and the next threshold',async()=>{
 const n=fakeNotion(),store=fakeStore(claim(claim(Engine.fresh(),'pattern','LC 20 Valid Parentheses'),'train','NORMAL day, 45 min'));
 await syncParty(env,opts(n),store);
 let boards=n.pages.filter(p=>!p.in_trash&&rowRecord(p).type==='Scoreboard');assert.equal(boards.length,1);
 const text=rowRecord(boards[0]).details;assert.match(text,/^Level 1 · 80 XP · next level at 500 XP \(420 to go\)/);assert.match(text,/Today 2026-10-09: 2 claims, 80 XP/);assert.match(text,/Fletcher L1/);assert.equal(rowRecord(boards[0]).bot,'Bossman');
 const before=n.writes().length;await syncParty(env,opts(n),store);assert.equal(n.writes().length,before,'unchanged numbers are not rewritten');
 claim(store.state,'ccdf-mock','Mock 2: 86%');store.revision++;n.row({name:'dup',bot:'Bossman',type:'Scoreboard'});
 await syncParty(env,opts(n),store);boards=n.pages.filter(p=>!p.in_trash&&rowRecord(p).type==='Scoreboard');
 assert.equal(boards.length,1);assert.match(rowRecord(boards[0]).details,/180 XP/);
});

test('new campaign quests resolve by Quest ID and the old IDs are unchanged',async()=>{
 const n=fakeNotion(),store=fakeStore();
 n.row({name:'Mock',bot:'Bea',quest:'ccdf-mock',details:'Mock 2: 84%, misses reviewed',date:TODAY});n.row({name:'Bed 23:20',bot:'Control Room',quest:'lights-out',details:'Lights out 23:20',date:TODAY});n.row({name:'SPM',bot:'Beth',quest:'spm',details:'Drill 15/20 cold, reread 2.5',date:TODAY});
 const out=await syncParty(env,opts(n),store);assert.equal(out.imported,3);
 assert.deepEqual(store.state.entries.map(e=>[e.key,e.xp,e.bot]),[['ccdf-mock:'+TODAY,100,'beatrix'],['lights-out:'+TODAY,20,'control-room'],['spm:'+TODAY,40,'beth']]);
 const ids=builtInQuests().map(q=>q.id);for(const id of ['focus','loop','human','pattern','build','forge-boss','client','case','citadel-boss','recover','train','spm','spm-errors','spm-boss','claude','claude-boss','automation','signal','interview'])assert(ids.includes(id),id);
 assert.equal(Roster.owner({questId:'lights-out',region:'camp'}),'control-room');
});
