import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { maskMobile,rangeDates } from '../src/report.mjs';
const today=new Date(Date.now()+10800000).toISOString().slice(0,10);
const event=(id,name,userId='u1',extra={})=>({id,name,userId,project:'wallet',path:'/home',...extra});
const metric=(r,key)=>r.metrics.find(x=>x.key===key).value;
test('Saudi mobile is masked before persistence, including Arabic digits and international prefixes',()=>{
 assert.equal(maskMobile('+966501236396'),'050 XXXX 6396');assert.equal(maskMobile('٠٥٠١٢٣٦٣٩٦'),'050 XXXX 6396');assert.equal(maskMobile('00966501236396'),'050 XXXX 6396');assert.equal(maskMobile('invalid'),'—');
 const s=new Store(':memory:','key');s.profiles([{project:'wallet',userId:'u1',name:'مستخدم اختبار',mobile:'0501236396',registeredAt:new Date().toISOString(),linkedBankAccounts:2}]);const raw=JSON.stringify(s.db.prepare('SELECT * FROM user_profiles').all());assert.ok(!raw.includes('0501236396'));assert.match(raw,/050 XXXX 6396/);assert.ok(!raw.includes('"u1"'));s.close();
});
test('bank revenue charges 115 halalas once per successful withdrawal, never on a transfer or failed/pending withdrawal',()=>{
 const s=new Store(':memory:','key');s.add([event('w1','withdrawal_requested','u1',{operationId:'withdrawal-one'}),event('w2','withdrawal_succeeded','u1',{operationId:'withdrawal-one'}),event('w2','withdrawal_succeeded','u1',{operationId:'withdrawal-one'}),event('w3','withdrawal_succeeded','u1',{operationId:'withdrawal-two'}),event('w4','withdrawal_failed','u1',{operationId:'withdrawal-three',reasonCode:'bank_rejected'}),event('pay','payment_succeeded','u1',{amountMinor:50000,currency:'SAR'})],true);
 const r=s.report(today,today);assert.equal(metric(r,'revenue'),230);assert.equal(metric(r,'withdrawals'),2);assert.equal(metric(r,'withdrawalFailures'),1);assert.equal(r.issues[0].reason,'رفض البنك العملية');s.close();
});
test('transfer lifecycle is counted once, repeats are per user, and conversation count is not message count',()=>{
 const s=new Store(':memory:','key');s.add([event('t1','transfer_requested','u1',{operationId:'one'}),event('t2','transfer_succeeded','u1',{operationId:'one'}),event('t3','transfer_requested','u1',{operationId:'two'}),event('t4','transfer_failed','u1',{operationId:'two',reasonCode:'insufficient_balance'}),event('c1','conversation_started','u1',{operationId:'chat-one',project:'poc'}),event('c2','conversation_started','u1',{operationId:'chat-two',project:'poc'}),event('m1','message_received','u1',{project:'poc'}),event('m2','message_received','u1',{project:'poc'})],true);
 const r=s.report(today,today);assert.equal(metric(r,'operations'),2);assert.equal(metric(r,'successes'),1);assert.equal(metric(r,'failures'),1);assert.equal(metric(r,'transferRepeats'),1);assert.equal(metric(r,'conversations'),2);assert.equal(metric(r,'chatRepeats'),1);assert.equal(r.users.find(x=>x.project==='wallet').conversations,null);s.close();
});
test('new users use actual registration date and linked bank accounts use current snapshot',()=>{
 const s=new Store(':memory:','key');s.profiles([{project:'wallet',userId:'new',name:'حساب جديد',registeredAt:new Date().toISOString(),linkedBankAccounts:2},{project:'wallet',userId:'old',name:'حساب قديم',registeredAt:'2020-01-01T00:00:00Z',linkedBankAccounts:3}]);s.profiles([{project:'wallet',userId:'old',name:'حساب قديم',linkedBankAccounts:1}]);
 const r=s.report(today,today);assert.equal(metric(r,'users'),2);assert.equal(metric(r,'newUsers'),1);assert.equal(metric(r,'bankAccounts'),3);assert.equal(r.users.length,2);assert.equal(r.users.filter(x=>x.isNew).length,1);s.close();
});
test('today starts at Riyadh midnight; invalid or inverted dates are rejected',()=>{
 const r=rangeDates(undefined,undefined,Date.parse('2026-11-10T22:00:00Z'));assert.equal(r.from,'2026-11-11');assert.equal(new Date(r.start).toISOString(),'2026-11-10T21:00:00.000Z');assert.equal(r.end-r.start,86400000);assert.throws(()=>rangeDates('2026-02-30','2026-03-01'));assert.throws(()=>rangeDates('2026-11-12','2026-11-11'));
});
test('unconnected metrics stay unknown instead of synthetic zero; browser cannot claim banking results',()=>{
 const s=new Store(':memory:','key'),r=s.report(today,today);assert.equal(metric(r,'users'),null);assert.equal(metric(r,'revenue'),null);assert.equal(metric(r,'conversations'),null);assert.equal(r.users.length,0);assert.throws(()=>s.add([event('bad','withdrawal_succeeded')]));s.close();
});
