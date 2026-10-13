(function(root){
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function merge(base,local,remote){
 const out=JSON.parse(JSON.stringify(remote));
 for(const field of ['entries','custom','purchases','rewards','armory','penalties']){
  const key=field==='entries'?'key':'id',b=new Map((base[field]||[]).map(x=>[x[key],x])),l=new Map((local[field]||[]).map(x=>[x[key],x]));
  if(!out[field]&&!local[field])continue;
  out[field]=(out[field]||[]).filter(x=>!b.has(x[key])||l.has(x[key]));
  const known=new Set(out[field].map(x=>x[key]));
  for(const x of local[field]||[])if(!b.has(x[key])&&!known.has(x[key])){out[field].push(x);known.add(x[key]);}
 }
 for(const f of ['mode','equipped','position','seenIntro'])if(!equal(base[f],local[f]))out[f]=local[f];
 const earned=out.entries.reduce((n,e)=>n+Math.floor(e.xp/10),0);let spent=0,refunds=0;
 out.purchases=out.purchases.filter(p=>{if(spent+p.cost>earned){refunds++;return false;}spent+=p.cost;return true;});
 if(out.equipped!=='sage'&&!out.purchases.some(p=>p.id===out.equipped))out.equipped='sage';
 // The armoury: one of each item, weapons with no gap in the ladder, and never more spent than the bronze earned.
 // The dearest weapon goes back first, so what remains is always a valid ladder.
 const seen=new Set();out.armory=(out.armory||[]).filter(a=>!seen.has(a.item)&&seen.add(a.item));
 const tier=a=>/^w\d$/.test(a.item)?Number(a.item[1]):0;let ladder=0;
 for(const a of out.armory.filter(tier).sort((x,y)=>tier(x)-tier(y))){if(tier(a)===ladder+1)ladder++;}
 out.armory=out.armory.filter(a=>tier(a)<=ladder);
 const bronze=out.entries.reduce((n,e)=>n+Math.floor(e.xp/2),0);
 while(out.armory.reduce((n,a)=>n+a.cost,0)>bronze){const top=out.armory.reduce((m,a)=>tier(a)>tier(m)?a:m,out.armory[out.armory.length-1]);out.armory=out.armory.filter(a=>a!==top);refunds++;}
 return {state:out,refunds};
}
const api={merge,equal};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SyncCore=api;
})(typeof window!=='undefined'?window:globalThis);
