import { requestAuthenticated,sameOrigin } from '../../../lib/auth.mjs';
import { syncParty } from '../../../lib/party-sync.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
function reply(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});}
// Exchanges with Party HQ, the Notion database the Grok bots write into: counts their logged
// completions into the saved game, keeps mission status current, and returns missions and check-ins.
export async function POST(req){
 if(!requestAuthenticated(req))return reply({error:'Sign in to reconnect your party.'},401);
 if(!sameOrigin(req))return reply({error:'Request origin rejected.'},403);
 try{return reply(await syncParty());}catch(e){return reply({status:'error',error:e.status?e.message:'Party sync is temporarily unavailable.'},e.status===503?503:502);}
}
