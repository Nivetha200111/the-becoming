import { requestAuthenticated } from '../../../lib/auth.mjs';
import { savedState } from '../../../lib/save-store.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req){if(!requestAuthenticated(req))return Response.json({error:'Unauthorized'},{status:401});try{const r=await savedState('GET');return Response.json({status:r.status===200?'ready':'unavailable',cloudStorage:true,notionSync:false},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}}
