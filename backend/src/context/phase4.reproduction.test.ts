import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL='';process.env.GEMINI_API_KEY='synthetic-phase4';process.env.OPENAI_API_KEY='';process.env.DEBUG_TRACE='false';
const {retrieve}=await import('./retriever.js');
const {MemoryVectorStore}=await import('../vectorstore/memoryStore.js');
const {buildChatSafetyPlan}=await import('../language/chatSafety.js');
const {buildStrategyKnowledgeQuery,retrieveStrategyKnowledge}=await import('../intelligence/knowledgeRetrieval.js');
const {strategy}=await import('../intelligence/__tests__/phase26Fixtures.js');
import type {EmbeddedChunk} from './types.js';
const origin='https://phase4.test';
function doc(id:string,heading:string,content:string,score=.8,path='/'+id):EmbeddedChunk{return {id,heading,title:heading,content,url:origin+path,page:path,pageType:path.includes('blog')?'blog':'services',section:heading,language:'English',hash:id,lastCrawled:'2026-10-27T00:00:00.000Z',embedding:[score,Math.sqrt(1-score*score)]};}
async function search(t:any,query:string,docs:EmbeddedChunk[],options:any={}){
 const store=new MemoryVectorStore();await store.indexDocuments(docs);let embeddingText='';
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{const body=await new Request(input,init).text();embeddingText=body;return Response.json({embeddings:[{values:[1,0]}]});});
 const result=await retrieve(query,'tenant-a',{pinnedStore:store,sourceUrl:origin,...options} as any);return {...result,embeddingText};
}
const kitchen=()=>doc('kitchen','Modular kitchens','Our modular kitchen design process starts with measurements and layout consultation before installation.',.75,'/services/modular-kitchens');
const bedroom=()=>doc('bedroom','Luxury bedrooms','Our luxury bedroom design process starts with measurements and lighting consultation before installation.',.95,'/services/luxury-bedrooms');

