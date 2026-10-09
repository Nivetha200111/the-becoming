import { localDesignMode } from './auth.mjs';
import { savedState } from './save-store.mjs';
import Engine from './engine.cjs';

// One-way sync: saved quest entries -> one Notion page per entry key.
// The Notion database is a mirror. It never writes back into the game save.
export const NOTION_VERSION='2025-09-03';
const API='https://api.notion.com/v1';
export const PROPS={title:'Quest',key:'Entry key',date:'Date',stat:'Stat',xp:'XP',note:'Evidence'};
export const SCHEMA={[PROPS.title]:'title',[PROPS.key]:'rich_text',[PROPS.date]:'date',[PROPS.stat]:'select',[PROPS.xp]:'number',[PROPS.note]:'rich_text'};
const STATS=['INT','BUILD','FOCUS','END','LEVERAGE'];

export function notionConfigured(env=process.env){return typeof env.NOTION_TOKEN==='string'&&env.NOTION_TOKEN.length>=20&&typeof env.NOTION_DATABASE_ID==='string'&&/^[0-9a-f]{32}$/i.test(env.NOTION_DATABASE_ID.replace(/-/g,''));}

const text=s=>String(s??'').replace(/\r\n?/g,'\n');
// Notion caps each rich_text object at 2000 characters; engine notes are already capped at 2000.
const rich=s=>{const t=text(s);const out=[];for(let i=0;i<t.length;i+=2000)out.push({type:'text',text:{content:t.slice(i,i+2000)}});return out;};
const plain=list=>Array.isArray(list)?list.map(r=>r.plain_text??r.text?.content??'').join(''):'';

export function fingerprint(e){return JSON.stringify([text(e.title),e.date,e.stat,e.xp,text(e.note)]);}
export function entryProperties(e){return {[PROPS.title]:{title:rich(e.title)},[PROPS.key]:{rich_text:rich(e.key)},[PROPS.date]:{date:{start:e.date}},[PROPS.stat]:{select:{name:e.stat}},[PROPS.xp]:{number:e.xp},[PROPS.note]:{rich_text:rich(e.note)}};}
export function pageRecord(page){const p=page.properties||{};return {id:page.id,created:page.created_time||'',key:plain(p[PROPS.key]?.rich_text),fingerprint:JSON.stringify([plain(p[PROPS.title]?.title),p[PROPS.date]?.date?.start??null,p[PROPS.stat]?.select?.name??null,p[PROPS.xp]?.number??null,plain(p[PROPS.note]?.rich_text)])};}

// Every device must pick the same survivor among duplicates, so order is total:
// earliest created_time first, then page id.
const canonicalOrder=(a,b)=>a.created<b.created?-1:a.created>b.created?1:a.id<b.id?-1:a.id>b.id?1:0;

// Pure diff between the saved entries and the active Notion pages that carry an entry key.
export function planSync(entries,pages){
 const byKey=new Map();for(const p of pages){if(!p.key)continue;if(!byKey.has(p.key))byKey.set(p.key,[]);byKey.get(p.key).push(p);}
 const wanted=new Map(entries.map(e=>[e.key,e]));const plan={create:[],update:[],archive:[]};
 for(const [key,group] of byKey){group.sort(canonicalOrder);const [keep,...extra]=group;for(const p of extra)plan.archive.push({id:p.id,key,reason:'duplicate'});const e=wanted.get(key);if(!e)plan.archive.push({id:keep.id,key,reason:'removed'});else if(keep.fingerprint!==fingerprint(e))plan.update.push({id:keep.id,entry:e});}
 for(const [key,e] of wanted)if(!byKey.has(key))plan.create.push(e);
 return plan;
}

export class NotionError extends Error{constructor(message,status){super(message);this.status=status;}}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

