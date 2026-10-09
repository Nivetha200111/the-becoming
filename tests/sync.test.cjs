const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const E=require('../lib/engine.cjs');const sandbox={module:{exports:{}},globalThis:{}};vm.runInNewContext(fs.readFileSync('public/game/sync-core.js','utf8'),sandbox);const {merge}=sandbox.module.exports;
function copy(s){return JSON.parse(JSON.stringify(s));}
function add(s,id,xp=40){E.award(s,{id,title:id,xp,stat:'BUILD',region:'forge',repeat:false,unlock:1},'completed','2026-10-09');return s;}
let base=E.fresh(),a=add(copy(base),'a'),b=add(copy(base),'b');let combined=merge(base,a,b).state;assert.equal(E.total(combined),80);E.validate(combined);
combined=merge(base,add(copy(base),'same'),add(copy(base),'same')).state;assert.equal(combined.entries.length,1);assert.equal(E.total(combined),40);
base=add(E.fresh(),'undone');a=copy(base);a.entries=[];b=add(copy(base),'other');combined=merge(base,a,b).state;assert.deepEqual(Array.from(combined.entries,e=>e.key),['other']);
// A stale browser with no local changes must not resurrect a cloud deletion.
base=add(E.fresh(),'deleted');a=copy(base);b=E.fresh();combined=merge(base,a,b).state;assert.equal(combined.entries.length,0);
base=add(add(add(E.fresh(),'boss1',250),'boss2',250),'boss3',250);a=copy(base);b=copy(base);a.purchases=[{id:'ember',cost:30}];a.equipped='ember';b.purchases=[{id:'midnight',cost:60}];b.equipped='midnight';const m=merge(base,a,b);assert.equal(m.refunds,1);assert(E.coins(m.state)>=0);E.validate(m.state);
const original=fs.readFileSync('public/game/engine.js','utf8');assert.equal(original,fs.readFileSync('lib/engine.cjs','utf8'));
console.log('PASS: concurrent progress, duplicate XP, offline undo, stale-device deletion, reward reconciliation, shared validation.');
