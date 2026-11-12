import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';

const event=(id,name,userId,extra)=>({id,name,userId,path:'/home',...extra});
const metric=(report,key)=>report.metrics.find(row=>row.key===key).value;

test('dashboard includes recovered visits once and keeps website counts across days',()=>{
  const store=new Store(':memory:','key',0);
  const cutoff=Date.now()-2*86400000;
  store.insertRecoveredReports([
    {capturedAt:new Date(cutoff-1000).toISOString(),metrics:[{key:'businessVisits',value:3}]},
    {capturedAt:new Date(cutoff).toISOString(),metrics:[{key:'businessVisits',value:4},{key:'businessClicks',value:2}]}
  ]);
  const visit=id=>event(id,'page_view','',{project:'business',visitor:'visitor',session:id});
  store.add([visit('recovered'),visit('new'),event('click','click','',{project:'business',target:'button-faq-1'})]);
  store.db.prepare('UPDATE events SET ts=? WHERE project=?').run(cutoff+500,'business');
  store.db.prepare('UPDATE events SET ts=? WHERE id=?').run(cutoff-500,'recovered');
  store.add([event('whatsapp-transfer','transfer_succeeded','poc-user',{project:'poc'})],true);
  const report=store.dashboard();
  assert.equal(metric(report.website,'businessVisits'),5);
  assert.equal(metric(report.website,'businessClicks'),3);
  assert.equal(report.website.clicks[0].target,'button-faq-1');
  assert.equal(report.website.unattributedClicks,2);
  assert.equal(metric(report.wallet,'operations'),null);
  assert.equal(report.recoveredReports,undefined);
  assert.equal(store.report().recoveredReports.length,2);
  store.close();
});
