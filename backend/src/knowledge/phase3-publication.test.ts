import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL='postgresql://synthetic.invalid/phase3';process.env.GEMINI_API_KEY='';process.env.OPENAI_API_KEY='';process.env.DEBUG_TRACE='false';
let rows:any[]=[],jobs:any[]=[],failPublish=false,dbDown=false;
const matches=(row:any,where:any):boolean=>Object.entries(where??{}).every(([key,value]:[string,any])=>value?.gt!==undefined?new Date(row[key])>value.gt:value?.not!==undefined?row[key]!==value.not:value?.in?value.in.includes(row[key]):row[key]===value);
const snapshotModel={async findFirst({where}:any){if(dbDown)throw Error('synthetic database unavailable');return rows.filter(row=>matches(row,where)).at(-1)??null;},async findMany({where}:any){return rows.filter(row=>matches(row,where)).reverse();},async findUnique({where}:any){return rows.find(row=>matches(row,where))??null;},async updateMany({where,data}:any){if(failPublish)throw Error('synthetic publication failure');let count=0;for(const row of rows)if(matches(row,where)){Object.assign(row,data);count++;}return {count};}};
const buildModel={async findFirst({where}:any){return jobs.find(row=>matches(row,where))??null;},async updateMany({where,data}:any){let count=0;for(const row of jobs)if(matches(row,where)){Object.assign(row,data);count++;}return {count};}};
(globalThis as any).prisma={knowledgeSnapshot:snapshotModel,knowledgeBuild:buildModel,async $transaction(fn:any){const backup=structuredClone({rows,jobs});try{return await fn(this);}catch(error){rows=backup.rows;jobs=backup.jobs;throw error;}},async $queryRaw(){return [{id:'site',url:'https://fixture.test'}];}};
const {config}=await import('../config/index.js');
const {ingest,IncompleteBuildError}=await import('../services/ingestService.js');
const {publishKnowledgeBuild,validateKnowledgeSnapshot,LeaseLostError}=await import('./publication.js');
const {ensureKnowledgeSnapshot}=await import('./knowledge.worker.js');
const {getWebsiteStore,invalidateWebsiteStore}=await import('../vectorstore/registry.js');
const {setSnapshotStorageForTests,snapshotSha256,loadLatestWebsiteSnapshot}=await import('../vectorstore/snapshotStorage.js');
const {crawl}=await import('../crawler/crawler.js');
const {getBusinessContext}=await import('../context/provider.js');
const {getKnowledgeStatus}=await import('./knowledge.service.js');
const {buildChatSafetyPlan,composeSafeChatReply}=await import('../language/chatSafety.js');
const {buildPopupCopyPlan,checkPopupGrounding}=await import('../intelligence/popupGrounding.js');
const {NOVACARE_FACTS,fixtureHtml}=await import('./phase3Fixtures.js');
import type {KnowledgeSnapshot,EmbeddedChunk} from '../context/types.js';
const instructions={businessName:'NovaCare Clinic',language:'English',tone:'helpful',alwaysBookDemo:false,avoidDiscounts:true,websiteUrl:'https://fixture.test'};
const objects=new Map<string,Buffer>();
const storage={provider:'R2' as const,async read(key:string){return objects.has(key)?{bytes:objects.get(key)!,etag:null}:null;},async write(key:string,bytes:Buffer){if(objects.has(key))throw Error('immutable key');objects.set(key,bytes);return {provider:'R2' as const,storageKey:key,contentSha256:snapshotSha256(bytes),contentBytes:bytes.length,etag:null};},async delete(key:string){objects.delete(key);}};
function document(content:string,id='old'):EmbeddedChunk{return {id,content,embedding:[1,0],page:'/facts',url:'https://fixture.test/facts',pageType:'faq',section:'clinic',heading:'Clinic facts',title:'Clinic facts',language:'English',hash:id,lastCrawled:''};}
function snapshot(content='Dental cleaning starts at ₹1,200.',id='old'):KnowledgeSnapshot{return {version:1,embeddingModel:config.gemini.embeddingModel,dimensions:2,createdAt:new Date().toISOString(),sourceUrl:'https://fixture.test',siteLinks:[{label:id,url:'/'+id}],pages:[{url:'https://fixture.test/facts',path:'/facts',pageType:'faq',contentHash:id,lastCrawled:''}],documents:[document(content,id)]};}
function reset(){rows=[];jobs=[];objects.clear();failPublish=false;dbDown=false;invalidateWebsiteStore('site');setSnapshotStorageForTests(storage);const previous=snapshot();objects.set('old',Buffer.from(JSON.stringify(previous)));rows.push({id:'old',websiteId:'site',organizationId:'org',status:'READY',storageKey:'old',storageProvider:'R2',contentSha256:null});return previous;}
async function source(facts=NOVACARE_FACTS,missing?:404|410){return crawl('https://fixture.test',{knownUrls:missing?['https://fixture.test/removed']:[]},{sleep:async()=>{},fetch:async url=>{const path=new URL(url).pathname;let status=200,body='',type='text/html';if(path==='/robots.txt'||path==='/sitemap.xml')status=404;else if(path==='/removed')status=missing??404;else if(path==='/')body=fixtureHtml('Clinic','<main><p>Online booking is available.</p></main>'+facts.map((_,i)=>`<a href="/fact-${i}">Fact</a>`).join(''));else body=fixtureHtml('Clinic',`<main><p>${facts[Number(path.split('-').at(-1))]}</p></main>`);return {url,status,body:Buffer.from(body),headers:{'content-type':type}};}});}
const embed=async(chunks:any[])=>chunks.map(chunk=>({...chunk,embedding:[1,0]}));
const options={websiteId:'site',organizationId:'org',snapshotId:'new',language:'English'};
const fence=()=>({id:'job',websiteId:'site',organizationId:'org',lockedBy:'worker',attempt:1});
const addJob=()=>{const row={...fence(),status:'RUNNING',snapshotId:'new',leaseExpiresAt:new Date(Date.now()+60000)};jobs.push(row);rows.push({id:'new',websiteId:'site',organizationId:'org',status:'BUILDING',storageProvider:'R2',storageKey:''});return row;};
const write=async(snap:KnowledgeSnapshot)=>storage.write(snap.publication!.id,Buffer.from(JSON.stringify(snap)));

