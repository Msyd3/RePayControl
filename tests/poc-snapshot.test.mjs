import test from 'node:test';
import assert from 'node:assert/strict';
import { pocSnapshot } from '../src/poc-snapshot.mjs';

test('WhatsApp snapshots preserve all-time request semantics and mask phones before leaving the server',async()=>{
 let auth;
 const result=await pocSnapshot({POC_API_ORIGIN:'https://poc.test',POC_ANALYTICS_PASSWORD:'mock-snapshot-test'},async(url,options)=>{auth=options.headers.Authorization;return {ok:true,json:async()=>({users:1,conversations:2,transfers:3,totalAmounts:150,averageAmounts:50,averageOperations:3,userList:[{name:'Example',mobile:'966501234567',operations:3,conversations:2,averageOperations:1.5}],unexpectedSecret:'must not leak'})};});
 assert.equal(auth,'Bearer mock-snapshot-test');assert.equal(result.scope,'all_time');assert.equal(result.metrics.transferRequests,3);assert.equal(result.users[0].mobile,'050 XXXX 4567');assert.equal(result.users[0].registeredAt,null);assert.equal(result.metrics.totalRequestedAmount,undefined);assert.ok(!JSON.stringify(result).includes('966501234567'));assert.ok(!JSON.stringify(result).includes('must not leak'));assert.equal(result.metrics.successes,undefined);assert.equal(result.metrics.revenue,undefined);
});
test('upstream authorization errors do not reveal bodies or manufacture zero counts',async()=>{
 const result=await pocSnapshot({POC_API_ORIGIN:'https://poc.test',POC_ANALYTICS_PASSWORD:'mock-error-test'},async()=>({ok:false,status:401,json:async()=>({password:'do not leak'})}));
 assert.equal(result.state,'error');assert.equal(result.metrics,undefined);assert.ok(!JSON.stringify(result).includes('do not leak'));
});
