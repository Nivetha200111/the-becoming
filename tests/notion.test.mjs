import test from 'node:test';import assert from 'node:assert/strict';
import Engine from '../lib/engine.cjs';
import { planSync,reconcile,syncSavedState,entryProperties,pageRecord,schemaProblems,SCHEMA,PROPS,NOTION_VERSION } from '../lib/notion-sync.mjs';

const DB='0123456789abcdef0123456789abcdef',SOURCE='ds-1',TOKEN='test-only-notion-token-0000';
const env={NOTION_TOKEN:TOKEN,NOTION_DATABASE_ID:DB};
const quest=(id,repeat=true)=>({id,title:'Quest '+id,xp:40,stat:'FOCUS',region:'tower',repeat,unlock:1});
const claim=(s,id,note='did it',date='2026-10-09')=>Engine.award(s,quest(id),note,date);

// In-memory stand-in for the Notion REST API (2025-09-03 data sources).
function fakeNotion({failFirst=0}={}){
 const pages=[];let seq=0,clock=0;const calls=[];
 const fetcher=async(url,opts)=>{
  await new Promise(r=>setImmediate(r));
  const path=url.replace('https://api.notion.com/v1','');const body=opts.body?JSON.parse(opts.body):undefined;calls.push({method:opts.method,path,body,headers:opts.headers});
  assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);assert.equal(opts.headers['Notion-Version'],NOTION_VERSION);
  if(failFirst>0){failFirst--;return Response.json({code:'rate_limited'},{status:429,headers:{'Retry-After':'1'}});}
  if(opts.method==='GET'&&path==='/databases/'+DB)return Response.json({object:'database',id:DB,data_sources:[{id:SOURCE,name:'Quest log'}]});
  if(opts.method==='POST'&&path==='/data_sources/'+SOURCE+'/query'){
   assert.deepEqual(body.filter,{property:PROPS.key,rich_text:{is_not_empty:true}});
   const active=pages.filter(p=>!p.in_trash&&p.properties[PROPS.key]?.rich_text?.length);const start=Number(body.start_cursor||0),end=start+2; // tiny pages exercise pagination
   return Response.json({object:'list',results:active.slice(start,end),has_more:end<active.length,next_cursor:end<active.length?String(end):null});
  }
  if(opts.method==='POST'&&path==='/pages'){assert.deepEqual(body.parent,{type:'data_source_id',data_source_id:SOURCE});const page={object:'page',id:'page-'+String(++seq).padStart(3,'0'),created_time:new Date(Date.UTC(2026,9,9,0,clock++)).toISOString(),in_trash:false,properties:readBack(body.properties)};pages.push(page);return Response.json(page);}
  const m=path.match(/^\/pages\/(.+)$/);
  if(opts.method==='PATCH'&&m){const page=pages.find(p=>p.id===m[1]);if(!page)return Response.json({code:'object_not_found'},{status:404});if(body.in_trash)page.in_trash=true;if(body.properties)page.properties=readBack(body.properties);return Response.json(page);}
  return Response.json({code:'invalid_request_url'},{status:400});
 };
 // Notion returns rich text with plain_text filled in.
 const readBack=props=>JSON.parse(JSON.stringify(props),(k,v)=>v&&v.type==='text'&&v.text?{...v,plain_text:v.text.content}:v);
 const active=()=>pages.filter(p=>!p.in_trash).map(pageRecord);
 return {fetcher,pages,calls,active,writes:()=>calls.filter(c=>c.method!=='GET'&&!c.path.endsWith('/query'))};
}
const opts=n=>({fetcher:n.fetcher,sleep:async()=>{}});

test('claiming a quest creates exactly one Notion record, and retries create nothing new',async()=>{
 const n=fakeNotion();const s=claim(Engine.fresh(),'focus');
 assert.deepEqual(await reconcile(s.entries,env,opts(n)),{created:1,updated:0,archived:0,total:1,pending:false});
 const [page]=n.active();assert.equal(page.key,'focus:2026-10-09');
 const props=n.pages[0].properties;assert.equal(props[PROPS.title].title[0].text.content,'Quest focus');assert.equal(props[PROPS.date].date.start,'2026-10-09');assert.equal(props[PROPS.stat].select.name,'FOCUS');assert.equal(props[PROPS.xp].number,40);assert.equal(props[PROPS.note].rich_text[0].text.content,'did it');
 const before=n.writes().length;
 for(let i=0;i<3;i++)assert.deepEqual(await reconcile(s.entries,env,opts(n)),{created:0,updated:0,archived:0,total:1,pending:false});
 assert.equal(n.writes().length,before);assert.equal(n.active().length,1);
});

test('undo archives the matching Notion page and leaves the others',async()=>{
 const n=fakeNotion();const s=claim(claim(Engine.fresh(),'a'),'b');await reconcile(s.entries,env,opts(n));
 s.entries=s.entries.filter(e=>e.key!=='a:2026-10-09');
 const r=await reconcile(s.entries,env,opts(n));assert.equal(r.archived,1);assert.equal(r.created,0);
 assert.deepEqual(n.active().map(p=>p.key),['b:2026-10-09']);assert.equal(n.pages.find(p=>p.id==='page-001').in_trash,true);
});

