import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL='';process.env.DEBUG_TRACE='false';
let created:any;
(globalThis as any).prisma={conversationMessage:{create:async({data}:any)=>{created=data;return data;}},conversation:{update:async()=>({})},$transaction:async(work:any)=>Promise.all(work)};
const {appendAssistantMessage}=await import('./conversation.service.js');
test('multi-source response preserves all server citations in existing JSON metadata',async()=>{
 const sources=[{title:'Price',url:'https://example.test/pricing'},{title:'Policy',url:'https://example.test/refunds'}];
 await appendAssistantMessage({conversationId:'fixture',content:'Grounded answer.',source:sources[0],sources} as any);
 assert.deepEqual(created.sourceMetadata.citations,sources);assert.equal(created.sourceUrl,sources[0].url);
});
