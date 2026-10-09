import test from 'node:test';import assert from 'node:assert/strict';
import {issueSession,validSession,checkPassword,requestAuthenticated,localDesignMode,sameOrigin,cookieHeader} from '../lib/auth.mjs';
import { proxy } from '../proxy.js';
import {savedState} from '../lib/save-store.mjs';
const env={APP_PASSWORD:'test-only-password-long-enough',SESSION_SECRET:'test-only-secret-of-at-least-thirty-two-characters'};
test('origin checks and secure cookies follow the public deployment host behind a proxy',()=>{
 const headers={Host:'localhost:3000','X-Forwarded-Host':'game.example','X-Forwarded-Proto':'https',Origin:'https://game.example'};
 const req=new Request('http://localhost:3000/api/login',{headers});assert(sameOrigin(req));assert(cookieHeader('test',req).includes('; Secure'));
 assert(!sameOrigin(new Request(req.url,{headers:{...headers,Origin:'https://foreign.example'}})));
});
test('private session checks password, tampering and expiry',()=>{assert(checkPassword(env.APP_PASSWORD,env));assert(!checkPassword('bad',env));assert(!checkPassword(env.APP_PASSWORD,{}));const token=issueSession(env,1000);assert(validSession(token,env,1001));assert(!validSession(token+'x',env,1001));assert(!validSession(token,env,1000+7*86400000));assert(requestAuthenticated(new Request('https://game.example',{headers:{Cookie:'becoming-session='+token}}),env)===false);});
test('save bridge keeps credential server-side and preserves conflicts',async()=>{let invocation;const fetcher=async(url,opts)=>{invocation={url,opts};return Response.json({revision:4,state:{}},{status:409});};const r=await savedState('POST',{expectedRevision:3,state:{}},{SITES_SAVE_TOKEN:'test-only-service-token'},fetcher);assert.equal(r.status,409);assert.equal(invocation.url,'https://nivetha-life-world.niv2001.chatgpt.site/api/state');assert.equal(invocation.opts.headers.Origin,'https://nivetha-life-world.niv2001.chatgpt.site');assert(!JSON.stringify(r).includes('test-only-service-token'));});
test('missing cloud configuration fails without pretending to sync',async()=>{await assert.rejects(savedState('GET',undefined,{}),/not configured/);});
test('local design mode cannot bypass production or Vercel access',async()=>{const local={NODE_ENV:'development',LOCAL_DESIGN_MODE:'true'};assert(localDesignMode(local));assert(requestAuthenticated(new Request('http://127.0.0.1:3000'),local));for(const blocked of [{...local,NODE_ENV:'production'},{...local,VERCEL:'1'},{NODE_ENV:'development'}]){assert(!localDesignMode(blocked));assert(!requestAuthenticated(new Request('https://game.example'),blocked));}await assert.rejects(savedState('GET',undefined,{...local,SITES_SAVE_TOKEN:'unused-test-token'},()=>{throw Error('must not contact cloud');}),/Local design mode/);});

test('direct game assets require a session and are never shared-cache responses',()=>{
 const old={APP_PASSWORD:process.env.APP_PASSWORD,APP_PASSWORD_HASH:process.env.APP_PASSWORD_HASH,SESSION_SECRET:process.env.SESSION_SECRET,LOCAL_DESIGN_MODE:process.env.LOCAL_DESIGN_MODE};
 try{Object.assign(process.env,env);delete process.env.APP_PASSWORD_HASH;delete process.env.LOCAL_DESIGN_MODE;
  const url='https://game.example/game/index.html';
  const denied=proxy(new Request(url));assert.equal(denied.status,307);assert.equal(denied.headers.get('location'),'https://game.example/login');
  const allowed=proxy(new Request(url,{headers:{Cookie:'becoming-session='+issueSession(env)}}));assert.equal(allowed.headers.get('x-middleware-next'),'1');assert.equal(allowed.headers.get('cache-control'),'private, no-store');
 }finally{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
