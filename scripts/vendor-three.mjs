// Copies a minified three.js build and the add-ons the 3D world uses into public/game/vendor/three.
// Run after upgrading the `three` dependency: node scripts/vendor-three.mjs
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';
const require=createRequire(import.meta.url);
const { minify }=require('next/dist/compiled/terser');
const root=join(process.cwd(),'node_modules/three'),out=join(process.cwd(),'public/game/vendor/three');
const entries=['build/three.core.js','build/three.module.js','examples/jsm/postprocessing/EffectComposer.js','examples/jsm/postprocessing/RenderPass.js','examples/jsm/postprocessing/UnrealBloomPass.js','examples/jsm/postprocessing/OutputPass.js','examples/jsm/postprocessing/ShaderPass.js','examples/jsm/utils/BufferGeometryUtils.js'];
const seen=new Set();
async function copy(rel){
  if(seen.has(rel))return;seen.add(rel);
  const src=await readFile(join(root,rel),'utf8');
  for(const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g))await copy(posix.normalize(posix.join(posix.dirname(rel),m[1])));
  const {code}=await minify(src,{module:true,ecma:2020,compress:{passes:2},mangle:true,format:{comments:/@license/}});
  const dest=join(out,rel.replace(/^examples\/jsm\//,'addons/').replace(/^build\//,''));
  await mkdir(dirname(dest),{recursive:true});await writeFile(dest,code);
}
await rm(out,{recursive:true,force:true});
for(const e of entries)await copy(e);
await writeFile(join(out,'LICENSE'),await readFile(join(root,'LICENSE'),'utf8'));
console.log(`Vendored three@${JSON.parse(await readFile(join(root,'package.json'),'utf8')).version}: ${seen.size} files → public/game/vendor/three`);
