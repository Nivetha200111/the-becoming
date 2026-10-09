// Notion setup for The Becoming. Reads NOTION_TOKEN from the environment; never pass it as an argument.
//   node scripts/notion-setup.mjs create [parent-page-id]        Quest log (game -> Notion mirror) under the page (default: NIVETHA LIFE OS)
//   node scripts/notion-setup.mjs create-party [parent-page-id]  Party HQ (Grok bots -> game) under the page
//   node scripts/notion-setup.mjs check <database-id>            checks an existing Quest log
//   node scripts/notion-setup.mjs check-party <database-id>      checks an existing Party HQ
import Roster from '../lib/roster.cjs';
import { notionClient, resolveSource, schemaProblems, PROPS, SCHEMA, STATS } from '../lib/notion-sync.mjs';
import { PARTY, PARTY_SCHEMA, TYPES, STATUSES } from '../lib/party-sync.mjs';
const LIFE_OS='3dbb269524eb8180b18fc5996f1db545';
const [mode,id]=process.argv.slice(2);
if(!process.env.NOTION_TOKEN){console.error('Set NOTION_TOKEN in this shell first.');process.exit(1);}
const client=notionClient(process.env);
const options=names=>({options:names.map(name=>({name}))});
const bots=options(Roster.ALL.map(b=>b.name));
const setups={
 create:{title:'The Becoming · Quest log',env:'NOTION_DATABASE_ID',properties:{[PROPS.title]:{title:{}},[PROPS.key]:{rich_text:{}},[PROPS.date]:{date:{}},[PROPS.stat]:{select:options(STATS)},[PROPS.xp]:{number:{format:'number'}},[PROPS.note]:{rich_text:{}},[PROPS.bot]:{select:bots}}},
 'create-party':{title:'Party HQ',env:'NOTION_PARTY_DATABASE_ID',properties:{[PARTY.title]:{title:{}},[PARTY.bot]:{select:bots},[PARTY.type]:{select:options(TYPES)},[PARTY.status]:{select:options(STATUSES)},[PARTY.quest]:{rich_text:{}},[PARTY.stat]:{select:options(STATS)},[PARTY.xp]:{number:{format:'number'}},[PARTY.details]:{rich_text:{}},[PARTY.date]:{date:{}},[PARTY.key]:{rich_text:{}},[PARTY.note]:{rich_text:{}}}}
};
const checks={check:{schema:SCHEMA,env:'NOTION_DATABASE_ID'},'check-party':{schema:PARTY_SCHEMA,env:'NOTION_PARTY_DATABASE_ID'}};
try{
 if(setups[mode]){
  const s=setups[mode];
  const db=await client.call('POST','/databases',{parent:{type:'page_id',page_id:(id||LIFE_OS).replace(/-/g,'')},title:[{type:'text',text:{content:s.title}}],initial_data_source:{properties:s.properties}});
  console.log(`Created "${s.title}".\n${s.env}=${db.id.replace(/-/g,'')}`);
 }else if(checks[mode]&&id){
  const c=checks[mode],databaseId=id.replace(/-/g,'');
  const source=await client.call('GET','/data_sources/'+await resolveSource(client,databaseId,null,c.env.replace('DATABASE','DATA_SOURCE')));
  const missing=schemaProblems(source.properties,c.schema);
  if(missing.length){console.error('Add or rename these properties: '+missing.join(', '));process.exit(1);}
  console.log(`Database is ready. ${c.env}=${databaseId}`);
 }else{console.error('Usage: node scripts/notion-setup.mjs create|create-party [parent-page-id] | check|check-party <database-id>');process.exit(1);}
}catch(e){console.error(e.message);process.exit(1);}
