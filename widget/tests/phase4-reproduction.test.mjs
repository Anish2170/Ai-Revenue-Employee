import assert from 'node:assert/strict';
import test from 'node:test';
import {browser,config} from './runtime.mjs';

test('page-aware chat behaviour preserves meaningful product query variants',()=>{
 const page=browser();page.context.window.location.pathname='/products/shirt';page.context.window.location.search='?size=large';const app=new page.Orchestrator(config);assert.equal(app.currentBehaviourSnapshot().page,'/products/shirt?size=large');
});
test('SPA navigation cancels pending page-dependent chat without closing chat',()=>{
 const page=browser(),app=new page.Orchestrator(config);let cancelled=0;app.chat={onNavigation(){cancelled++;}};app.safety.navigate=()=>{};app.dismissPopup=()=>{};app.onNavigation();assert.equal(cancelled,1);assert.ok(app.chat);
});
test('chat renders and retains more than one source without duplicate URLs',()=>{
 const page=browser();page.context.document.createElement=()=>({append(){},appendChild(){},setAttribute(){},classList:{add(){},remove(){}}});
 let handlers;const api={streamChat(_m,_b,_id,value){handlers=value;return ()=>{};}};
 const chat=new page.ChatWindow({},api,()=>({}),()=>{});chat.setStreaming=()=>{};chat.scrollToBottom=()=>{};chat.appendBubble=()=>({appendChild(){},textContent:''});let rendered=0;chat.appendSource=()=>{rendered++;return {};};chat.streamReply('Compare plans');
 handlers.onToken('Grounded answer.');handlers.onSource({title:'Price',url:'https://customer.test/pricing'});handlers.onSource({title:'Policy',url:'https://customer.test/refund'});handlers.onSource({title:'Policy',url:'https://customer.test/refund'});handlers.onDone();assert.equal(rendered,2);assert.equal(chat.history.at(-1).sources.length,2);
});

test('late callbacks after navigation cannot mutate a newer chat response',()=>{
 const page=browser();page.context.document.createElement=()=>({append(){},appendChild(){},setAttribute(){},classList:{add(){},remove(){}}});
 const callbacks=[];let aborts=0;const api={streamChat(_m,_b,_id,h){callbacks.push(h);return()=>aborts++;}};
 const chat=new page.ChatWindow({},api,()=>({}),()=>{});chat.scrollToBottom=()=>{};chat.appendBubble=()=>({appendChild(){},textContent:''});let sources=0;chat.appendSource=()=>{sources++;};
 chat.streamReply('First page');chat.onNavigation();assert.equal(aborts,1);chat.streamReply('New page');
 callbacks[0].onToken('Stale price');callbacks[0].onSource({title:'Stale',url:'https://customer.test/old'});callbacks[0].onDone();assert.equal(chat.streaming,true);assert.equal(chat.history.length,0);assert.equal(sources,0);
 callbacks[1].onToken('Current grounded answer');callbacks[1].onDone();assert.equal(chat.streaming,false);assert.equal(chat.history.at(-1).content,'Current grounded answer');
});

test('conversation restoration preserves multiple citations and legacy single source',()=>{
 const page=browser(),chat=new page.ChatWindow({}, {},()=>({}),()=>{});chat.messagesEl={innerHTML:''};chat.appendBubble=()=>{};const rendered=[];chat.appendSource=s=>rendered.push(s.url);
 const source={title:'Price',url:'https://customer.test/price'},policy={title:'Policy',url:'https://customer.test/refund'};
 chat.applyConversationResponse({conversations:[],conversation:{id:'conversation',messages:[{role:'assistant',content:'Verified',source,sources:[source,policy]},{role:'assistant',content:'Legacy',source}]}});
 assert.deepEqual(rendered,[source.url,policy.url,source.url]);assert.equal(chat.history[0].sources.length,2);
});
