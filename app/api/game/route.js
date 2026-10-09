import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requestAuthenticated,localDesignMode } from '../../../lib/auth.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req){if(!requestAuthenticated(req))return Response.redirect(new URL('/login',req.url));let html=await readFile(join(process.cwd(),'public/game/index.html'),'utf8');html=html.replace('<head>','<head><base href="/game/">'+(localDesignMode()?'<script>window.LOCAL_DESIGN_MODE=true;</script>':''));return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Frame-Options':'SAMEORIGIN'}});}
