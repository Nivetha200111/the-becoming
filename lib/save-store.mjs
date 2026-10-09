import { localDesignMode } from './auth.mjs';
const SITE_ORIGIN='https://nivetha-life-world.niv2001.chatgpt.site';
// The save bridge targets only the current owner-private Site. Never accept a
// caller-supplied upstream URL or forward the service credential to a browser.
export async function savedState(method,body,env=process.env,fetcher=fetch){
 if(localDesignMode(env))throw Error('Local design mode uses only this device’s saves.');
 if(!env.SITES_SAVE_TOKEN)throw Error('Cloud save connection is not configured.');
 const headers={'OAI-Sites-Authorization':'Bearer '+env.SITES_SAVE_TOKEN,Accept:'application/json'};
 if(body){headers.Origin=SITE_ORIGIN;headers['Content-Type']='application/json';}
 const response=await fetcher(SITE_ORIGIN+'/api/state',{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 let data;try{data=await response.json();}catch(e){throw Error('Cloud save connection needs attention.');}
 if(!response.ok&&response.status!==409)throw Error('Cloud save is temporarily unavailable.');
 return {status:response.status,data};
}
