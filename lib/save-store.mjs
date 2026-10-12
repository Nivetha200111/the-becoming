import { localDesignMode } from './auth.mjs';
import { notionSavedState, notionSaveConfigured } from './notion-save.mjs';
const SITE_ORIGIN='https://nivetha-life-world.niv2001.chatgpt.site';
// The save bridge targets only the current owner-private Site. Never accept a
// caller-supplied upstream URL or forward the service credential to a browser.
// Treasury redemptions (state.rewards) are newer than the save backend. So nothing depends on the backend
// keeping unknown fields, every save also carries each redemption as a hidden custom quest (a field the backend
// has always kept), with the details in its strings. Reads rebuild `rewards` from them and hide them again.
export const REWARD_PREFIX='custom-reward-';
// The armoury (state.armory) travels the same way: one hidden custom quest per piece of gear.
export const GEAR_PREFIX='custom-gear-';
const hidden=q=>String(q?.id).startsWith(REWARD_PREFIX)||String(q?.id).startsWith(GEAR_PREFIX);
export function packRewards(state){
 if(!state||typeof state!=='object')return state;
 const out={...state,custom:(state.custom||[]).filter(q=>!hidden(q))};
 for(const a of state.armory||[])out.custom.push({id:GEAR_PREFIX+a.item,title:'Armoury · '+a.item,detail:JSON.stringify({id:a.id,item:a.item,cost:a.cost,date:a.date}),region:'camp',stat:'FOCUS',xp:20,unlock:1,repeat:false});
 for(const r of state.rewards||[])out.custom.push({id:REWARD_PREFIX+r.id,title:'Treasury · '+r.item,detail:JSON.stringify({id:r.id,item:r.item,cost:r.cost,date:r.date}),region:'camp',stat:'FOCUS',xp:20,unlock:1,repeat:false});
 return out;
}
export function unpackRewards(state){
 if(!state||typeof state!=='object'||!Array.isArray(state.custom))return state;
 const rewards=[...(Array.isArray(state.rewards)?state.rewards:[])],ids=new Set(rewards.map(r=>r?.id)),custom=[];
 const armory=[...(Array.isArray(state.armory)?state.armory:[])],gear=new Set(armory.map(a=>a?.item));
 for(const q of state.custom){
  if(!hidden(q)){custom.push(q);continue;}
  if(String(q.id).startsWith(GEAR_PREFIX)){try{const a=JSON.parse(q.detail);if(a&&typeof a.item==='string'&&!gear.has(a.item)){armory.push({id:a.id,item:a.item,cost:a.cost,date:a.date});gear.add(a.item);}}catch(e){}continue;}
  try{const r=JSON.parse(q.detail);if(r&&typeof r.id==='string'&&!ids.has(r.id)){rewards.push({id:r.id,item:r.item,cost:r.cost,date:r.date});ids.add(r.id);}}catch(e){}
 }
 return {...state,custom,rewards,armory};
}
// The save lives in the owner's Notion workspace (lib/notion-save.mjs) whenever Notion is connected: that is the
// store she chose, and it needs no setting of its own. SAVE_STORE=site forces the original bridge to the
// owner-private Site, which is also what runs when Notion is not connected. While SITES_SAVE_TOKEN is still set,
// the first Notion request copies the existing save across, so switching never starts from zero.
export const saveStore=(env=process.env)=>env.SAVE_STORE==='site'?'site':env.SAVE_STORE==='notion'||notionSaveConfigured(env)?'notion':'site';
// The old backend's save, to carry across once. A backend that refuses the credential has nothing left to give,
// so that counts as empty; one that is merely unreachable makes the request wait rather than start from zero.
async function earlierSave(env,fetcher){
 try{return await siteSavedState('GET',undefined,env,fetcher);}
 catch(e){if(e.status===401||e.status===403||e.status===404)return {status:200,data:{revision:0,state:null}};throw e;}
}
export async function savedState(method,body,env=process.env,fetcher=fetch){
 if(localDesignMode(env))throw Error('Local design mode uses only this device’s saves.');
 if(saveStore(env)==='notion')return notionSavedState(method,body,env,{fetcher,legacy:env.SITES_SAVE_TOKEN?()=>earlierSave(env,fetcher):null});
 return siteSavedState(method,body,env,fetcher);
}
async function siteSavedState(method,body,env,fetcher){
 const result=await rawSavedState(method,body&&body.state?{...body,state:packRewards(body.state)}:body,env,fetcher);
 if(result.data&&result.data.state)result.data={...result.data,state:unpackRewards(result.data.state)};
 return result;
}
async function rawSavedState(method,body,env,fetcher){
 if(localDesignMode(env))throw Error('Local design mode uses only this device’s saves.');
 if(!env.SITES_SAVE_TOKEN)throw Error('Cloud save connection is not configured.');
 const headers={'OAI-Sites-Authorization':'Bearer '+env.SITES_SAVE_TOKEN,Accept:'application/json'};
 if(body){headers.Origin=SITE_ORIGIN;headers['Content-Type']='application/json';}
 const response=await fetcher(SITE_ORIGIN+'/api/state',{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 let data;try{data=await response.json();}catch(e){throw Error('Cloud save connection needs attention.');}
 if(!response.ok&&response.status!==409)throw Object.assign(Error('Cloud save is temporarily unavailable.'),{status:response.status});
 return {status:response.status,data};
}
