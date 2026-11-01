import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
for (const key of ['DATABASE_URL','OPENAI_API_KEY','GEMINI_API_KEY','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']) process.env[key] = '';
process.env.KNOWLEDGE_STORAGE_PROVIDER = 'local';
const { config } = await import('../config/index.js');
const { getWebsiteStore } = await import('../vectorstore/registry.js');
const { streamChatReply } = await import('../services/chatService.js');
const { __setProvidersForTests } = await import('../llm/index.js');
const { logger } = await import('../logging/logger.js');
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/dental-snapshot.json',import.meta.url),'utf8'));
async function setup(t: TestContext, embeddingFailure = false) {
  const websiteId = 'factual-pipeline'; const { store } = await getWebsiteStore(websiteId);
  store.import(snapshot.documents.map((d: object) => ({ ...d, embedding: [1,0] })));
  const key = config.gemini.apiKey; (config.gemini as {apiKey:string}).apiKey = 'local-mock';
  t.after(() => { (config.gemini as {apiKey:string}).apiKey=key; __setProvidersForTests(null,null); });
  t.mock.method(globalThis,'fetch',async (url: string | URL | Request) => { assert.match(String(url),/embedContents?/); if(embeddingFailure)throw Error('mock embedding failure'); return Response.json({embeddings:[{values:[1,0]}]}); });
  return { messages: [{role:'user' as const,content:'teeth whitening price?'}],tenant:{websiteId,instructions:{businessName:'Dental',websiteUrl:snapshot.sourceUrl,language:'English',tone:'concise',alwaysBookDemo:false,avoidDiscounts:true}} };
}
async function collect(input: Parameters<typeof streamChatReply>[0]) { const events=[]; for await(const event of await streamChatReply(input))events.push(event); return {text:events.filter(e=>e.type==='token').map(e=>e.text).join(''),events}; }
for(const failure of [false,true]) test(`real pipeline direct fact with ${failure?'failed':'mocked'} embeddings and no generation provider`,async t=>{
  const input=await setup(t,failure), result=await collect(input);
  assert.match(result.text,/\$399.*In-office 60-minute session/s);
  assert.deepEqual(result.events.find(e=>e.type==='source'),{type:'source',source:{title:'SmileCraft Dental Clinic | Modern Family & Cosmetic Dentistry',url:snapshot.sourceUrl+'pricing'}});
});
test('simple answers do not invoke the available mocked provider',async t=>{
  const input=await setup(t); let calls=0;
  __setProvidersForTests({id:'mock',async *streamText(){calls++;yield 'wrong';},async generateStructured(){throw Error('unexpected');},async embed(){throw Error('unexpected');}},null);
  assert.match((await collect(input)).text,/\$399/);assert.equal(calls,0);
});
test('broad Services keeps actual catalog records among equal-score whole pages',async t=>{
  const input=await setup(t);input.messages[0].content='Services';
  const result=await collect(input);assert.match(result.text,/Composite White Cavity Filling is available/);assert.match(result.text,/Teeth Whitening/);assert.ok(result.text.length<900);
});
for(const mode of ['safe','unsafe','failure','failover'] as const)test(`explanation reaches model path and guards ${mode} result`,async t=>{
  const input=await setup(t);input.messages[0].content='Explain teeth whitening price?';let calls=0,fallbackCalls=0;
  const safe='Philips Zoom Laser Teeth Whitening costs $399. In-office 60-minute session.';
  const logEntries:unknown[]=[];t.mock.method(logger,'info',(message: string,detail?: unknown)=>{if(message.startsWith('[llm] generation attempt'))logEntries.push({message,detail});});
  __setProvidersForTests({id:'mock-primary',async *streamText(){calls++;if(mode==='failover')throw Object.assign(Error('rate limited'),{status:429});if(mode==='failure'){yield 'Your booking is confirmed.';throw Error('mock failure');}yield mode==='safe'?safe:'Teeth whitening costs $1.';},async generateStructured(){throw Error('unexpected');},async embed(){throw Error('unexpected');}}, {id:'mock-fallback',async *streamText(){fallbackCalls++;yield safe;},async generateStructured(){throw Error('unexpected');},async embed(){throw Error('unexpected');}});
  const result=await collect({...input,debug:{requestId:'correlated-local'}});assert.equal(calls,1);assert.equal(result.text,safe);assert.equal(fallbackCalls,mode==='failover'?1:0);
  assert.doesNotMatch(result.text,/confirmed|\$1\./);assert.ok(logEntries.length>=1);assert.ok(JSON.stringify(logEntries).includes('correlated-local'));assert.ok(!JSON.stringify(logEntries).includes('Teeth whitening costs $1'));
});
test('tenant with no knowledge cannot receive Dental source records',async t=>{
  const input=await setup(t);input.tenant.websiteId='different-empty-tenant';const result=await collect(input);assert.doesNotMatch(result.text,/\$399/);assert.equal(result.events.some(e=>e.type==='source'),false);
});
test('diagnostics distinguish a provider attempt from the deterministic reply actually displayed',async t=>{
  const input=await setup(t);input.messages[0].content='Explain teeth whitening price?';
  const outcomes:Array<{route:string;providerStatus:string}>=[];
  t.mock.method(logger,'info',(message:string,detail?:unknown)=>{if(message==='[chat] response outcome')outcomes.push(detail as typeof outcomes[number]);});
  __setProvidersForTests({id:'mock',async *streamText(){yield 'Philips Zoom Laser Teeth Whitening costs $399. In-office 60-minute session.';},async generateStructured(){throw Error('unexpected');},async embed(){throw Error('unexpected');}},null);
  const result=await collect({...input,leadCaptureAvailable:true,allowLeadInvitation:true});
  assert.match(result.text,/\$399/);assert.match(result.text,/email address/);
  assert.equal(outcomes[0].providerStatus,'attempted');assert.equal(outcomes[0].route,'deterministic');
});