test('undo then re-claim with a new note updates the record in place',async()=>{
 const n=fakeNotion();let s=claim(Engine.fresh(),'a','first try');await reconcile(s.entries,env,opts(n));
 s=claim(Engine.fresh(),'a','second, better note');const r=await reconcile(s.entries,env,opts(n));
 assert.deepEqual([r.created,r.updated,r.archived],[0,1,0]);assert.equal(n.active().length,1);assert.equal(n.pages[0].properties[PROPS.note].rich_text[0].plain_text,'second, better note');
});

test('two devices reconciling at once converge on one page per key',async()=>{
 const n=fakeNotion();const s=claim(claim(claim(Engine.fresh(),'x'),'y'),'z');
 await Promise.all([reconcile(s.entries,env,opts(n)),reconcile(s.entries,env,opts(n))]);
 assert.equal(n.pages.length,6,'both devices raced and created every key');
 await reconcile(s.entries,env,opts(n));
 const keys=n.active().map(p=>p.key).sort();assert.deepEqual(keys,['x:2026-10-09','y:2026-10-09','z:2026-10-09']);
});

test('duplicates keep the earliest page so every device archives the same ones',()=>{
 const e=claim(Engine.fresh(),'a').entries;const props=entryProperties(e[0]);
 const page=(id,created)=>pageRecord({id,created_time:created,properties:JSON.parse(JSON.stringify(props),(k,v)=>v&&v.type==='text'?{...v,plain_text:v.text.content}:v)});
 const plan=planSync(e,[page('p2','2026-10-09T10:01:00.000Z'),page('p3','2026-10-09T10:00:00.000Z'),page('p1','2026-10-09T10:00:00.000Z')]);
 assert.deepEqual(plan.archive.map(a=>a.id).sort(),['p2','p3']);assert.deepEqual([plan.create.length,plan.update.length],[0,0]);
 assert.deepEqual(planSync([],[{id:'other',key:'',fingerprint:''}]),{create:[],update:[],archive:[]},'pages without an entry key are never touched');
});

test('rate limits are retried and large backlogs are paced across calls',async()=>{
 const n=fakeNotion({failFirst:2});let s=Engine.fresh();for(const id of ['a','b','c','d','e'])s=claim(s,id);
 const first=await reconcile(s.entries,env,{...opts(n),maxWrites:3});assert.deepEqual([first.created,first.pending],[3,true]);
 const second=await reconcile(s.entries,env,{...opts(n),maxWrites:3});assert.deepEqual([second.created,second.pending],[2,false]);
 assert.equal(n.active().length,5);
});

test('route sync reads the saved state, not the request',async()=>{
 const n=fakeNotion();const saved=claim(Engine.fresh(),'focus');
 const r=await syncSavedState(env,opts(n),async()=>({status:200,data:{revision:7,state:saved}}));
 assert.deepEqual(r,{status:'synced',revision:7,created:1,updated:0,archived:0,total:1,pending:false});
 assert(!JSON.stringify(r).includes(TOKEN));
 const empty=await syncSavedState(env,opts(n),async()=>({status:200,data:{revision:0,state:null}}));assert.equal(empty.created,0);assert.equal(n.active().length,1,'a missing save never archives Notion records');
 await assert.rejects(syncSavedState(env,opts(n),async()=>({status:200,data:{revision:1,state:{version:2}}})),/not a valid game save/);
});

test('local design mode and missing configuration never contact Notion',async()=>{
 const forbidden={fetcher:()=>{throw Error('must not contact Notion');}};const load=()=>{throw Error('must not load');};
 assert.deepEqual(await syncSavedState({...env,NODE_ENV:'development',LOCAL_DESIGN_MODE:'true'},forbidden,load),{status:'local'});
 assert.deepEqual(await syncSavedState({},forbidden,load),{status:'unconfigured'});
 assert.deepEqual(await syncSavedState({NOTION_TOKEN:TOKEN,NOTION_DATABASE_ID:'not-an-id'},forbidden,load),{status:'unconfigured'});
});

test('Notion errors are reported without leaking the token',async()=>{
 const fetcher=async()=>Response.json({code:'unauthorized',message:'API token is invalid.'},{status:401});
 await assert.rejects(reconcile([],{...env,NOTION_DATABASE_ID:'fedcba9876543210fedcba9876543210'},{fetcher,sleep:async()=>{}}),e=>e.status===401&&!e.message.includes(TOKEN));
 assert.deepEqual(schemaProblems(Object.fromEntries(Object.entries(SCHEMA).map(([k,type])=>[k,{type}]))),[]);
 assert.deepEqual(schemaProblems({[PROPS.title]:{type:'title'}}).length,6);
});