test('implicit same-page service question prefers indexed current subject',async t=>{
 const result=await search(t,'How does this service work?',[bedroom(),kitchen()],{page:{url:origin+'/services/modular-kitchens'}});assert.equal(result.chunks[0]?.id,'kitchen');
});
test('explicit different entity overrides current page preference',async t=>{
 const result=await search(t,'Explain luxury bedrooms',[bedroom(),kitchen()],{page:{url:origin+'/services/modular-kitchens'}});assert.equal(result.chunks[0]?.id,'bedroom');
});
test('plan identity can outrank a more similar wrong plan price',async t=>{
 const result=await search(t,'What is the Premium plan price?',[doc('basic','Basic plan','Basic plan costs ₹999 per month.',.95),doc('premium','Premium plan','Premium plan costs ₹2,499 per month.',.76)]);assert.equal(result.chunks[0]?.id,'premium');
});
test('same-name Plus qualifier cannot borrow the base plan price',async t=>{
 const result=await search(t,'Premium Plus plan price?',[doc('base','Premium plan','Premium plan costs ₹2,499 per month.',.96),doc('plus','Premium Plus plan','Premium Plus plan costs ₹3,499 per month.',.77)]);assert.equal(result.chunks[0]?.id,'plus');
});
test('tracking URL normalization preserves variant identity for implicit query',async t=>{
 const result=await search(t,'How much is this item?',[doc('small','Blue Medium','Blue Medium Shirt costs ₹1,800 per item.',.96,'/product?size=medium'),doc('large','Blue Large','Blue Large Shirt costs ₹2,000 per item.',.75,'/product?size=large')],{page:{url:origin+'/product?utm_source=test&size=large'}});assert.equal(result.chunks[0]?.id,'large');
});
test('updated SPA page hint does not retain prior service',async t=>{
 const result=await search(t,'How does this service work?',[bedroom(),kitchen()],{page:{url:origin+'/services/modular-kitchens'},history:['Tell me about luxury bedrooms.']});assert.equal(result.chunks[0]?.id,'kitchen');
});
test('visitor-only implicit follow-up carries Premium subject into retrieval',async t=>{
 const result=await search(t,'How much does it cost?',[doc('basic','Basic plan','Basic plan costs ₹999 per month.',.95),doc('premium','Premium plan','Premium plan costs ₹2,499 per month.',.75)],{history:['What does the Premium plan include?']});assert.equal(result.chunks[0]?.id,'premium');assert.match(result.embeddingText,/Premium/i);
});
test('explicit new topic beats visitor history',async t=>{
 const result=await search(t,'What is the Basic plan price?',[doc('basic','Basic plan','Basic plan costs ₹999 per month.',.75),doc('premium','Premium plan','Premium plan costs ₹2,499 per month.',.95)],{history:['What does Premium include?']});assert.equal(result.chunks[0]?.id,'basic');
});
test('duplicates cannot crowd out multi-part features and policy',async t=>{
 const docs=[...Array.from({length:6},(_,i)=>doc('copy-'+i,'Premium plan','Premium plan costs ₹2,499 per month.',.99-i*.01)),doc('features','Premium plan','Premium plan includes analytics and priority support.',.8),doc('refund','Refund policy','Refunds are not available.',.75)];
 const result=await search(t,'Premium plan price, features and refund policy?',docs);assert.ok(result.chunks.some(c=>c.id==='features'));assert.ok(result.chunks.some(c=>c.id==='refund'));assert.equal(result.chunks.filter(c=>c.content.includes('costs')).length,1);
});
test('relevant shared policy remains available across pages',async t=>{
 const result=await search(t,'Premium plan refund policy?',[...Array.from({length:6},(_,i)=>doc('premium-'+i,'Premium plan','Premium plan costs ₹2,499 per month.',.99-i*.01)),doc('refund','Refund policy','Refunds are not available.',.74,'/policies/refund')],{page:{url:origin+'/plans/premium'}});assert.ok(result.chunks.some(c=>c.id==='refund'));
});
test('oversized legacy first chunk does not starve smaller relevant evidence',async t=>{
 const result=await search(t,'Premium plan price?',[doc('long','Premium plan','Background information. '.repeat(600),.99),doc('price','Premium plan','Premium plan costs ₹2,499 per month.',.8)]);assert.ok(result.chunks.some(c=>c.id==='price'));assert.ok(result.chunks.every(c=>c.content.length<=9000));
});
test('conflict outside old topK/threshold cannot become settled current price',async t=>{
 const result=await search(t,'Premium plan price?',[doc('price','Premium plan','Premium plan costs ₹2,499 per month.',.96),doc('old','Premium plan','Premium plan costs ₹1,999 per month.',.4,'/blog/old-price')]);
 const context:any={business:{name:'Orbit'},instructions:{businessName:'Orbit',language:'English',tone:'helpful',alwaysBookDemo:false,avoidDiscounts:true,websiteUrl:origin},chunks:result.chunks,siteLinks:[],businessActions:[],source:'rag',scores:result.scores,retrieval:(result as any).diagnostics};
 assert.equal(buildChatSafetyPlan(context,'Premium plan price?',{language:'English',explicit:false}).state,'contradictory');
});
test('page hint cannot authorize a foreign tenant source',async t=>{
 const local=doc('local','Premium plan','Premium plan costs ₹2,499 per month.',.75),foreign={...doc('foreign','Premium plan','Premium plan costs $1 per month.',.99),url:'https://foreign.test/plans'};
 const result=await search(t,'Premium plan price?',[local,foreign],{page:{url:'https://foreign.test/plans'}});assert.ok(result.chunks.every(c=>c.url.startsWith(origin)));
});
test('metadata cannot rebind Basic source body to Premium price',async t=>{
 const result=await search(t,'Premium plan price?',[doc('fake','Premium plan','Basic plan costs ₹999 per month.',.99),doc('right','Premium plan','Premium plan costs ₹2,499 per month.',.75)]);assert.equal(result.chunks[0]?.id,'right');
});
test('popup query includes normalized current service context',()=>{
 const query=(buildStrategyKnowledgeQuery as any)(strategy('Educate'),{pagePath:'/services/modular-kitchens?utm_source=ad',sourceUrl:origin});assert.match(query,/modular.kitchens/i);
});
test('popup budget skips an oversized source instead of clipping it into the only fact',async()=>{
 const result=await retrieveStrategyKnowledge(strategy('Educate'),{maxChars:120,retrieveFn:async()=>({chunks:[{...doc('long','Services','Long material source. '.repeat(30)),score:.95},{...doc('short','Online booking','Online booking is available.'),score:.8}],scores:[.95,.8]})});assert.ok(result.chunks.some(c=>c.id==='short'));assert.ok(result.chunks.every(c=>!c.truncated));
});
