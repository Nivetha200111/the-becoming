import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
export const COOKIE='becoming-session';
export function localDesignMode(env=process.env){return env.NODE_ENV==='development'&&env.LOCAL_DESIGN_MODE==='true'&&!env.VERCEL;}
export function configured(env=process.env){return typeof env.APP_PASSWORD==='string'&&env.APP_PASSWORD.length>=16&&typeof env.SESSION_SECRET==='string'&&env.SESSION_SECRET.length>=32;}
function digest(text){return createHash('sha256').update(text).digest();}
export function checkPassword(value,env=process.env){return configured(env)&&typeof value==='string'&&value.length<=256&&timingSafeEqual(digest(value),digest(env.APP_PASSWORD));}
function sign(body,secret){return createHmac('sha256',secret).update(body).digest('base64url');}
export function issueSession(env=process.env,now=Date.now()){if(!configured(env))throw Error('Private access is not configured.');const body=Buffer.from(JSON.stringify({exp:now+7*24*60*60*1000})).toString('base64url');return body+'.'+sign(body,env.SESSION_SECRET);}
export function validSession(token,env=process.env,now=Date.now()){if(!configured(env)||typeof token!=='string'||token.length>1024)return false;try{const [body,sig,...extra]=token.split('.');if(extra.length||!body||!sig)return false;const want=sign(body,env.SESSION_SECRET);if(sig.length!==want.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(want)))return false;const data=JSON.parse(Buffer.from(body,'base64url').toString());return Number.isFinite(data.exp)&&data.exp>now&&data.exp<=now+7*24*60*60*1000;}catch(e){return false;}}
export function requestAuthenticated(req,env=process.env){if(localDesignMode(env))return true;const cookie=req.headers.get('cookie')||'';const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return validSession(token,env);}
export function sameOrigin(req){return req.headers.get('origin')===new URL(req.url).origin;}
export function cookieHeader(value,req,maxAge=604800){return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(req.url).protocol==='https:'?'; Secure':''}`;}
