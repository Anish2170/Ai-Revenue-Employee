import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {gzipSync} from 'node:zlib';
import {safeFetch,UnsafeUrlError,isPublicAddress} from './ssrf.js';
const lookup=async()=>[{address:'93.184.216.34',family:4}];
function mockHttp(t:TestContext,handler:(options:any)=>{status?:number;headers?:Record<string,string|undefined>;body?:string|Buffer}){
 const calls:any[]=[];
 t.mock.method(https,'request',((options:any,callback:any)=>{
  calls.push(options);const request:any=new EventEmitter();request.destroy=(error:Error)=>{request.emit('error',error);request.emit('close');};
  request.end=()=>queueMicrotask(()=>{const value=handler(options),response:any=new PassThrough();response.statusCode=value.status??200;response.headers=value.headers??{};response.on('close',()=>request.emit('close'));callback(response);response.end(value.body??'ok');});
  return request;
 }) as any);return calls;
}
test('static transport pins the validated address and preserves TLS host identity',async t=>{
 const calls=mockHttp(t,()=>({body:'public fact'}));let queries=0;const result=await safeFetch('https://fixture.test/page',{timeoutMs:1000,lookup:async()=>{queries++;return lookup();}});
 assert.equal(result.body.toString(),'public fact');assert.equal(queries,1);assert.equal(calls[0].hostname,'93.184.216.34');assert.equal(calls[0].servername,'fixture.test');assert.equal(calls[0].headers.Host,'fixture.test');
});
for(const destination of ['http://127.0.0.1/','http://169.254.169.254/','http://[::ffff:7f00:1]/'])test(`redirect private target rejected before second socket: ${destination}`,async t=>{
 const calls=mockHttp(t,()=>({status:302,headers:{location:destination}}));await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:1000,lookup}),UnsafeUrlError);assert.equal(calls.length,1);
});
test('same-origin scope rejects a public cross-origin redirect',async t=>{
 const calls=mockHttp(t,()=>({status:302,headers:{location:'https://foreign.test/data'}}));await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:1000,lookup,allowedOrigin:'https://fixture.test'}),UnsafeUrlError);assert.equal(calls.length,1);
});
test('redirect loops are bounded to six socket attempts',async t=>{
 const calls=mockHttp(t,()=>({status:302,headers:{location:'/loop'}}));await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:1000,lookup}),UnsafeUrlError);assert.equal(calls.length,6);
});
for(const headers of [{},{'content-length':'100'}])test(`streamed/header response size limit is enforced: ${JSON.stringify(headers)}`,async t=>{
 mockHttp(t,()=>({headers,body:'x'.repeat(100)}));await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:1000,lookup,maxBytes:20}),/size limit/);
});
test('DNS wait respects application deadline',async()=>{
 const hold=setTimeout(()=>{},100);try{await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:15,lookup:async()=>new Promise(()=>{})}),/timeout|aborted/i);}finally{clearTimeout(hold);}
});
test('mixed public/private DNS answer is never permitted',async()=>{
 await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:1000,lookup:async()=>[...await lookup(),{address:'10.0.0.1',family:4}]}),UnsafeUrlError);
});
for(const ip of ['::ffff:127.0.0.1','::ffff:7f00:1','::7f00:1','2002:7f00:1::','64:ff9b::7f00:1','2001:db8::1'])test(`IPv6 transition/reserved address blocked: ${ip}`,()=>assert.equal(isPublicAddress(ip),false));
test('compressed source is decoded before robots/content parsing',async t=>{
 mockHttp(t,()=>({headers:{'content-encoding':'gzip'},body:gzipSync('User-agent: *\nDisallow: /private')}));
 assert.match((await safeFetch('https://fixture.test/robots.txt',{timeoutMs:1000,lookup})).body.toString(),/Disallow: \/private/);
});
test('compressed expansion cannot exceed decoded response budget',async t=>{
 mockHttp(t,()=>({headers:{'content-encoding':'gzip'},body:gzipSync('x'.repeat(10000))}));await assert.rejects(safeFetch('https://fixture.test',{timeoutMs:1000,lookup,maxBytes:100}),/decoding|size/);
});
