import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('no-database development server does not start a durable DB worker',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',`
  let calls=0;
  globalThis.prisma={knowledgeBuild:{findMany:async()=>{calls++;throw Error('unexpected DB access');}}};
  const {startKnowledgeBuildWorker,stopKnowledgeBuildWorker}=await import('./src/knowledge/knowledge.worker.ts');
  startKnowledgeBuildWorker();await new Promise(resolve=>setTimeout(resolve,50));stopKnowledgeBuildWorker();console.log(JSON.stringify({calls}));
 `],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:'',OPENAI_API_KEY:'',GEMINI_API_KEY:'',NODE_ENV:'development',DEBUG_TRACE:'false'},encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,'worker unexpectedly accessed DB or crashed process');
 assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)!),{calls:0});
});
