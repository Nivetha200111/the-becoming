import { localDesignMode } from './auth.mjs';
const SITE_ORIGIN='https://nivetha-life-world.niv2001.chatgpt.site';
// The save bridge targets only the current owner-private Site. Never accept a
// caller-supplied upstream URL or forward the service credential to a browser.
// Treasury redemptions (state.rewards) are newer than the save backend. So nothing depends on the backend
// keeping unknown fields, every save also carries each redemption as a hidden custom quest (a field the backend
// has always kept), with the details in its strings. Reads rebuild `rewards` from them and hide them again.
export const REWARD_PREFIX='custom-reward-';
export function packRewards(state){
 if(!state||typeof state!=='object')return state;
 const out={...state,custom:(state.custom||[]).filter(q=>!String(q?.id).startsWith(REWARD_PREFIX))};
 for(const r of state.rewards||[])out.custom.push({id:REWARD_PREFIX+r.id,title:'Treasury · '+r.item,detail:JSON.stringify({id:r.id,item:r.item,cost:r.cost,date:r.date}),region:'camp',stat:'FOCUS',xp:20,unlock:1,repeat:false});
 return out;
}
export function unpackRewards(state){
 if(!state||typeof state!=='object'||!Array.isArray(state.custom))return state;
 const rewards=[...(Array.isArray(state.rewards)?state.rewards:[])],ids=new Set(rewards.map(r=>r?.id)),custom=[];
 for(const q of state.custom){
  if(!String(q?.id).startsWith(REWARD_PREFIX)){custom.push(q);continue;}
  try{const r=JSON.parse(q.detail);if(r&&typeof r.id==='string'&&!ids.has(r.id)){rewards.push({id:r.id,item:r.item,cost:r.cost,date:r.date});ids.add(r.id);}}catch(e){}
 }
 return {...state,custom,rewards};
}
export async function savedState(method,body,env=process.env,fetcher=fetch){
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
 if(!response.ok&&response.status!==409)throw Error('Cloud save is temporarily unavailable.');
 return {status:response.status,data};
}
