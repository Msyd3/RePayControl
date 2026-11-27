import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createDataRoom} from '../src/dataroom.mjs';
for (const storageMode of ['shared', 'dedicated', 'attached']) test(storageMode + ': password-protected admin bypasses NDA, investor accepts once, private PDF is isolated',async()=>{
 const objects=new Map();
 const env={DATAROOM_BUCKET_ID:'private-room-bucket',TAROUT_BUCKET_ID:'control-bucket',DATAROOM_ACCESS_KEY:'test',DATAROOM_SECRET_KEY:'test',DATAROOM_ENCRYPTION_KEY:'x'.repeat(40),DATAROOM_ADMIN_PASSWORD:'5555',DATAROOM_STORAGE_MODE:storageMode==='attached'?'shared':storageMode,TAROUT_ACCESS_KEY:'control',TAROUT_SECRET_KEY:'secret'};
 if(storageMode==='attached'){
  delete env.TAROUT_ACCESS_KEY;
  delete env.TAROUT_SECRET_KEY;
  Object.assign(env,{STORAGE_ENDPOINT:'https://s3.example.com',STORAGE_BUCKET:'attached-bucket',STORAGE_ACCESS_KEY_ID:'attached-key',STORAGE_SECRET_ACCESS_KEY:'secret'});
 }
 const fetcher=async(url,options)=>{const k=String(url);const shared=storageMode==='shared';if(storageMode==='attached'){assert.ok(k.startsWith('https://s3.example.com/attached-bucket/dataroom/'));assert.match(options.headers.Authorization,/^AWS4-HMAC-SHA256 Credential=attached-key\//);}else{assert.ok(new URL(k).pathname.startsWith('/api/storage/gateway/'+(shared?'control-bucket':'private-room-bucket')+'/dataroom/'));assert.equal(options.headers.Authorization,shared?'Bearer control:secret':'Bearer test:test');}if(options.method==='DELETE'){objects.delete(k);return new Response(null,{status:204});}if(options.method==='PUT'){objects.set(k,Buffer.from(options.body));return new Response('');}return objects.has(k)?new Response(objects.get(k)):new Response('',{status:404});};
 let handle=createDataRoom(env,fetcher);
 async function call(route,data,token){const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);req.method=data===undefined?'GET':'POST';req.headers={authorization:token?'Bearer '+token:''};req.socket={remoteAddress:'test'};let result;const res={writeHead(status,headers){result={status,headers}},end(body){result.body=body;}};try{await handle(req,res,new URL('https://test/api/dataroom/'+route),(_,status,body)=>{result={status,body};},()=>true);}catch(e){result={status:e.status||500,body:e.message};}return result;}
 async function login(email,password){const r=await call('login',{email,password});assert.equal(r.status,200);return r.body;}
 assert.equal((await login('m@repay.sa')).requiresPassword,true);
 assert.equal((await call('login',{email:'m@repay.sa',password:'1111'})).status,401);
 assert.equal((await call('login',{email:'unknown@example.com'})).status,403);
 const admin=await login('m@repay.sa','٥٥٥٥');assert.equal(admin.needsNda,false);assert.equal((await call('list',undefined,admin.token)).status,200);
 assert.equal((await call('invite',{email:'investor@example.com',role:'dataroom',days:7},admin.token)).status,200);
 const inviteFor=async(email,token)=>(await call('invites',undefined,token)).body.invites.find(i=>i.email===email);
 assert.equal((await inviteFor('investor@example.com',admin.token)).status,'Invited');
 const user=await login('investor@example.com');assert.equal(user.needsNda,true);assert.equal((await call('list',undefined,user.token)).status,403);
 assert.equal((await inviteFor('investor@example.com',admin.token)).status,'Pending');
 const accepted=await call('accept',{name:'Investor Test',agree:true,version:'NDA-v1'},user.token);assert.equal(accepted.status,200,JSON.stringify(accepted));
 assert.equal((await inviteFor('investor@example.com',admin.token)).status,'Accepted');
 const a=await call('list',undefined,admin.token);const f=a.body.files.find(x=>x.name.endsWith('.pdf'));assert.ok(f);assert.equal(f.parent,'private-nda');
 const pdf=await call('preview?id='+f.id,undefined,admin.token);assert.equal(pdf.status,200);assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
 const u=await call('list',undefined,user.token);assert.equal(u.body.files.length,0);assert.ok(!u.body.folders.some(x=>x.id==='private-nda'));assert.equal((await call('preview?id='+f.id,undefined,user.token)).status,404);
 const bytes=Buffer.from('Investor presentation');
 const uploaded=await call('upload',{name:'Presentation.txt',parent:'root-2',data:bytes.toString('base64')},admin.token);
 assert.equal(uploaded.status,201);
 handle=createDataRoom(env,fetcher);
 const newAdmin=await login('m@repay.sa','٥٥٥٥');
 const restored=await call('list',undefined,newAdmin.token);
 assert.equal(restored.body.files.length,2);
 const document=await call('preview?id='+uploaded.body.id,undefined,newAdmin.token);
 assert.deepEqual(document.body,bytes);
 const again=await login('investor@example.com');assert.equal(again.needsNda,false);assert.equal((await call('accept',{name:'Changed',agree:true,version:'NDA-v1'},again.token)).body.name,'Investor Test');assert.equal((await call('list',undefined,newAdmin.token)).body.files.length,2);
 assert.match(pdf.headers['Content-Disposition'],/^inline;/);
 assert.equal(pdf.headers['Content-Type'],'application/pdf');
 assert.equal((await call('delete',{kind:'file',id:uploaded.body.id},again.token)).status,403);
 const child=await call('folder',{name:'Nested',parent:'root-2'},newAdmin.token);
 const nested=await call('upload',{name:'Nested.txt',parent:child.body.id,data:bytes.toString('base64')},newAdmin.token);
 assert.equal(nested.status,201);
 assert.equal((await call('delete',{kind:'folder',id:child.body.id},newAdmin.token)).body.pending,0);
 assert.equal((await call('preview?id='+nested.body.id,undefined,newAdmin.token)).status,404);
 assert.equal((await call('delete',{kind:'file',id:uploaded.body.id},newAdmin.token)).body.pending,0);
 assert.equal((await call('preview?id='+uploaded.body.id,undefined,newAdmin.token)).status,404);
 assert.equal((await call('delete',{kind:'folder',id:'root-3'},newAdmin.token)).status,409);
 assert.equal(await handle.controlAccess({headers:{authorization:'Bearer '+again.token}}),null);
 assert.equal(await handle.controlAccess({headers:{authorization:'Bearer '+newAdmin.token}}),'owner');
 await call('invite',{email:'viewer@example.com',role:'viewer',days:7},newAdmin.token);
 const viewer=await login('viewer@example.com');
 assert.equal(viewer.needsNda,false);
 assert.equal(await handle.controlAccess({headers:{authorization:'Bearer '+viewer.token}}),'viewer');
 assert.equal((await call('list',undefined,viewer.token)).status,403);
 const before=await inviteFor('viewer@example.com',newAdmin.token);
 assert.equal(before.status,'Accepted');
 assert.equal((await call('edit-invite',{email:'viewer@example.com',role:'admin'},viewer.token)).status,403);
 assert.equal((await call('edit-invite',{email:'viewer@example.com',role:'admin'},newAdmin.token)).status,200);
 const after=await inviteFor('viewer@example.com',newAdmin.token);
 assert.equal(after.role,'admin');
 assert.equal(after.expiresAt,before.expiresAt);
 const promoted=await login('viewer@example.com','5555');
 assert.equal((await call('edit-invite',{email:'viewer@example.com',role:'admin',days:0},newAdmin.token)).status,400);
 const extended=await call('edit-invite',{email:'viewer@example.com',role:'admin',days:30},newAdmin.token);
 assert.equal(extended.status,200);
 assert.ok(Date.parse(extended.body.invite.expiresAt)>Date.parse(after.expiresAt)+22*86400000);
 assert.equal(await handle.controlAccess({headers:{authorization:'Bearer '+promoted.token}}),'admin');

 assert.equal((await login('viewer@example.com')).requiresPassword,true);
 assert.equal(await handle.controlAccess({headers:{authorization:'Bearer '+viewer.token}}),null);
 await call('revoke',{email:'viewer@example.com'},newAdmin.token);
 assert.equal(await handle.controlAccess({headers:{authorization:'Bearer '+viewer.token}}),null);

});
