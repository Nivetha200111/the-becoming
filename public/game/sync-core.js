(function(root){
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function merge(base,local,remote){
 const out=JSON.parse(JSON.stringify(remote));
 for(const field of ['entries','custom','purchases','rewards']){
  const key=field==='entries'?'key':'id',b=new Map((base[field]||[]).map(x=>[x[key],x])),l=new Map((local[field]||[]).map(x=>[x[key],x]));
  out[field]=(out[field]||[]).filter(x=>!b.has(x[key])||l.has(x[key]));
  const known=new Set(out[field].map(x=>x[key]));
  for(const x of local[field]||[])if(!b.has(x[key])&&!known.has(x[key])){out[field].push(x);known.add(x[key]);}
 }
 for(const f of ['mode','equipped','position','seenIntro'])if(!equal(base[f],local[f]))out[f]=local[f];
 const earned=out.entries.reduce((n,e)=>n+Math.floor(e.xp/10),0);let spent=0,refunds=0;
 out.purchases=out.purchases.filter(p=>{if(spent+p.cost>earned){refunds++;return false;}spent+=p.cost;return true;});
 if(out.equipped!=='sage'&&!out.purchases.some(p=>p.id===out.equipped))out.equipped='sage';
 return {state:out,refunds};
}
const api={merge,equal};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SyncCore=api;
})(typeof window!=='undefined'?window:globalThis);
