import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validSession,COOKIE,localDesignMode } from '../lib/auth.mjs';
export const dynamic='force-dynamic';
export default async function Page(){const store=await cookies();if(!localDesignMode()&&!validSession(store.get(COOKIE)?.value))redirect('/login');return <iframe src="/api/game" title="Nivetha · The Becoming" style={{width:'100%',height:'100dvh',border:0,display:'block'}} allow="clipboard-write; fullscreen" allowFullScreen/>;}
