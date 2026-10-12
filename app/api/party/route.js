import { requestAuthenticated,sameOrigin } from '../../../lib/auth.mjs';
import { syncParty } from '../../../lib/party-sync.mjs';
import { syncAchievements } from '../../../lib/achievements-sync.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
function reply(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});}
// Exchanges with Party HQ, the Notion database the Grok bots write into: counts their logged
// completions into the saved game, keeps mission status current, and returns missions and check-ins.
export async function POST(req){
 if(!requestAuthenticated(req))return reply({error:'Sign in to reconnect your party.'},401);
 if(!sameOrigin(req))return reply({error:'Request origin rejected.'},403);
 try{
  // Achievements logged in Notion are counted in the same visit. The two are independent: a problem in one never
  // hides or blocks the other.
  let party,failure;try{party=await syncParty();}catch(e){failure=e;}
  let achievements;try{achievements=await syncAchievements();}catch(e){achievements={status:'error',error:e.status?e.message:'Achievements sync is temporarily unavailable.'};}
  if(failure&&!(achievements.imported||achievements.updated))throw failure;
  return reply({...(party||{status:'error',missions:[],checkins:[]}),achievements});
 }catch(e){return reply({status:'error',error:e.status?e.message:'Party sync is temporarily unavailable.'},e.status===503?503:502);}
}
