import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function probe(openai: string, gemini: string, code: string) {
  const result = spawnSync(process.execPath, ['--import','tsx','--input-type=module','--eval',code], {
    cwd:process.cwd(), encoding:'utf8', timeout:10000,
    env:{...process.env,DATABASE_URL:'',OPENAI_API_KEY:openai,GEMINI_API_KEY:gemini,DEBUG_TRACE:'false',NODE_ENV:'development'},
  });
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
}
for (const [name,openai,gemini,available] of [
  ['both','synthetic-openai','synthetic-gemini',true],
  ['Gemini only','','synthetic-gemini',true],
  ['OpenAI only','synthetic-openai','',true],
  ['neither','','',false],
  ['whitespace','  ','\t',false],
] as const) test(`runtime readiness: ${name}`,()=>{
  assert.equal(probe(openai,gemini,`const {llmAvailable}=await import('./src/llm/index.ts');console.log(JSON.stringify(llmAvailable()));`),available);
});

for(const mode of ['stream','structured','deadline'] as const)test(`missing primary uses configured fallback without fake retry: ${mode}`,()=>{
  const result=probe('','synthetic-gemini',`
    const {streamChat,generateDecision,__setProvidersForTests}=await import('./src/llm/index.ts');
    let calls=0;
    __setProvidersForTests(null,{id:'gemini',streamText:async function*(){calls++;yield 'fallback';},generateStructured:async()=>{calls++;return {ok:true};},embed:async()=>[]});
    const mode=${JSON.stringify(mode)};
    let output;
    if(mode==='stream'){output='';for await(const token of streamChat({system:'safe',messages:[{role:'user',content:'hello'}]}))output+=token;}
    else output=await generateDecision({system:'safe',user:'hello',schema:{type:'object'},...(mode==='deadline'?{deadlineAt:Date.now()+2000}:{})});
    console.log(JSON.stringify({calls,output}));
  `);
  assert.equal(result.calls,1);assert.deepEqual(result.output,mode==='stream'?'fallback':{ok:true});
});

test('missing-primary fallback still respects caller cancellation',()=>{
 const result=probe('','synthetic-gemini',`
  const {streamChat,__setProvidersForTests}=await import('./src/llm/index.ts');let calls=0;
  __setProvidersForTests(null,{id:'gemini',streamText:async function*(){calls++;yield 'bad';},generateStructured:async()=>({}),embed:async()=>[]});
  const controller=new AbortController();controller.abort(Error('fixture cancelled'));let rejected=false;
  try{for await(const token of streamChat({system:'safe',messages:[],signal:controller.signal})){} }catch{rejected=true;}
  console.log(JSON.stringify({calls,rejected}));
 `);assert.deepEqual(result,{calls:0,rejected:true});
});

for(const [name,query,hindi]of [['English','What is the price?',false],['Hindi','कीमत क्या है?',true]] as const)test(`normal signed HTTP reports no-provider failure safely in ${name}`,()=>{
 const result=probe('','',`
  const {default:express}=await import('express');
  const {chatRouter}=await import('./src/routes/chat.ts');
  const {issuePublicWidgetIdentity}=await import('./src/widget/publicIdentity.ts');
  const realFetch=globalThis.fetch;let external=0;
  globalThis.fetch=(input,init)=>{if(!String(input).startsWith('http://127.0.0.1:')){external++;throw Error('No external network permitted');}return realFetch(input,init);};
  const app=express();app.use(express.json());app.use(chatRouter);
  let server;await new Promise(resolve=>server=app.listen(0,'127.0.0.1',resolve));
  const {identity,token}=issuePublicWidgetIdentity('no-provider-fixture');
  try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:identity.siteId,visitorId:identity.visitorId,sessionId:identity.sessionId,visitorToken:token,messages:[{role:'user',content:${JSON.stringify(query)}}]})});
   const text=await response.text();console.log(JSON.stringify({status:response.status,error:text.includes('"error"'),tokens:text.includes('"token"'),devanagari:/[\\u0900-\\u097f]/u.test(text),external}));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 `);assert.deepEqual(result,{status:200,error:true,tokens:false,devanagari:hindi,external:0});
});