test('staging keeps old reader active until fenced publication commits',async()=>{
 const previous=reset();await getWebsiteStore('site');const job=addJob();
 const result=await ingest('https://fixture.test',options,{previous:async()=>previous,crawl:async()=>source(),embed:async chunks=>{assert.equal((await getWebsiteStore('site')).store.export()[0].id,'old');return embed(chunks);},write});
 assert.equal((await getWebsiteStore('site')).store.export()[0].id,'old');await publishKnowledgeBuild(job,'new',result.snapshotArtifact,result.snapshot);
 assert.equal(jobs[0].status,'SUCCESS');assert.equal((await getWebsiteStore('site')).meta!.activeVersion,'new');assert.equal((await getWebsiteStore('site')).store.size(),8);
});
for(const failure of ['embedding','storage','index-vector'] as const)test(`failed ${failure} retains previous index and bytes`,async()=>{
 const previous=reset();await getWebsiteStore('site');await assert.rejects(ingest('https://fixture.test',options,{previous:async()=>previous,crawl:async()=>source(),embed:failure==='embedding'?async()=>{throw Error('synthetic embedding failure');}:failure==='index-vector'?async chunks=>chunks.map(chunk=>({...chunk,embedding:[NaN,0]})):embed,write:failure==='storage'?async()=>{throw Error('synthetic storage failure');}:write}));
 assert.equal((await getWebsiteStore('site')).store.export()[0].id,'old');assert.ok(objects.has('old'));assert.equal(rows.filter(row=>row.status==='READY').length,1);
});
test('partial refresh writes only inactive diagnostics and performs no embeddings',async()=>{
 const previous=reset();let calls=0;const error=await ingest('https://fixture.test',options,{previous:async()=>previous,crawl:async()=>source(NOVACARE_FACTS,404),embed:async()=>{calls++;return [];},write}).then(()=>null,error=>error);
 assert.ok(error instanceof IncompleteBuildError);assert.equal(calls,0);assert.ok(error.artifact);assert.equal(JSON.parse(objects.get('new')!.toString()).documents.length,0);assert.equal((await getWebsiteStore('site')).store.export()[0].id,'old');
});
test('no-change refresh reuses all exact chunk vectors; changed price replaces old content',async()=>{
 reset();const first=await ingest('https://fixture.test',{...options,snapshotId:'one'},{previous:async()=>null,crawl:async()=>source(),embed,write});
 const second=await ingest('https://fixture.test',{...options,snapshotId:'two'},{previous:async()=>first.snapshot,crawl:async()=>source(),embed:async chunks=>{assert.equal(chunks.length,0);return [];},write});assert.equal(second.embeddingsReused,8);
 const changed=[...NOVACARE_FACTS];changed[0]='Dental cleaning starts at ₹1,500.';
 const third=await ingest('https://fixture.test',{...options,snapshotId:'three'},{previous:async()=>second.snapshot,crawl:async()=>source(changed),embed:async chunks=>{assert.equal(chunks.length,1);return embed(chunks);},write});
 assert.equal(third.embeddingsReused,7);assert.ok(third.snapshot.documents.some(c=>c.content.includes('₹1,500')));assert.ok(!third.snapshot.documents.some(c=>c.content.includes('₹1,200')));
});
test('explicit 410 is a removed source; timeout/404 is not inferred deletion',async()=>{
 const previous=reset();const result=await ingest('https://fixture.test',options,{previous:async()=>({...previous,pages:[...previous.pages,{...previous.pages[0],url:'https://fixture.test/removed'}]}),crawl:async()=>source(NOVACARE_FACTS,410),embed,write});assert.equal(result.snapshot.publication!.removed,1);
});
test('concurrent same-process builds coalesce by rejection without damaging active store',async()=>{
 const previous=reset();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const first=ingest('https://fixture.test',options,{previous:async()=>previous,crawl:async()=>source(),embed:async chunks=>{entered();await gate;return embed(chunks);},write});await started;
 await assert.rejects(ingest('https://fixture.test',options,{embed}),/already running/);release();await first;
});
test('cancelled build cannot publish late provider work',async()=>{
 const previous=reset(),controller=new AbortController();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const pending=ingest('https://fixture.test',{...options,signal:controller.signal},{previous:async()=>previous,crawl:async()=>source(),embed:async chunks=>{entered();await gate;return embed(chunks);},write});await started;controller.abort(Error('owner cancelled'));release();await assert.rejects(pending,/owner cancelled/);assert.ok(!objects.has('new'));
});
for(const failure of ['stale-attempt','expired','transaction'] as const)test(`publication fence rejects ${failure} and retains atomic READY/job state`,async()=>{
 reset();const result=await ingest('https://fixture.test',options,{previous:async()=>null,crawl:async()=>source(),embed,write}),job=addJob();
 if(failure==='stale-attempt')jobs[0].attempt=2;if(failure==='expired')jobs[0].leaseExpiresAt=new Date(0);if(failure==='transaction')failPublish=true;
 await assert.rejects(publishKnowledgeBuild({...job,attempt:1},'new',result.snapshotArtifact,result.snapshot));assert.equal(rows.find(row=>row.id==='new').status,'BUILDING');assert.equal(jobs[0].status,'RUNNING');assert.equal((await getWebsiteStore('site')).meta!.activeVersion,'old');
});
test('corrupt replacement or database outage cannot evict cached good knowledge; cold start can use older READY',async()=>{
 reset();await getWebsiteStore('site');rows.push({id:'broken',websiteId:'site',organizationId:'org',status:'READY',storageKey:'broken',storageProvider:'R2'});objects.set('broken',Buffer.from('invalid json'));
 assert.equal((await getWebsiteStore('site')).meta!.activeVersion,'old');dbDown=true;assert.equal((await getWebsiteStore('site')).meta!.activeVersion,'old');dbDown=false;
 invalidateWebsiteStore('site');assert.equal((await getWebsiteStore('site')).meta!.activeVersion,'old');assert.equal((await loadLatestWebsiteSnapshot('site')).snapshotId,'old');
});
test('new source chunks preserve chat known/unknown and popup factual validation',async()=>{
 reset();const result=await ingest('https://fixture.test',options,{previous:async()=>null,crawl:async()=>source(),embed,write});const context={websiteId:'site',business:{name:'NovaCare Clinic'},instructions,chunks:result.snapshot.documents.map(c=>({...c,score:.9})),siteLinks:[],businessActions:[],source:'rag' as const,scores:[]};
 for(const [query,state] of [['Dental cleaning price?','known_positive'],['Emergency dental treatment milta hai kya?','known_negative'],['Do you offer dental implants?','unknown']] as const)assert.equal(buildChatSafetyPlan(context,query,{language:'English',explicit:false}).state,state);
 const knowledge={query:'dental cleaning',knowledgeAvailable:true,unavailableReason:null,chunks:context.chunks,scores:[]};const plan=buildPopupCopyPlan(knowledge,instructions);
 assert.equal(checkPopupGrounding('Need help?','Dental cleaning starts at ₹1,200.',plan).ok,true);assert.equal(checkPopupGrounding('Need help?','Dental implants cost ₹1,200.',plan).ok,false);
});
test('snapshot validation rejects invalid dimensions, duplicates, partial candidates',()=>{
 for(const mutate of [(s:KnowledgeSnapshot)=>s.documents.push(s.documents[0]),(s:KnowledgeSnapshot)=>s.dimensions=3,(s:KnowledgeSnapshot)=>s.documents[0].embedding=[0,0]]){const candidate=snapshot();mutate(candidate);assert.throws(()=>validateKnowledgeSnapshot(candidate));}
});
test('restart recovers only a complete immutable upload through the same publication fence',async()=>{
 reset();const result=await ingest('https://fixture.test',options,{previous:async()=>null,crawl:async()=>source(),embed,write}),job=addJob();
 rows.find(row=>row.id==='new').storageKey=result.snapshotArtifact.storageKey;
 const recovered=await ensureKnowledgeSnapshot(job as any);assert.equal(recovered.recovered,true);assert.equal(jobs[0].status,'SUCCESS');assert.equal(rows.find(row=>row.id==='new').status,'READY');
});
test('restart does not promote partial diagnostics to READY',async()=>{
 reset();const job=addJob(),partial=snapshot();partial.publication={id:'new',completedAt:'',completeness:'partial',changed:0,unchanged:0,removed:0,embeddingsReused:0};partial.documents=[];
 const key='knowledge/v1/org/org/website/site/snapshot/new.json';objects.set(key,Buffer.from(JSON.stringify(partial)));
 assert.equal((await ensureKnowledgeSnapshot(job as any)).recovered,false);assert.equal(rows.find(row=>row.id==='new').status,'BUILDING');
});
test('tenant registry never selects a foreign website READY row',async()=>{
 reset();invalidateWebsiteStore('tenant-b');const other=snapshot('Foreign tenant private fixture facts.','other');objects.set('other',Buffer.from(JSON.stringify(other)));rows.push({id:'other',websiteId:'tenant-b',organizationId:'other-org',status:'READY',storageKey:'other',storageProvider:'R2'});
 assert.ok(!(await getWebsiteStore('site')).store.export().some(chunk=>chunk.content.includes('Foreign tenant')));assert.ok((await getWebsiteStore('tenant-b')).store.export()[0].content.includes('Foreign tenant'));
});
test('one retrieval request pins index and metadata across a concurrent publication',async t=>{
 reset();const previous=await getWebsiteStore('site');const replacement=snapshot('Dental cleaning starts at ₹1,500.','replacement');objects.set('replacement',Buffer.from(JSON.stringify(replacement)));
 const original=config.gemini.apiKey;(config.gemini as {apiKey:string}).apiKey='synthetic';t.after(()=>{(config.gemini as {apiKey:string}).apiKey=original;});
 t.mock.method(globalThis,'fetch',async()=>{if(!rows.some(row=>row.id==='replacement'))rows.push({id:'replacement',websiteId:'site',organizationId:'org',status:'READY',storageKey:'replacement',storageProvider:'R2'});return Response.json({embeddings:[{values:[1,0]}]});});
 const first=await getBusinessContext({query:'Dental cleaning price?',tenant:{websiteId:'site',instructions}});assert.equal(first.chunks[0].id,'old');assert.equal(first.siteLinks[0].label,'old');
 const next=await getBusinessContext({query:'Dental cleaning price?',tenant:{websiteId:'site',instructions}});assert.equal(next.chunks[0].id,'replacement');assert.equal(next.siteLinks[0].label,'replacement');
});
test('changing configured origin cannot reinterpret old site facts as a new business',async()=>{
 reset();const context=await getBusinessContext({query:'Dental cleaning price?',tenant:{websiteId:'site',instructions:{...instructions,websiteUrl:'https://different.test'}}});assert.equal(context.chunks.length,0);
});

test('owner last publish uses the successful active build time, not artifact creation time',async()=>{
 reset();const finishedAt=new Date('2026-10-25T12:00:00.000Z');
 jobs.push({id:'published-job',websiteId:'site',organizationId:'org',snapshotId:'old',status:'SUCCESS',finishedAt});
 assert.deepEqual((await getKnowledgeStatus('site')).snapshot?.lastSuccessfulPublish,finishedAt);
});
