// Notion quest-log setup. Reads NOTION_TOKEN from the environment; never pass it as an argument.
//   node scripts/notion-setup.mjs create [parent-page-id]   creates the database under the page (default: NIVETHA LIFE OS)
//   node scripts/notion-setup.mjs check <database-id>        checks that an existing database has the required properties
import { notionClient, dataSourceId, schemaProblems, PROPS, STATS } from '../lib/notion-sync.mjs';
const LIFE_OS='3dbb269524eb8180b18fc5996f1db545';
const [mode,id]=process.argv.slice(2);
if(!process.env.NOTION_TOKEN){console.error('Set NOTION_TOKEN in this shell first.');process.exit(1);}
const env={...process.env};const client=notionClient(env);
try{
 if(mode==='create'){
  const properties={[PROPS.title]:{title:{}},[PROPS.key]:{rich_text:{}},[PROPS.date]:{date:{}},[PROPS.stat]:{select:{options:STATS.map(name=>({name}))}},[PROPS.xp]:{number:{format:'number'}},[PROPS.note]:{rich_text:{}}};
  const db=await client.call('POST','/databases',{parent:{type:'page_id',page_id:(id||LIFE_OS).replace(/-/g,'')},title:[{type:'text',text:{content:'The Becoming · Quest log'}}],initial_data_source:{properties}});
  console.log('Created "The Becoming · Quest log".\nNOTION_DATABASE_ID='+db.id.replace(/-/g,''));
 }else if(mode==='check'&&id){
  env.NOTION_DATABASE_ID=id.replace(/-/g,'');
  const source=await client.call('GET','/data_sources/'+await dataSourceId(client,env));
  const missing=schemaProblems(source.properties);
  if(missing.length){console.error('Add or rename these properties: '+missing.join(', '));process.exit(1);}
  console.log('Database is ready. NOTION_DATABASE_ID='+env.NOTION_DATABASE_ID);
 }else{console.error('Usage: node scripts/notion-setup.mjs create [parent-page-id] | check <database-id>');process.exit(1);}
}catch(e){console.error(e.message);process.exit(1);}
