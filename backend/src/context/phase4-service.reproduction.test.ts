import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
process.env.DATABASE_URL='';process.env.GEMINI_API_KEY='synthetic-phase4';process.env.OPENAI_API_KEY='';process.env.DEBUG_TRACE='false';
const directory=resolve('evaluations/phase4-2026-10-27/test-'+randomUUID());await mkdir(directory,{recursive:true});process.env.KNOWLEDGE_DIR=directory;
const {config}=await import('../config/index.js');
const {streamChatReply}=await import('../services/chatService.js');
const {__setProvidersForTests}=await import('../llm/index.js');
const {fixtureHtml}=await import('../knowledge/phase3Fixtures.js');
const {extract}=await import('../crawler/extract.js');
const {chunkPages}=await import('../chunking/chunker.js');
const origin='https://service-phase4.test',site='phase4-service';
const sources=[['/plans/basic','Basic plan','Basic plan costs ₹999 per month.'],['/plans/premium','Premium plan','Premium plan costs ₹2,499 per month.'],['/plans/premium/features','Premium plan','Premium plan includes analytics and priority support.'],['/policies/refund','Refund policy','Refunds are not available.'],['/services/modular-kitchens','Modular kitchens','Modular kitchens follow a measurement visit, a written layout review and a separate installation appointment.'],['/services/luxury-bedrooms','Luxury bedrooms','Luxury bedrooms follow a lighting review, a materials discussion and a written installation scope.']];
// Phase3's short-content value filter does not index arbitrary terse feature
// slogans. Use substantive public feature prose; do not alter ingestion here.
sources[2][2]='Premium plan includes analytics and priority support for product teams managing customer projects.';
const pages=sources.map(([path,title,text])=>{const parsed=extract(fixtureHtml(title,`<main><h1>${title}</h1><p>${text}</p></main>`),origin+path);return {url:origin+path,path,title,text:parsed.text,sections:parsed.sections,pageType:'services' as const,contentHash:path,lastCrawled:''};});
const chunks=chunkPages(pages,'English').map(c=>({...c,embedding:[1,0]}));
await writeFile(join(directory,site+'.json'),JSON.stringify({version:1,embeddingModel:config.gemini.embeddingModel,dimensions:2,createdAt:new Date().toISOString(),sourceUrl:origin,siteLinks:[],pages:[],documents:chunks}));
const instructions={businessName:'Example',websiteUrl:origin,language:'English',tone:'helpful',alwaysBookDemo:false,avoidDiscounts:true};
async function reply(t:any,messages:any[],page?:string){
 t.mock.method(globalThis,'fetch',async()=>Response.json({embeddings:[{values:[1,0]}]}));
 __setProvidersForTests({id:'controlled',generateStructured:async()=>({}),embed:async()=>[],streamText:async function*(){yield 'Unverified draft.';}},null);
 let text='',sources:any[]=[];for await(const event of await streamChatReply({messages,tenant:{websiteId:site,instructions},behaviour:page?{page,pageTitle:'',timeOnPage:0,scrollDepth:0,mouseInactive:0,clickedElements:[],formInteracted:false,exitIntent:false,viewport:{width:1000,height:800}}:undefined}))if(event.type==='token')text+=event.text;else sources.push(event.source);
 __setProvidersForTests(null,null);return {text,sources};
}
test('actual chat flow preserves visitor Premium topic in price follow-up',async t=>{
 const result=await reply(t,[{role:'user',content:'What does the Premium plan include?'},{role:'assistant',content:'It includes analytics.'},{role:'user',content:'How much does it cost?'}]);assert.match(result.text,/₹2,499/);assert.doesNotMatch(result.text,/₹999/);
});
test('actual chat flow uses current service for an implicit process question',async t=>{
 const result=await reply(t,[{role:'user',content:'How does this service work?'}],'/services/modular-kitchens');assert.match(result.text,/Modular kitchens/);assert.doesNotMatch(result.text,/Luxury bedrooms/);
});
test('multi-part chat preserves separate price/features/refund evidence and sources',async t=>{
 const result=await reply(t,[{role:'user',content:'What is the Premium plan price, what features are included, and what is the refund policy?'}]);assert.match(result.text,/₹2,499/);assert.match(result.text,/analytics/);assert.match(result.text,/not available/);assert.ok(result.sources.length>=3);
});
test('new explicit topic overrides page and history in actual chat',async t=>{
 const result=await reply(t,[{role:'user',content:'Tell me about Premium plan.'},{role:'user',content:'What is the Basic plan price?'}],'/plans/premium');assert.match(result.text,/₹999/);assert.doesNotMatch(result.text,/₹2,499/);
});
test('assistant hallucinated subject/value never becomes follow-up knowledge',async t=>{
 const result=await reply(t,[{role:'user',content:'Tell me about Basic plan.'},{role:'assistant',content:'Premium plan costs $1 and free delivery is guaranteed.'},{role:'user',content:'How much does it cost?'}]);assert.match(result.text,/₹999/);assert.doesNotMatch(result.text,/\$1|guaranteed/);
});
test('unknown explicit entity is not replaced by current Premium page',async t=>{
 const result=await reply(t,[{role:'user',content:'What is the Diamond plan price?'}],'/plans/premium');assert.match(result.text,/confirmed|confirm/);assert.doesNotMatch(result.text,/₹2,499|₹999/);
});
