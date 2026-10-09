import { requestAuthenticated,sameOrigin } from '../../../lib/auth.mjs';
import { syncSavedState } from '../../../lib/notion-sync.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
function reply(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});}
// Mirrors the authoritative cloud save into Notion. The browser calls this after a
// successful save; the request carries no entries, so nothing unsaved reaches Notion.
export async function POST(req){
 if(!requestAuthenticated(req))return reply({error:'Sign in to reconnect Notion sync.'},401);
 if(!sameOrigin(req))return reply({error:'Request origin rejected.'},403);
 try{return reply(await syncSavedState());}catch(e){return reply({status:'error',error:e.status?e.message:'Notion sync is temporarily unavailable.'},e.status===503?503:502);}
}
