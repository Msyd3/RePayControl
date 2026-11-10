import { createHmac } from 'node:crypto';
import { maskMobile } from './report.mjs';
export function initializeLeads(db){db.exec(`CREATE TABLE IF NOT EXISTS lead_records(id TEXT PRIMARY KEY,name TEXT NOT NULL,mobileMasked TEXT NOT NULL,submittedAt INTEGER);CREATE TABLE IF NOT EXISTS source_sync(source TEXT PRIMARY KEY,checkedAt INTEGER NOT NULL,sourceUrl TEXT NOT NULL);`);}
export function importLeadSnapshot(store,snapshot){
  if(!snapshot||!Array.isArray(snapshot.records)||snapshot.records.length>10000)throw Error('Invalid snapshot');
  const rows=snapshot.records.map(r=>{if(typeof r.key!=='string'||!r.key||typeof r.name!=='string')throw Error('Invalid lead');return {id:createHmac('sha256',store.secret).update('business-lead:'+r.key).digest('hex'),name:r.name.replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,120),mobileMasked:maskMobile(r.mobileMasked),submittedAt:r.submittedAt&&Number.isFinite(Date.parse(r.submittedAt))?Date.parse(r.submittedAt):null};});
  const q=store.db.prepare('INSERT INTO lead_records(id,name,mobileMasked,submittedAt) VALUES(?,?,?,?)');
  store.db.exec('BEGIN');try{store.db.prepare('DELETE FROM lead_records').run();for(const r of rows)q.run(...Object.values(r));store.db.prepare("INSERT INTO source_sync(source,checkedAt,sourceUrl) VALUES('google_sheets',?,?) ON CONFLICT(source) DO UPDATE SET checkedAt=excluded.checkedAt,sourceUrl=excluded.sourceUrl").run(Date.now(),'https://docs.google.com/spreadsheets/d/1s7wtAAzj8JmoERslw3h5W2n-7PltWAnjEL5Omzr1vPE/edit');store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return rows.length;
}
export function appendLeadSnapshot(report,store){
  const sync=store.db.prepare("SELECT * FROM source_sync WHERE source='google_sheets'").get();if(!sync)return report;
  const records=store.db.prepare('SELECT * FROM lead_records ORDER BY submittedAt DESC,id').all();
  const count=records.filter(r=>r.submittedAt>=report.range.start&&r.submittedAt<report.range.end).length;
  const m=report.metrics.find(x=>x.key==='leads');m.value=count;m.snapshotAt=sync.checkedAt;m.note='لقطة من طلبات التواصل المحفوظة، وليست اتصالًا مباشرًا مستمرًا';
  for(const r of records)report.users.push({id:r.id,project:'business',kind:'lead',name:r.name,mobile:r.mobileMasked,registeredAt:null,isNew:false,isActive:false,operations:null,conversations:null,avgTransfersPerConversation:null,repeatTransfers:null,repeatConversations:null,visits:null,repeatVisits:null,successful:null,failed:null,withdrawals:null,linkedBankAccounts:null,failureReasons:[],submittedAt:r.submittedAt});
  report.leadSnapshot={count:records.length,checkedAt:sync.checkedAt,mode:'snapshot'};
  return report;
}
