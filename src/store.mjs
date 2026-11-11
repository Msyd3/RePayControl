import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { initializeReport, controlReport, saveProfiles, insertProfiles, reasons } from './report.mjs';
import { initializeLeads, appendLeadSnapshot } from './leads.mjs';

export const projects = ['wallet', 'business', 'poc'];
export const browserEvents = new Set(['page_view','click','outbound_click','download','form_start','form_submit','scroll','engagement','performance','js_error','api_request']);
export const serverEvents = new Set(['user_registered','login_verified','otp_requested','otp_verified','checkout_started','payment_succeeded','payment_failed','transfer_requested','transfer_succeeded','transfer_failed','transfer_cancelled','withdrawal_requested','withdrawal_succeeded','withdrawal_failed','conversation_started','visit_identified','lead_created','message_received','message_sent','message_delivered','message_failed','ai_request','ai_failure','webhook_received','webhook_failed','bank_account_added','profile_updated']);
const token = /^[a-zA-Z0-9_.:-]{1,120}$/;
export function safePath(input) {
  // Dynamic path segments and query strings can contain transaction IDs, emails, phones or secrets.
  const paths = new Set(['/','/home','/login','/otp','/profile','/summary','/success','/failure','/bank-account','/api/leads','/api/session','/api/profile','/api/wallet','/api/auth/otp/request','/api/auth/otp/verify','/api/auth/otp/resend','/api/auth/logout','/api/bank-accounts','/webhooks/whatsapp','/health']);
  let p = String(input || '/').split(/[?#]/)[0].replace(/\/+$/, '').replace(/\.html$/, '') || '/';
  if (p === '/index') p = '/';
  if (paths.has(p)) return p;
  if (/^\/api\/transactions\/[^/]+(?:\/cancel)?$/.test(p)) return p.endsWith('/cancel') ? '/api/transactions/:id/cancel' : '/api/transactions/:id';
  if (/^\/api\/bank-accounts\/[^/]+$/.test(p)) return '/api/bank-accounts/:id';
  if (/^\/api\/transfer-reviews\/[^/]+$/.test(p)) return '/api/transfer-reviews/:id';
  return '/other';
}
export function validateEvent(raw, trusted = false, secret = '') {
  if (!raw || !projects.includes(raw.project) || !(trusted ? serverEvents : browserEvents).has(raw.name)) throw new Error('Invalid event');
  const id = String(raw.id || '');
  if (!token.test(id)) throw new Error('Invalid event ID');
  if(trusted && raw.name==='payment_succeeded' && (raw.currency!=='SAR'||!Number.isSafeInteger(raw.amountMinor)||raw.amountMinor<0||raw.amountMinor>100000000000))throw new Error('Expected verified SAR payment in integer minor units');
  const clean = (v) => typeof v === 'string' && token.test(v) && !/[0-9]{7,}/.test(v) ? v : '';
  const numeric = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
  const metric = ['LCP','CLS','FCP','TTFB','INP'].includes(raw.metric) ? raw.metric : '';
  const referrer = ['direct','search','social','referral','internal'].includes(raw.referrer) ? raw.referrer : 'direct';
  const user = trusted && raw.userId && secret ? createHmac('sha256', secret).update(`${raw.project}:${String(raw.userId).slice(0,256)}`).digest('hex') : '';
  return {id, project:raw.project, name:raw.name, visitor:clean(raw.visitor), session:clean(raw.session), user,
    path:safePath(raw.path), target:clean(raw.target), referrer,
    device:['mobile','tablet','desktop'].includes(raw.device)?raw.device:'desktop',
    browser:['Chrome','Safari','Firefox','Edge','Other'].includes(raw.browser)?raw.browser:'Other',
    campaign:clean(raw.campaign), source:clean(raw.source), medium:clean(raw.medium), metric,
    value:numeric(raw.value, metric==='CLS'?100:3600000), duration:numeric(raw.duration,3600000),
    status: Number.isInteger(raw.status) && raw.status>=0 && raw.status<=599 ? raw.status : null,
    amountMinor:trusted && raw.name==='payment_succeeded' && raw.currency==='SAR' && Number.isSafeInteger(raw.amountMinor) && raw.amountMinor>=0 ? Math.min(raw.amountMinor,100000000000) : null,
    trusted:trusted?1:0, ts:Date.now(),
    entity:trusted&&raw.operationId?createHmac('sha256',secret).update(`${raw.project}:entity:${String(raw.operationId).slice(0,256)}`).digest('hex'):'',
    reasonCode:trusted&&Object.hasOwn(reasons,raw.reasonCode)?raw.reasonCode:'',
    component:trusted?clean(raw.component):''};
}
export class Store {
  constructor(file, secret, retention = 90) {
    this.secret=secret; this.retention=retention; this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS events(id TEXT NOT NULL, project TEXT NOT NULL,name TEXT NOT NULL,visitor TEXT,session TEXT,user TEXT,path TEXT,target TEXT,referrer TEXT,device TEXT,browser TEXT,campaign TEXT,source TEXT,medium TEXT,metric TEXT,value REAL,duration REAL,status INTEGER,amountMinor INTEGER,trusted INTEGER NOT NULL,ts INTEGER NOT NULL, PRIMARY KEY(project,trusted,id));
      CREATE INDEX IF NOT EXISTS events_time ON events(ts,project);
      CREATE INDEX IF NOT EXISTS events_session ON events(project,session,ts);`);
    initializeReport(this.db);
    initializeLeads(this.db);
    this.insert=this.db.prepare(`INSERT OR IGNORE INTO events(${['id','project','name','visitor','session','user','path','target','referrer','device','browser','campaign','source','medium','metric','value','duration','status','amountMinor','trusted','ts','entity','reasonCode','component'].join(',')}) VALUES(${Array(24).fill('?').join(',')})`);
    this.purge();
  }
  add(events,trusted=false) {
    return this.insertEvents(events.map(e=>validateEvent(e,trusted,this.secret)));
  }
  insertEvents(rows) {
    this.db.exec('BEGIN');
    try { for (const r of rows) this.insert.run(...Object.values(r)); this.db.exec('COMMIT'); }
    catch(e) {this.db.exec('ROLLBACK');throw e;}
    return rows.length;
  }
  purge() {
    if(this.retention===0)return;
    this.db.prepare('DELETE FROM events WHERE ts < ?').run(Date.now()-this.retention*86400000);
  }
  profiles(rows){return saveProfiles(this.db,this.secret,rows);}
  insertProfiles(rows){return insertProfiles(this.db,rows);}
  report(from,to){return appendLeadSnapshot(controlReport(this,from,to),this);}
  query(project='all',days=30) {
    const filter=projects.includes(project)?project:'all';
    const since=Date.now()-Math.max(1,Math.min(90,Number(days)||30))*86400000;
    const clause='ts >= ?'+(filter==='all'?'':' AND project = ?');
    const params=filter==='all'?[since]:[since,filter];
    const all=(sql,...extra)=>this.db.prepare(sql).all(...params,...extra);
    const totals=all(`SELECT COUNT(DISTINCT CASE WHEN name='page_view' THEN project||':'||NULLIF(visitor,'') END) AS visitors,
      COUNT(DISTINCT CASE WHEN name='page_view' THEN project||':'||NULLIF(session,'') END) AS sessions,
      SUM(name='page_view') AS views, SUM(name='click') AS clicks,
      COUNT(DISTINCT CASE WHEN trusted=1 THEN project||':'||NULLIF(user,'') END) AS identifiedUsers,
      SUM(name='lead_created' AND trusted=1) AS leads,SUM(name='payment_succeeded' AND trusted=1) AS payments,
      SUM(CASE WHEN name='payment_succeeded' AND trusted=1 THEN amountMinor ELSE 0 END) AS revenueMinor,
      SUM(name='js_error') AS errors, SUM(CASE WHEN name='engagement' THEN duration ELSE 0 END) AS engagedMs
      FROM events WHERE ${clause}`)[0];
    for(const k in totals) totals[k]=Number(totals[k]||0);
    totals.avgEngagementMs=totals.sessions?Math.round(totals.engagedMs/totals.sessions):0;
    totals.conversionRate=totals.sessions?Math.round(totals.payments/totals.sessions*10000)/100:0;
    const series=all(`SELECT date(ts/1000,'unixepoch','+3 hours') AS day,SUM(name='page_view') AS views,SUM(name='click') AS clicks,COUNT(DISTINCT CASE WHEN name='page_view' THEN project||':'||NULLIF(visitor,'') END) AS visitors FROM events WHERE ${clause} GROUP BY day ORDER BY day`);
    const pages=all(`SELECT project,path,COUNT(*) AS views,COUNT(DISTINCT NULLIF(visitor,'')) AS visitors FROM events WHERE ${clause} AND name='page_view' GROUP BY project,path ORDER BY views DESC LIMIT 50`);
    const clicks=all(`SELECT project,target,path,COUNT(*) AS count,COUNT(DISTINCT NULLIF(session,'')) AS sessions FROM events WHERE ${clause} AND name IN ('click','outbound_click','download') GROUP BY project,target,path ORDER BY count DESC LIMIT 100`);
    const breakdown=(field)=>all(`SELECT ${field} AS label,COUNT(*) AS count FROM events WHERE ${clause} AND name='page_view' GROUP BY ${field} ORDER BY count DESC LIMIT 20`);
    const events=all(`SELECT project,name,COUNT(*) AS count,MAX(trusted) AS trusted FROM events WHERE ${clause} GROUP BY project,name ORDER BY count DESC`);
    const health=all(`SELECT project,MAX(ts) AS lastEvent,COUNT(*) AS events FROM events WHERE ${clause} GROUP BY project`);
    const realtime=this.db.prepare(`SELECT COUNT(DISTINCT project||':'||NULLIF(visitor,'')) AS count FROM events WHERE ts>=?${filter==='all'?'':' AND project=?'}`).get(...(filter==='all'?[Date.now()-300000]:[Date.now()-300000,filter])).count;
    const errors=all(`SELECT project,path,name,status,COUNT(*) AS count FROM events WHERE ${clause} AND (name='js_error' OR (name='api_request' AND (status>=400 OR status=0)) OR name IN ('payment_failed','ai_failure','webhook_failed')) GROUP BY project,path,name,status ORDER BY count DESC LIMIT 50`);
    const performance=[];
    for(const metric of ['LCP','CLS','FCP','TTFB','INP']) {
      const n=all(`SELECT COUNT(*) AS n FROM events WHERE ${clause} AND name='performance' AND metric=? AND value IS NOT NULL`,metric)[0].n;
      const row=n?all(`SELECT value FROM events WHERE ${clause} AND name='performance' AND metric=? AND value IS NOT NULL ORDER BY value LIMIT 1 OFFSET ?`,metric,Math.max(0,Math.ceil(n*.75)-1))[0]:null;
      performance.push({metric,p75:row?.value??null,samples:n});
    }
    const api=all(`SELECT project,path,status,COUNT(*) AS count,ROUND(AVG(duration)) AS avgMs FROM events WHERE ${clause} AND name='api_request' GROUP BY project,path,status ORDER BY count DESC LIMIT 50`);
    const funnels={};
    const definitions={business:['page_view','form_start','form_submit','lead_created'],wallet:['page_view','otp_requested','otp_verified','checkout_started','payment_succeeded'],poc:['message_received','transfer_requested','checkout_started','payment_succeeded']};
    for(const [p,steps] of Object.entries(definitions)) {
      const rows=this.db.prepare(`SELECT session,name,ts,trusted FROM events WHERE ts>=? AND project=? AND session<>'' ORDER BY ts,rowid`).all(since,p);
      const progress=new Map();
      for(const r of rows){const n=progress.get(r.session)||0;if(r.name===steps[n] && (browserEvents.has(r.name)||r.trusted)){progress.set(r.session,n+1);}}
      funnels[p]=steps.map((name,i)=>({name,count:[...progress.values()].filter(n=>n>i).length}));
    }
    const sessionRows=all(`SELECT project,session,SUM(name='page_view') AS views,SUM(CASE WHEN name='engagement' THEN duration ELSE 0 END) AS engagedMs,SUM(trusted=1 AND name IN ('payment_succeeded','lead_created','login_verified')) AS conversions FROM events WHERE ${clause} AND session<>'' GROUP BY project,session HAVING views>0`);
    totals.bounceRate=sessionRows.length?Math.round(sessionRows.filter(s=>s.views===1&&s.engagedMs<10000&&!s.conversions).length/sessionRows.length*10000)/100:0;
    totals.conversionRate=sessionRows.length?Math.round(sessionRows.filter(s=>s.conversions>0).length/sessionRows.length*10000)/100:0;
    totals.returningVisitors=all(`SELECT COUNT(*) AS count FROM (SELECT project,visitor,COUNT(DISTINCT session) AS sessions FROM events WHERE ${clause} AND name='page_view' AND visitor<>'' GROUP BY project,visitor HAVING sessions>1)`)[0].count;
    const scroll=all(`SELECT project,target,COUNT(DISTINCT session) AS sessions FROM events WHERE ${clause} AND name='scroll' GROUP BY project,target ORDER BY target`);
    const recent=all(`SELECT project,name,path,target,trusted,ts FROM events WHERE ${clause} ORDER BY ts DESC LIMIT 30`);
    return {totals,series,pages,clicks,devices:breakdown('device'),browsers:breakdown('browser'),sources:breakdown('referrer'),campaigns:all(`SELECT source,medium,campaign,COUNT(*) AS count FROM events WHERE ${clause} AND name='page_view' AND campaign<>'' GROUP BY source,medium,campaign ORDER BY count DESC LIMIT 30`),events,health,realtime,errors,performance,api,funnels,scroll,recent,updatedAt:new Date().toISOString(),retentionDays:this.retention,project:filter,days:Number(days)};
  }
  close(){this.db.close();}
}
