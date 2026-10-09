import Engine from '../../../lib/engine.cjs';
import { requestAuthenticated,sameOrigin } from '../../../lib/auth.mjs';
import { savedState } from '../../../lib/save-store.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function reply(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});}
export async function GET(req){if(!requestAuthenticated(req))return reply({error:'Sign in to reconnect cloud saves.'},401);try{const r=await savedState('GET');return reply(r.data,r.status);}catch(e){return reply({error:e.message},503);}}
export async function POST(req){
 if(!requestAuthenticated(req))return reply({error:'Sign in to reconnect cloud saves.'},401);
 if(!sameOrigin(req))return reply({error:'Request origin rejected.'},403);
 if(!req.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Use a JSON request.'},415);
 let input;try{const raw=await req.text();if(Buffer.byteLength(raw)>4*1024*1024)return reply({error:'Save is too large.'},413);input=JSON.parse(raw);if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw Error('Invalid save revision.');Engine.validate(input.state);}catch(e){return reply({error:e.message||'Invalid game save.'},400);}
 try{const r=await savedState('POST',input);return reply(r.data,r.status);}catch(e){return reply({error:e.message},503);}
}
