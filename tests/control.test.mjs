import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, validateEvent, safePath } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { connections } from '../src/connectors.mjs';

const event=(id,name='page_view',project='wallet',extra={})=>({id,name,project,session:'session-a',visitor:'visitor-a',path:'/home',...extra});
test('client cannot claim a payment, lead, or authenticated identity',()=>{
  assert.throws(()=>validateEvent(event('a','payment_succeeded'),false,'secret'));
  assert.throws(()=>validateEvent(event('a','lead_created'),false,'secret'));
  const e=validateEvent(event('b','page_view','wallet',{userId:'private-id',amountMinor:10000}),false,'secret');
  assert.equal(e.user,'');assert.equal(e.amountMinor,null);
});
test('personal identifiers and unknown paths do not enter event metadata',()=>{
  for(const p of ['/profile?token=private','/api/transactions/12345?phone=966511111111','/person/private@example.com']){
    const e=validateEvent(event('x','page_view','wallet',{path:p,target:'966511111111',campaign:'private@example.com'}));
    assert.ok(!JSON.stringify(e).includes('private'));assert.equal(e.target,'');assert.equal(e.campaign,'');
  }
  assert.equal(safePath('/api/transactions/secret/cancel'),'/api/transactions/:id/cancel');
});
test('ingestion is idempotent per project, including server retry events',()=>{
  const s=new Store(':memory:','secret');s.add([event('same'),event('same')]);s.add([event('same','page_view','business')]);
  assert.equal(s.query().totals.views,2);assert.equal(s.query('wallet').totals.views,1);s.close();
});
test('a forged success page does not become revenue',()=>{
  const s=new Store(':memory:','secret');s.add([event('page','page_view','wallet',{path:'/success'})]);
  assert.equal(s.query().totals.payments,0);assert.equal(s.query().totals.revenueMinor,0);
  s.add([event('paid','payment_succeeded','wallet',{amountMinor:2599,currency:'SAR',userId:'account-1'})],true);
  s.add([event('paid','payment_succeeded','wallet',{amountMinor:2599,currency:'SAR',userId:'account-1'})],true);
  const d=s.query();assert.equal(d.totals.payments,1);assert.equal(d.totals.revenueMinor,2599);assert.equal(d.totals.identifiedUsers,1);s.close();
});
test('funnels require ordered stages in the same session and verified final outcome',()=>{
  const s=new Store(':memory:','secret');s.add([event('1','form_submit','business'),event('2','page_view','business'),event('3','form_start','business')]);
  s.add([event('4','lead_created','business')],true);
  assert.deepEqual(s.query().funnels.business.map(x=>x.count),[1,1,0,0]);
  s.add([event('5','form_submit','business')]);s.add([event('6','lead_created','business')],true);
  assert.deepEqual(s.query().funnels.business.map(x=>x.count),[1,1,1,1]);s.close();
});
test('retention removes old events and persisted records survive reopening',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rc-test-')),file=path.join(dir,'db.sqlite');
  let s=new Store(file,'secret',90);s.add([event('fresh'),event('old')]);s.db.prepare('UPDATE events SET ts=? WHERE id=?').run(Date.now()-91*86400000,'old');s.purge();s.close();
  s=new Store(file,'secret',90);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n,1);s.close();rmSync(dir,{recursive:true});
});
test('engagement and returning visitors respect sessions',()=>{
  const s=new Store(':memory:','secret');s.add([event('a'),event('b','engagement','wallet',{duration:15000}),event('c','page_view','wallet',{session:'session-b'})]);
  const d=s.query();assert.equal(d.totals.sessions,2);assert.equal(d.totals.returningVisitors,1);assert.equal(d.totals.bounceRate,50);assert.equal(d.totals.avgEngagementMs,7500);s.close();
});
test('performance percentile uses actual samples and missing measurements stay null',()=>{
  const s=new Store(':memory:','secret');s.add([100,200,300,400].map((v,i)=>event('perf-'+i,'performance','wallet',{metric:'LCP',value:v})));
  assert.equal(s.query().performance.find(x=>x.metric==='LCP').p75,300);assert.equal(s.query().performance.find(x=>x.metric==='INP').p75,null);s.close();
});
test('upstream analytics excludes names, phone masks and user lists',async()=>{
  const data=await connections({POC_ANALYTICS_PASSWORD:'test-upstream',POC_API_ORIGIN:'https://example.com'},async()=>new Response(JSON.stringify({users:12,conversations:20,transfers:8,totalAmounts:500,userList:[{name:'private-name',mobile:'054XXXXX'}]}),{status:200}));
  assert.equal(data.poc.metrics.users,12);assert.ok(!JSON.stringify(data).includes('private-name'));assert.equal(data.poc.scope,'all_time');
});
test('upstream rejection stays disconnected without exposing response bodies',async()=>{
  const data=await connections({POC_ANALYTICS_PASSWORD:'different-test',POC_API_ORIGIN:'https://example.com'},async()=>new Response('sensitive-response',{status:401}));assert.equal(data.poc.state,'error');assert.ok(!JSON.stringify(data).includes('sensitive-response'));
});
test('API protects admin data, validates origins, and separates browser/server ingestion',async(t)=>{
  const store=new Store(':memory:','a'.repeat(32)),env={ADMIN_PASSWORD:'p'.repeat(40),SESSION_SECRET:'s'.repeat(40),SERVER_INGEST_KEY:'k'.repeat(40),WALLET_ORIGINS:'https://wallet.example',BUSINESS_ORIGINS:'https://business.example',POC_ORIGINS:'https://poc.example',NODE_ENV:'test'};
  const {server}=createApp({env,store});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const origin='http://127.0.0.1:'+server.address().port;
  const post=(route,data,headers={})=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await fetch(origin+'/api/overview')).status,401);
  assert.equal((await post('/api/login',{password:env.ADMIN_PASSWORD},{Origin:'https://evil.example'})).status,403);
  const login=await post('/api/login',{password:env.ADMIN_PASSWORD},{Origin:origin});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await post('/api/events',{events:[event('evil')]},{Origin:'https://evil.example'})).status,403);
  assert.equal((await post('/api/events',{events:[event('mismatch','page_view','business')]},{Origin:'https://wallet.example'})).status,403);
  assert.equal((await post('/api/events',{events:[event('fake','payment_succeeded')]},{Origin:'https://wallet.example'})).status,400);
  assert.equal((await post('/api/events',{events:[event('real')]},{Origin:'https://wallet.example'})).status,202);
  assert.equal((await post('/api/server-events',{events:[event('paid','payment_succeeded')]},{})).status,401);
  assert.equal((await post('/api/server-events',{events:[event('paid','payment_succeeded','wallet',{amountMinor:900,currency:'SAR'})]},{Authorization:'Bearer '+env.SERVER_INGEST_KEY})).status,202);
  const overview=await fetch(origin+'/api/overview',{headers:{Cookie:cookie}});assert.equal(overview.status,200);assert.equal((await overview.json()).totals.revenueMinor,900);
  const exported=await fetch(origin+'/api/export',{headers:{Cookie:cookie}});assert.match(exported.headers.get('content-type'),/text\/csv/);assert.match(await exported.text(),/payment_succeeded/);
});
