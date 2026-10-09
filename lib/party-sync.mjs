import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import Engine from './engine.cjs';
import Roster from './roster.cjs';
import { localDesignMode } from './auth.mjs';
import { savedState } from './save-store.mjs';
import { notionClient,resolveSource,validId,rich,plain,text,NotionError,reconcile,notionConfigured } from './notion-sync.mjs';

// Party HQ: the Notion database Nivetha's Grok bots write into.
//   Completion -> becomes a real quest entry (her XP + the bot's XP), counted once.
//   Mission    -> shows in the game's quest log; claiming it marks the row Done.
//   Check-in   -> shown in the game as that bot's latest message.
export const PARTY={title:'Name',bot:'Bot',type:'Type',status:'Status',quest:'Quest ID',stat:'Stat',xp:'XP',details:'Details',date:'Date',key:'Game key',note:'Game note'};
export const PARTY_SCHEMA={[PARTY.title]:'title',[PARTY.bot]:'select',[PARTY.type]:'select',[PARTY.status]:'select',[PARTY.quest]:'rich_text',[PARTY.stat]:'select',[PARTY.xp]:'number',[PARTY.details]:'rich_text',[PARTY.date]:'date',[PARTY.key]:'rich_text',[PARTY.note]:'rich_text'};
export const TYPES=['Completion','Mission','Check-in'];
export const STATUSES=['New','Open','Counted','Done','Rejected','Undone','Cancelled'];
const STATS=['INT','BUILD','FOCUS','END','LEVERAGE'];
const BACKDATE_DAYS=14,UNDO_WINDOW_DAYS=30,MISSION_DONE_DAYS=14,CHECKIN_DAYS=7,IMPORT_BATCH=50;

export function partyConfigured(env=process.env){return typeof env.NOTION_TOKEN==='string'&&env.NOTION_TOKEN.length>=20&&validId(env.NOTION_PARTY_DATABASE_ID);}

let questCache;
// The built-in quest list lives in the browser script; read it once so Quest IDs resolve exactly as in the game.
export function builtInQuests(){if(!questCache){const sandbox={window:{}};vm.runInNewContext(readFileSync(join(process.cwd(),'public/game/data.js'),'utf8'),sandbox);questCache=sandbox.window.QUESTS;}return questCache;}

export function addDays(date,n){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);}
export function rowRecord(page){const p=page.properties||{};return {id:page.id,rowId:page.id.replace(/-/g,''),created:page.created_time||'',title:plain(p[PARTY.title]?.title).trim(),bot:p[PARTY.bot]?.select?.name||'',type:p[PARTY.type]?.select?.name||'',status:p[PARTY.status]?.select?.name||'',questId:plain(p[PARTY.quest]?.rich_text).trim(),stat:p[PARTY.stat]?.select?.name||'',xp:p[PARTY.xp]?.number??null,details:text(plain(p[PARTY.details]?.rich_text)).trim(),date:(p[PARTY.date]?.date?.start||'').slice(0,10),key:plain(p[PARTY.key]?.rich_text).trim()};}
export const rowKey=row=>'party:'+row.rowId;

class Rejection extends Error{}
// Turns a bot's Completion row into the quest + date + note the engine awards. Throws Rejection with a reason the bot can read.
export function rowToClaim(row,state,quests,today){
 const bot=Roster.find(row.bot);if(!bot)throw new Rejection('Unknown bot. Use a name from the roster.');
 const date=row.date||row.created.slice(0,10)||today;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Rejection('Date is not valid.');
 if(date>today)throw new Rejection('Date is in the future.');
 if(date<addDays(today,-BACKDATE_DAYS))throw new Rejection(`Older than ${BACKDATE_DAYS} days.`);
 if(!row.details)throw new Rejection('Add the evidence in Details.');
 if(row.questId){const base=[...quests,...state.custom].find(q=>q.id===row.questId);if(!base)throw new Rejection('Unknown Quest ID.');return {q:{...base,bot:bot.id},date,note:row.details};}
 if(!row.title)throw new Rejection('Add a Name describing what was done.');
 return {q:{id:rowKey(row),region:bot.home,title:row.title.slice(0,120),xp:Roster.clampXp(row.xp),stat:STATS.includes(row.stat)?row.stat:bot.stat,repeat:false,unlock:1,bot:bot.id},date,note:row.details};
}

// Applies pending Completion rows to a save. Pure: returns the new state and what to write back to each row.
export function applyCompletions(state,rows,quests,today){
 const next=Engine.validate(JSON.parse(JSON.stringify(state)));const marks=new Map();let added=0;
 for(const row of rows){
  try{const c=rowToClaim(row,next,quests,today);const key=Engine.key(c.q,c.date);
   if(next.entries.some(e=>e.key===key)){marks.set(row.id,{status:'Counted',key,note:'Already counted in the game.'});continue;}
   Engine.award(next,c.q,c.note,c.date);added++;marks.set(row.id,{status:'Counted',key,note:`+${c.q.xp} ${c.q.stat} XP on ${c.date}.`});}
  catch(e){marks.set(row.id,{status:'Rejected',note:String(e.message).slice(0,300)});}
 }
 if(added)Engine.validate(next);return {state:next,added,marks};
}

