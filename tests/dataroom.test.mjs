import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createDataRoom} from '../src/dataroom.mjs';
for (const storageMode of ['shared', 'dedicated']) test(storageMode + ': verified admin bypasses NDA, investor accepts once, private PDF is isolated',async()=>{
 const objects=new Map(),codes=new Map();
 const env={DATAROOM_BUCKET_ID:'private-room-bucket',TAROUT_BUCKET_ID:'control-bucket',DATAROOM_ACCESS_KEY:'test',DATAROOM_SECRET_KEY:'test',DATAROOM_ENCRYPTION_KEY:'x'.repeat(40),DATAROOM_EMAIL_API_KEY:'test',DATAROOM_FROM_EMAIL:'test@example.com',DATAROOM_STORAGE_MODE:storageMode,TAROUT_ACCESS_KEY:'control',TAROUT_SECRET_KEY:'secret'};
 const fetcher=async(url,options)=>{if(String(url).includes('resend.com')){const d=JSON.parse(options.body);codes.set(d.to[0],d.text.match(/\d{6}/)[0]);return new Response('{}');}const k=String(url);const shared=storageMode==='shared';assert.ok(new URL(k).pathname.startsWith('/api/storage/gateway/'+(shared?'control-bucket':'private-room-bucket')+'/dataroom/'));assert.equal(options.headers.Authorization,shared?'Bearer control:secret':'Bearer test:test');if(options.method==='PUT'){objects.set(k,Buffer.from(options.body));return new Response('');}return objects.has(k)?new Response(objects.get(k)):new Response('',{status:404});};
 const handle=createDataRoom(env,fetcher);
 async function call(route,data,token){const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);req.method=data===undefined?'GET':'POST';req.headers={authorization:token?'Bearer '+token:''};req.socket={remoteAddress:'test'};let result;const res={writeHead(status,headers){result={status,headers}},end(body){result.body=body;}};try{await handle(req,res,new URL('https://test/api/dataroom/'+route),(_,status,body)=>{result={status,body};},()=>true);}catch(e){result={status:e.status||500,body:e.message};}return result;}
 async function login(email){assert.equal((await call('request-code',{email})).status,200);const r=await call('verify-code',{email,code:codes.get(email)});assert.equal(r.status,200);return r.body;}
 const admin=await login('m@repay.sa');assert.equal(admin.needsNda,false);assert.equal((await call('list',undefined,admin.token)).status,200);
 assert.equal((await call('invite',{email:'investor@example.com',role:'dataroom',days:7},admin.token)).status,200);
 const user=await login('investor@example.com');assert.equal(user.needsNda,true);assert.equal((await call('list',undefined,user.token)).status,403);
 const accepted=await call('accept',{name:'Investor Test',agree:true,version:'NDA-v1'},user.token);assert.equal(accepted.status,200,JSON.stringify(accepted));
 const a=await call('list',undefined,admin.token);const f=a.body.files.find(x=>x.name.endsWith('.pdf'));assert.ok(f);assert.equal(f.parent,'private-nda');
 const pdf=await call('download?id='+f.id,undefined,admin.token);assert.equal(pdf.status,200);assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
 const u=await call('list',undefined,user.token);assert.equal(u.body.files.length,0);assert.ok(!u.body.folders.some(x=>x.id==='private-nda'));assert.equal((await call('download?id='+f.id,undefined,user.token)).status,404);
 const again=await login('investor@example.com');assert.equal(again.needsNda,false);assert.equal((await call('accept',{name:'Changed',agree:true,version:'NDA-v1'},again.token)).body.name,'Investor Test');assert.equal((await call('list',undefined,admin.token)).body.files.length,1);
});