export function notionClient(env=process.env,{fetcher=fetch,sleep=wait,attempts=4}={}){
 async function call(method,path,body){
  for(let attempt=1;;attempt++){
   let response;
   try{response=await fetcher(API+path,{method,headers:{Authorization:'Bearer '+env.NOTION_TOKEN,'Notion-Version':NOTION_VERSION,'Content-Type':'application/json',Accept:'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});}
   catch(e){if(attempt<attempts){await sleep(1000*attempt);continue;}throw new NotionError('Notion is unreachable.',503);}
   if(response.ok)return response.json();
   if((response.status===429||response.status>=500)&&attempt<attempts){const after=Number(response.headers.get('Retry-After'));await sleep(Number.isFinite(after)&&after>0?Math.min(after,30)*1000:1000*2**(attempt-1));continue;}
   let detail={};try{detail=await response.json();}catch(e){}
   // Only Notion's error code and message are surfaced; request headers (the token) never are.
   if(response.status===401)throw new NotionError('Notion rejected the integration token.',401);
   if(response.status===404||detail.code==='object_not_found')throw new NotionError('Notion database not found. Share it with the integration.',404);
   if(detail.code==='validation_error')throw new NotionError('Notion database properties need attention: '+String(detail.message||'').slice(0,200),400);
   throw new NotionError('Notion sync failed ('+response.status+').',response.status);
  }
 }
 return {call};
}

const sourceCache=new Map();
export async function dataSourceId(client,env=process.env){
 if(env.NOTION_DATA_SOURCE_ID)return env.NOTION_DATA_SOURCE_ID;
 if(sourceCache.has(env.NOTION_DATABASE_ID))return sourceCache.get(env.NOTION_DATABASE_ID);
 const db=await client.call('GET','/databases/'+env.NOTION_DATABASE_ID);
 const sources=db.data_sources||[];
 if(sources.length!==1)throw new NotionError(sources.length?'That Notion database has several data sources. Set NOTION_DATA_SOURCE_ID.':'Notion database has no data source.',400);
 sourceCache.set(env.NOTION_DATABASE_ID,sources[0].id);return sources[0].id;
}

export function schemaProblems(properties){return Object.entries(SCHEMA).filter(([name,type])=>properties?.[name]?.type!==type).map(([name,type])=>`${name} (${type})`);}

async function activePages(client,source){
 const pages=[];let cursor;
 do{const r=await client.call('POST','/data_sources/'+source+'/query',{filter:{property:PROPS.key,rich_text:{is_not_empty:true}},page_size:100,...(cursor?{start_cursor:cursor}:{})});for(const page of r.results||[])if(page.object==='page'&&!page.in_trash&&!page.archived)pages.push(pageRecord(page));cursor=r.has_more?r.next_cursor:null;}while(cursor);
 return pages;
}

// Applies at most maxWrites writes per call so one request stays well inside
// Notion's ~3 requests/second budget and the function timeout; `pending` tells
// the caller to come back for the rest.
export async function reconcile(entries,env=process.env,{maxWrites=30,...options}={}){
 const client=notionClient(env,options);const source=await dataSourceId(client,env);
 const plan=planSync(entries,await activePages(client,source));
 const result={created:0,updated:0,archived:0,total:entries.length,pending:false};let budget=maxWrites;
 for(const a of plan.archive){if(budget--<=0){result.pending=true;break;}await client.call('PATCH','/pages/'+a.id,{in_trash:true});result.archived++;}
 for(const u of plan.update){if(budget--<=0){result.pending=true;break;}await client.call('PATCH','/pages/'+u.id,{properties:entryProperties(u.entry)});result.updated++;}
 for(const e of plan.create){if(budget--<=0){result.pending=true;break;}await client.call('POST','/pages',{parent:{type:'data_source_id',data_source_id:source},properties:entryProperties(e)});result.created++;}
 if(result.created){
  // Another device may have created the same key at the same moment. Re-read and
  // keep only the canonical page, which every device agrees on.
  const again=planSync(entries,await activePages(client,source));
  for(const a of again.archive)if(a.reason==='duplicate'){await client.call('PATCH','/pages/'+a.id,{in_trash:true});result.archived++;}
 }
 return result;
}

let queue=Promise.resolve();
// Route entry point: reads the authoritative saved state (never client-supplied
// entries) and mirrors it. Calls in one server instance are serialized.
export function syncSavedState(env=process.env,options={},load=()=>savedState('GET',undefined,env)){
 if(localDesignMode(env))return Promise.resolve({status:'local'});
 if(!notionConfigured(env))return Promise.resolve({status:'unconfigured'});
 const run=queue.then(async()=>{const r=await load();if(r.status!==200)throw new NotionError('Cloud save is unavailable.',503);if(!r.data?.state)return {status:'synced',created:0,updated:0,archived:0,total:0,pending:false};const state=Engine.validate(r.data.state);return {status:'synced',revision:r.data.revision,...await reconcile(state.entries,env,options)};});
 queue=run.catch(()=>{});return run;
}

export { STATS };