const sel=(name,equals)=>({property:name,select:{equals}});
async function query(client,source,filter,{sorts,limit=Infinity}={}){
 const rows=[];let cursor,more=false;
 do{const r=await client.call('POST','/data_sources/'+source+'/query',{filter,...(sorts?{sorts}:{}),page_size:Math.min(100,limit-rows.length),...(cursor?{start_cursor:cursor}:{})});for(const page of r.results||[])if(page.object==='page'&&!page.in_trash&&!page.archived)rows.push(rowRecord(page));cursor=r.has_more?r.next_cursor:null;more=!!cursor;}while(cursor&&rows.length<limit);
 return {rows,more};
}
const mark=(client,id,status,key,note)=>client.call('PATCH','/pages/'+id,{properties:{[PARTY.status]:{select:{name:status}},...(key!==undefined?{[PARTY.key]:{rich_text:rich(key)}}:{}),...(note!==undefined?{[PARTY.note]:{rich_text:rich(note)}}:{})}});

let queue=Promise.resolve();
const defaultStore=env=>({load:()=>savedState('GET',undefined,env),save:body=>savedState('POST',body,env)});
export function syncParty(env=process.env,options={},store=defaultStore(env)){
 if(localDesignMode(env))return Promise.resolve({status:'local'});
 if(!partyConfigured(env))return Promise.resolve({status:'unconfigured'});
 const run=queue.then(()=>partyRun(env,options,store));queue=run.catch(()=>{});return run;
}

async function partyRun(env,options,store){
 const client=notionClient(env,options),today=options.today||Engine.day(),quests=options.quests||builtInQuests();
 const source=await resolveSource(client,env.NOTION_PARTY_DATABASE_ID.replace(/-/g,''),env.NOTION_PARTY_DATA_SOURCE_ID,'NOTION_PARTY_DATA_SOURCE_ID');
 const result={status:'synced',imported:0,rejected:0,pending:false,missions:[],checkins:[]};

 // 1. Completions the bots logged that the game hasn't processed yet, oldest first.
 const pending=await query(client,source,{and:[sel(PARTY.type,'Completion'),{or:[{property:PARTY.status,select:{is_empty:true}},sel(PARTY.status,'New')]}]},{sorts:[{timestamp:'created_time',direction:'ascending'}],limit:IMPORT_BATCH});
 result.pending=pending.more;

 // 2. Add them to the authoritative save with compare-and-swap; on a conflict reload and re-apply.
 let state=null,marks=new Map();
 for(let attempt=1;;attempt++){
  const r=await store.load();if(r.status!==200)throw new NotionError('Cloud save is unavailable.',503);
  if(!r.data?.state){state=null;break;} // Nothing saved yet: leave the rows waiting.
  const applied=applyCompletions(r.data.state,pending.rows,quests,today);state=applied.state;marks=applied.marks;result.revision=r.data.revision;
  if(!applied.added)break;
  const w=await store.save({expectedRevision:r.data.revision,state});
  if(w.status===200){result.revision=w.data.revision;result.imported=applied.added;break;}
  if(w.status!==409||attempt>=4)throw new NotionError('The save kept changing. Party sync will retry.',503);
 }
 // Rows are marked only after the save succeeded. If marking fails, the next run finds the key already saved and marks it then.
 for(const row of pending.rows){const m=marks.get(row.id);if(!m)continue;if(m.status==='Rejected')result.rejected++;await mark(client,row.id,m.status,m.key,m.note);}
 const keys=new Set(state?state.entries.map(e=>e.key):[]);

 // 3. Completions undone in the game go back to the bot as Undone.
 if(state){const counted=await query(client,source,{and:[sel(PARTY.type,'Completion'),sel(PARTY.status,'Counted'),{property:PARTY.date,date:{on_or_after:addDays(today,-UNDO_WINDOW_DAYS)}}]},{limit:200});
  for(const row of counted.rows)if(row.key&&!keys.has(row.key))await mark(client,row.id,'Undone',undefined,'Undone in the game.');}

 // 4. Missions: open ones, plus recently finished ones so the game can still show them as done.
 const missions=await query(client,source,{or:[{property:PARTY.status,select:{is_empty:true}},sel(PARTY.status,'New'),sel(PARTY.status,'Open')].map(s=>({and:[sel(PARTY.type,'Mission'),s]})).concat({and:[sel(PARTY.type,'Mission'),sel(PARTY.status,'Done'),{timestamp:'last_edited_time',last_edited_time:{on_or_after:addDays(today,-MISSION_DONE_DAYS)}}]})},{sorts:[{timestamp:'created_time',direction:'ascending'}],limit:100});
 for(const row of missions.rows){
  if(row.status==='Cancelled'||row.status==='Rejected')continue;
  const bot=Roster.find(row.bot);if(!bot||!row.title){await mark(client,row.id,'Rejected',undefined,bot?'Add a Name for the mission.':'Unknown bot. Use a name from the roster.');continue;}
  const key=rowKey(row),done=keys.has(key),want=done?'Done':'Open';
  if(state&&row.status!==want)await mark(client,row.id,want,key,done?'Claimed in the game.':undefined);
  result.missions.push({key,bot:bot.id,title:row.title,detail:row.details,xp:Roster.clampXp(row.xp),stat:STATS.includes(row.stat)?row.stat:bot.stat,date:row.date||row.created.slice(0,10),done});
 }

 // 5. Recent check-ins, newest first.
 const checkins=await query(client,source,{and:[sel(PARTY.type,'Check-in'),{timestamp:'created_time',created_time:{on_or_after:addDays(today,-CHECKIN_DAYS)}}]},{sorts:[{timestamp:'created_time',direction:'descending'}],limit:30});
 for(const row of checkins.rows){const bot=Roster.find(row.bot);if(bot)result.checkins.push({id:row.rowId,bot:bot.id,title:row.title,message:row.details.slice(0,1200),date:row.date||row.created.slice(0,10),at:row.created});}

 // 6. Bot-logged claims also belong in the Quest log mirror. Best effort; the browser's own trigger retries.
 if(result.imported&&notionConfigured(env)){try{await reconcile(state.entries,env,options);}catch(e){}}
 return result;
}
