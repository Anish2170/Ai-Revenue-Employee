import assert from 'node:assert/strict';
import test from 'node:test';
import { browser } from './runtime.mjs';
function dom(page) {
  const make = tag => {
    const node = { tag, className:'', dataset:{}, children:[], listeners:{}, textContent:'',
      setAttribute(name,value){this[name]=value;}, addEventListener(name,fn){this.listeners[name]=fn;},
      appendChild(child){this.children.push(child);return child;}, append(...children){this.children.push(...children);},
      querySelector(){return {textContent:''};}, focus(){}, remove(){},
    };
    node.classList = { contains: value => node.className.split(' ').includes(value), add:value=>node.className+=' '+value, remove(){} };
    return node;
  };
  page.context.document.createElement=make;page.context.requestAnimationFrame=fn=>fn();
  return make;
}
test('opening chat keeps message input/send/history controls and has no generic quick-suggestion bar',async()=>{
  const page=browser(),make=dom(page),layer=make('div');
  const chat=new page.ChatWindow(layer,{restoreConversation:async()=>null},()=>({}),()=>{});
  await chat.open();
  const all=[];const visit=n=>{all.push(n);n.children.forEach(visit);};visit(layer);
  assert.ok(all.some(n=>n.tag==='textarea'));assert.ok(all.some(n=>n['aria-label']==='Send message'));
  assert.ok(all.some(n=>n['aria-label']==='Switch conversation'));
  assert.equal(all.some(n=>/aire-suggestion/.test(n.className)),false);
  assert.equal(all.some(n=>['Pricing','Book Demo','Services','Enterprise'].includes(n.textContent)),false);
});
test('verified source button opens its destination with opener isolation',()=>{
  const page=browser(),make=dom(page),chat=new page.ChatWindow(make('div'),{},()=>({}),()=>{});
  chat.messagesEl=make('div');let opened;page.context.window.open=(...args)=>opened=args;
  const source={title:'Published pricing',url:'https://dental.example/pricing'};
  const wrapper=chat.appendSource(source),button=wrapper.children.find(n=>n.tag==='button');
  assert.equal(button['aria-label'],'Open Published pricing');button.listeners.click();
  assert.deepEqual(opened,[source.url,'_blank','noopener,noreferrer']);
});
