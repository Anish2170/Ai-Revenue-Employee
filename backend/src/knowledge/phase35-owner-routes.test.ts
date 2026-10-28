/** Actual owner router/auth/CSRF HTTP integration; persistence is a fixture,
 * deliberately NOT evidence of a real PostgreSQL transaction or owner account. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
process.env.DATABASE_URL='';process.env.OPENAI_API_KEY='';process.env.GEMINI_API_KEY='';process.env.DEBUG_TRACE='false';
process.env.FRONTEND_URL='http://localhost:3001';process.env.DASHBOARD_ORIGIN='http://localhost:3001';process.env.CORS_ORIGIN='http://localhost:3001';
const site=randomUUID(),otherSite=randomUUID(),org='owner-org',otherOrg='other-org',buildId=randomUUID(),snapshotId=randomUUID();
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const sessions=new Map([['owner',org],['foreign',otherOrg]].map(([token,organizationId])=>[hash(token),{id:token,userId:token,organizationId,expiresAt:new Date(Date.now()+60000),revokedAt:null,user:{id:token,deletedAt:null},organization:{id:organizationId,deletedAt:null}}]));
const websites=[{id:site,organizationId:org,url:'https://93.184.216.34',deletedAt:null},{id:otherSite,organizationId:otherOrg,url:'https://93.184.216.34',deletedAt:null}];
let jobs:any[]=[{id:buildId,websiteId:site,organizationId:org,snapshotId,status:'RUNNING',currentPhase:'crawling',attempt:1,maxAttempts:3,createdAt:new Date()}];
let rows:any[]=[{id:snapshotId,websiteId:site,organizationId:org,status:'BUILDING',storageKey:'fixture',storageProvider:'LOCAL'}];
const matches=(row:any,where:any)=>Object.entries(where??{}).every(([key,value]:[string,any])=>value?.in?value.in.includes(row[key]):row[key]===value);
const fake:any={session:{findUnique:async({where}:any)=>sessions.get(where.tokenHash)??null},organizationMember:{findUnique:async()=>({role:'OWNER'})},website:{findFirst:async({where}:any)=>websites.find(row=>matches(row,where))??null},knowledgeBuild:{findFirst:async({where}:any)=>jobs.find(row=>matches(row,where))??null,create:async({data}:any)=>{const row={id:randomUUID(),createdAt:new Date(),...data};jobs.push(row);return row;},updateMany:async({where,data}:any)=>{const selected=jobs.filter(row=>matches(row,where));for(const row of selected)Object.assign(row,data);return {count:selected.length};}},knowledgeSnapshot:{findFirst:async({where}:any)=>rows.find(row=>matches(row,where))??null,create:async({data}:any)=>{const row={id:randomUUID(),...data};rows.push(row);return row;}},$queryRaw:async()=>[{id:site}],$transaction:async(fn:any)=>fn(fake)};
(globalThis as any).prisma=fake;
const {knowledgeRouter}=await import('./knowledge.routes.js');
const {csrfTokenForSession}=await import('../auth/auth.middleware.js');
const {setSnapshotStorageForTests}=await import('../vectorstore/snapshotStorage.js');
const manifest={version:1,scope:'fixture scope',completeWithinScope:false,discovered:3,attempted:2,fetched:1,useful:1,rendered:0,duplicates:0,failed:1,skipped:0,networkRequests:4,limits:['page_budget'],entries:[],discoveredCategoriesNotFetched:['policy']};
setSnapshotStorageForTests({provider:'LOCAL',write:async()=>{throw Error('No storage writes allowed');},delete:async()=>{throw Error('No storage deletes allowed');},read:async()=>({bytes:Buffer.from(JSON.stringify({crawlManifest:manifest})),etag:null})});
const app=express();app.use(express.json());app.use(cookieParser());app.use(knowledgeRouter);
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({error:'controlled route error'}));
let server:ReturnType<typeof app.listen>,base:string;
before(async()=>{await new Promise<void>(r=>{server=app.listen(0,'127.0.0.1',r);});base='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port;});
after(async()=>{setSnapshotStorageForTests(null);await new Promise<void>(r=>server.close(()=>r()));});
const headers=(token='owner',csrf=true)=>({'Content-Type':'application/json',Cookie:'aire_session='+token,Origin:'http://localhost:3001',...(csrf?{'X-CSRF-Token':csrfTokenForSession(token)}:{})});

test('unauthenticated owner manifest is denied',async()=>{assert.equal((await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/manifest`)).status,401);});
test('authenticated owner sees scoped partial manifest and diagnostics',async()=>{const response=await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/manifest`,{headers:headers()});assert.equal(response.status,200);assert.deepEqual(await response.json(),manifest);});
test('status preserves partial coverage instead of implying successful complete crawl',async()=>{const response=await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}`,{headers:headers()});assert.equal(response.status,200);const body:any=await response.json();assert.equal(body.status,'RUNNING');assert.equal(body.coverage.completeWithinScope,false);assert.deepEqual(body.coverage.missingCategories,['policy']);});
test('foreign owner cannot read another tenant manifest',async()=>{assert.equal((await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/manifest`,{headers:headers('foreign')})).status,404);});
test('foreign owner cannot cancel another tenant job',async()=>{assert.equal((await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/cancel`,{method:'POST',headers:headers('foreign')})).status,404);assert.equal(jobs[0].status,'RUNNING');});
test('owner cancellation requires CSRF and changes only scoped active job',async()=>{assert.equal((await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/cancel`,{method:'POST',headers:headers('owner',false)})).status,403);const response=await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/cancel`,{method:'POST',headers:headers()});assert.deepEqual(await response.json(),{cancelled:true});assert.equal(jobs[0].status,'CANCELLED');});
test('cancel retry is idempotent and does not revive cancelled job',async()=>{const response=await fetch(`${base}/api/websites/${site}/knowledge/build/${buildId}/cancel`,{method:'POST',headers:headers()});assert.deepEqual(await response.json(),{cancelled:false});assert.equal(jobs[0].status,'CANCELLED');});
test('owner build enqueue and duplicate refresh reuse one active job',async()=>{
 const url=`${base}/api/websites/${site}/knowledge/build`,body=JSON.stringify({url:'https://93.184.216.34'});
 const first=await fetch(url,{method:'POST',headers:headers(),body});assert.equal(first.status,202);const a:any=await first.json();assert.equal(a.created,true);
 const second=await fetch(url,{method:'POST',headers:headers(),body});assert.equal(second.status,202);const b:any=await second.json();assert.equal(b.created,false);assert.equal(a.buildId,b.buildId);
});
test('owner build cannot silently switch configured source origin',async()=>{const response=await fetch(`${base}/api/websites/${site}/knowledge/build`,{method:'POST',headers:headers(),body:JSON.stringify({url:'https://unrelated.invalid'})});assert.equal(response.status,400);assert.equal((await response.json() as any).error,'source_origin_mismatch');});
