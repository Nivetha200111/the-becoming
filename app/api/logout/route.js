import { cookieHeader,sameOrigin } from '../../../lib/auth.mjs';
export async function POST(req){if(!sameOrigin(req))return new Response('Request origin rejected',{status:403});return new Response(null,{status:303,headers:{Location:'/login','Set-Cookie':cookieHeader('',req,0)}});}
