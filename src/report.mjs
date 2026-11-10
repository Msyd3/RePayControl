import { createHmac } from 'node:crypto';

export const sourceNames={poc:'واتساب',business:'الموقع التعريفي',wallet:'المحفظة'};
export const reasons={insufficient_balance:'الرصيد غير كافٍ',bank_rejected:'رفض البنك العملية',invalid_bank_account:'بيانات الحساب البنكي غير صالحة',provider_timeout:'انتهت مهلة المزوّد',network_error:'تعذر الاتصال بالشبكة',authentication_failed:'فشل التحقق من الهوية',limit_exceeded:'تجاوز الحد المسموح',provider_error:'خطأ لدى المزوّد',validation_failed:'تعذر التحقق من البيانات',unknown:'لم يرسل المصدر سببًا محددًا'};
export function maskMobile(value){
  const normalized=String(value||'').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  if(/[xX*•]/.test(normalized))return /^\d{2,3}[\sXx*•-]+\d{2,4}$/.test(normalized)?normalized.replace(/[xX*•]+/g,'XXXX'):'—';
  let digits=normalized.replace(/\D/g,'');if(digits.startsWith('00966'))digits='0'+digits.slice(5);else if(digits.startsWith('966'))digits='0'+digits.slice(3);
  return /^05\d{8}$/.test(digits)?`${digits.slice(0,3)} XXXX ${digits.slice(-4)}`:'—';
}
export function identity(secret,project,id){return createHmac('sha256',secret).update(`${project}:${String(id).slice(0,256)}`).digest('hex');}
export function rangeDates(from,to,now=Date.now()){
  const today=new Date(now+10800000).toISOString().slice(0,10),pattern=/^\d{4}-\d{2}-\d{2}$/;
  from=pattern.test(from||'')?from:today;to=pattern.test(to||'')?to:today;
  const start=Date.parse(from+'T00:00:00+03:00'),end=Date.parse(to+'T00:00:00+03:00')+86400000;
  if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start+10800000).toISOString().slice(0,10)!==from||new Date(end-86400000+10800000).toISOString().slice(0,10)!==to||end<=start||end-start>366*86400000)throw Object.assign(new Error('اختر فترة صالحة لا تتجاوز سنة'),{status:400});
  return {from,to,start,end};
}
export function initializeReport(db){
  const columns=db.prepare('PRAGMA table_info(events)').all().map(x=>x.name);
  for(const [name,type]of [['entity','TEXT'],['reasonCode','TEXT'],['component','TEXT']])if(!columns.includes(name))db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_profiles(project TEXT NOT NULL,user TEXT NOT NULL,displayName TEXT NOT NULL,mobileMasked TEXT NOT NULL,registeredAt INTEGER,linkedBankAccounts INTEGER,updatedAt INTEGER NOT NULL,PRIMARY KEY(project,user));`);
}
export function saveProfiles(db,secret,rows){
  if(!secret)throw new Error('Missing identity key');
  if(!Array.isArray(rows)||rows.length<1||rows.length>100)throw new Error('Expected 1-100 profiles');
  const profiles=rows.map(p=>{
    if(!Object.hasOwn(sourceNames,p.project)||typeof p.userId!=='string'||!p.userId.trim()||p.userId.length>256)throw new Error('Invalid profile identity');
    const date=p.registeredAt?Date.parse(p.registeredAt):NaN;if(p.registeredAt&&(!Number.isFinite(date)||date>Date.now()))throw new Error('Invalid registration date');
    if(p.linkedBankAccounts!=null&&(!Number.isInteger(p.linkedBankAccounts)||p.linkedBankAccounts<0||p.linkedBankAccounts>1000))throw new Error('Invalid bank account count');
    return {project:p.project,user:identity(secret,p.project,p.userId),displayName:String(p.name||'').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,120)||'الاسم غير متاح',mobileMasked:maskMobile(p.mobileMasked||p.mobile),registeredAt:Number.isFinite(date)?date:null,linkedBankAccounts:p.linkedBankAccounts??null,updatedAt:Date.now()};
  });
  const q=db.prepare(`INSERT INTO user_profiles(project,user,displayName,mobileMasked,registeredAt,linkedBankAccounts,updatedAt) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project,user) DO UPDATE SET displayName=excluded.displayName,mobileMasked=excluded.mobileMasked,registeredAt=COALESCE(excluded.registeredAt,user_profiles.registeredAt),linkedBankAccounts=COALESCE(excluded.linkedBankAccounts,user_profiles.linkedBankAccounts),updatedAt=excluded.updatedAt`);
  db.exec('BEGIN');try{for(const p of profiles)q.run(...Object.values(p));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return profiles.length;
}
const transferNames=new Set(['transfer_requested','transfer_succeeded','transfer_failed','transfer_cancelled']);
const withdrawalNames=new Set(['withdrawal_requested','withdrawal_succeeded','withdrawal_failed']);
function entities(rows,names){const m=new Map();for(const e of rows)if(e.trusted&&names.has(e.name)){const key=e.project+':'+(e.entity||e.id);const prev=m.get(key);m.set(key,{...e,user:e.user||prev?.user||''});}return [...m.values()];}
const repeat=(items,key)=>{const counts=new Map();for(const x of items){const k=key(x);if(k)counts.set(k,(counts.get(k)||0)+1);}return [...counts.values()].reduce((sum,n)=>sum+Math.max(n-1,0),0);};
export function controlReport(store,from,to){
  const range=rangeDates(from,to),db=store.db;
  const rows=db.prepare('SELECT rowid,* FROM events WHERE ts>=? AND ts<? ORDER BY ts,rowid').all(range.start,range.end);
  const profiles=db.prepare('SELECT * FROM user_profiles ORDER BY displayName,project').all();
  const operations=entities(rows,transferNames),withdrawals=entities(rows,withdrawalNames);
  const metrics=[];
  const add=(key,label,value,sources,unit='',note='')=>metrics.push({key,label,value,sources,unit,note});
  const has=(p)=>!!db.prepare('SELECT 1 FROM events WHERE project=? LIMIT 1').get(p)||profiles.some(x=>x.project===p);
  const hasEvent=(names,project)=>db.prepare(`SELECT 1 FROM events WHERE trusted=1 AND name IN (${names.map(()=>'?').join(',')})${project?' AND project=?':''} LIMIT 1`).get(...names,...(project?[project]:[]));
  const count=(name,p)=>rows.filter(e=>e.name===name&&(!p||e.project===p)).length;
  const profileSources=[...new Set(profiles.map(x=>x.project))];
  const knownUsers=new Map(profiles.map(p=>[p.project+':'+p.user,p]));
  for(const e of rows)if(e.trusted&&e.user&&!knownUsers.has(e.project+':'+e.user))knownUsers.set(e.project+':'+e.user,{project:e.project,user:e.user,displayName:'الاسم بانتظار الربط',mobileMasked:'—',registeredAt:null,linkedBankAccounts:null});
  const userRows=[...knownUsers.values()].map(p=>{
    const own=rows.filter(e=>e.project===p.project&&e.trusted&&e.user===p.user),ops=operations.filter(e=>e.project===p.project&&e.user===p.user),pulls=withdrawals.filter(e=>e.project===p.project&&e.user===p.user);
    const chats=new Set(own.filter(e=>e.name==='conversation_started').map(e=>e.entity||e.id)).size;
    const sessions=new Set(own.filter(e=>e.name==='visit_identified').map(e=>e.session||e.id)).size;
    const isActive=own.length>0,isNew=p.registeredAt!=null?p.registeredAt>=range.start&&p.registeredAt<range.end:own.some(e=>e.name==='user_registered');
    return {id:p.user,project:p.project,name:p.displayName,mobile:p.mobileMasked,registeredAt:p.registeredAt,isNew,isActive,
      operations:hasEvent([...transferNames],p.project)?ops.length:null,conversations:hasEvent(['conversation_started'],p.project)?chats:null,
      avgTransfersPerConversation:chats?Math.round(ops.length/chats*100)/100:null,
      repeatTransfers:hasEvent([...transferNames],p.project)?Math.max(0,ops.length-1):null,repeatConversations:hasEvent(['conversation_started'],p.project)?Math.max(0,chats-1):null,
      visits:hasEvent(['visit_identified'],p.project)?sessions:null,repeatVisits:hasEvent(['visit_identified'],p.project)?Math.max(0,sessions-1):null,
      successful:hasEvent(['transfer_succeeded','transfer_failed'],p.project)?ops.filter(e=>e.name==='transfer_succeeded').length:null,
      failed:hasEvent(['transfer_succeeded','transfer_failed'],p.project)?ops.filter(e=>e.name==='transfer_failed').length:null,
      withdrawals:hasEvent([...withdrawalNames],p.project)?pulls.filter(e=>e.name==='withdrawal_succeeded').length:null,
      linkedBankAccounts:p.linkedBankAccounts,
      failureReasons:[...new Set([...ops,...pulls].filter(e=>e.name.endsWith('_failed')).map(e=>reasons[e.reasonCode]||reasons.unknown))]
    };
  });
  const registeredEvents=rows.filter(e=>e.trusted&&e.name==='user_registered'&&e.user);
  const newKeys=new Set([...profiles.filter(p=>p.registeredAt!=null&&p.registeredAt>=range.start&&p.registeredAt<range.end).map(p=>p.project+':'+p.user),...registeredEvents.map(e=>e.project+':'+e.user)]);
  const registeredKnown=profiles.some(p=>p.registeredAt!=null)||hasEvent(['user_registered']);
  const active=new Set(rows.filter(e=>e.trusted&&e.user).map(e=>e.project+':'+e.user));
  const transferReady=!!hasEvent([...transferNames]),chatReady=!!hasEvent(['conversation_started']),pullReady=!!hasEvent([...withdrawalNames]);
  const chats=entities(rows,new Set(['conversation_started']));
  const settled=withdrawals.filter(e=>e.name==='withdrawal_succeeded');
  add('users','عدد المستخدمين',profiles.length?profiles.length:null,profileSources.length?profileSources:['poc','wallet','business'],'','الحسابات حسب المصدر؛ لا تُدمج الهويات دون ربط معتمد');
  add('newUsers','المستخدمون الجدد',registeredKnown?newKeys.size:null,['poc','wallet','business'],'','حسب تاريخ التسجيل الفعلي في الفترة');
  add('activeUsers','المستخدمون النشطون',active.size?active.size:hasEvent(['login_verified','message_received','visit_identified'])?0:null,['poc','wallet','business']);
  add('operations','إجمالي عمليات التحويل',transferReady?operations.length:null,['poc','wallet']);
  add('revenue','الإيرادات',pullReady?settled.length*115:null,['wallet'],'SAR','1.15 ريال لكل سحب بنكي ناجح؛ ليست نسبة مئوية');
  add('conversations','عدد المحادثات',chatReady?chats.length:null,['poc']);
  const transferUsers=new Set(operations.filter(x=>x.user).map(x=>x.project+':'+x.user));
  add('avgTransfers','متوسط التحويلات لكل مستخدم',transferReady&&transferUsers.size?Math.round(operations.filter(x=>x.user).length/transferUsers.size*100)/100:null,['poc','wallet'],'','عمليات المستخدمين المعرّفين ÷ المستخدمين المنفذين');
  add('avgPerConversation','متوسط التحويلات لكل محادثة',chatReady&&transferReady&&chats.length?Math.round(operations.length/chats.length*100)/100:null,['poc','wallet']);
  add('successes','عمليات التحويل الناجحة',hasEvent(['transfer_succeeded','transfer_failed'])?operations.filter(e=>e.name==='transfer_succeeded').length:null,['poc','wallet']);
  add('failures','عمليات التحويل الفاشلة',hasEvent(['transfer_succeeded','transfer_failed'])?operations.filter(e=>e.name==='transfer_failed').length:null,['poc','wallet']);
  add('transferRepeats','تكرار التحويلات',transferReady?repeat(operations,x=>x.user?x.project+':'+x.user:''):null,['poc','wallet'],'','العمليات الإضافية بعد أول عملية لكل مستخدم خلال الفترة');
  add('chatRepeats','تكرار المحادثات',chatReady?repeat(chats,x=>x.user?x.project+':'+x.user:''):null,['poc']);
  add('withdrawals','السحب البنكي الناجح',pullReady?settled.length:null,['wallet']);
  add('withdrawalFailures','السحب البنكي الفاشل',pullReady?withdrawals.filter(e=>e.name==='withdrawal_failed').length:null,['wallet']);
  const bankProfiles=profiles.filter(p=>p.project==='wallet'&&p.linkedBankAccounts!=null);
  add('bankAccounts','الحسابات البنكية المرتبطة',bankProfiles.length?bankProfiles.reduce((s,p)=>s+p.linkedBankAccounts,0):null,['wallet'],'','الرصيد الحالي للحسابات المرتبطة، وليس عدد أحداث الإضافة');
  for(const [p,prefix]of [['business','الموقع التعريفي'],['wallet','المحفظة']]){
    const selected=rows.filter(e=>e.project===p),visits=selected.filter(e=>e.name==='page_view');
    const sessions=new Set(visits.filter(e=>e.session).map(e=>e.session)),visitors=new Set(visits.filter(e=>e.visitor).map(e=>e.visitor));
    add(p+'Visitors','الزوار الفريدون',has(p)?visitors.size:null,[p]);
    add(p+'Visits','جلسات الزيارة',has(p)?sessions.size:null,[p]);
    const visitCounts=new Map();for(const e of visits)if(e.visitor&&e.session){if(!visitCounts.has(e.visitor))visitCounts.set(e.visitor,new Set());visitCounts.get(e.visitor).add(e.session);}
    add(p+'VisitRepeats','تكرار الزيارات',has(p)?[...visitCounts.values()].reduce((n,set)=>n+Math.max(0,set.size-1),0):null,[p],'','جلسات إضافية بعد الزيارة الأولى داخل الفترة');
    add(p+'Clicks','نقرات الأزرار',has(p)?count('click',p):null,[p]);
  }
  add('leads','طلبات التواصل المحفوظة',hasEvent(['lead_created'])?count('lead_created','business'):null,['business']);
  add('leadFailures','فشل إرسال نموذج التواصل',has('business')?rows.filter(e=>e.project==='business'&&e.name==='api_request'&&e.path==='/api/leads'&&(e.status>=400||e.status===0)).length:null,['business']);
  const errorRows=rows.filter(e=>e.name==='js_error'||e.name.endsWith('_failed')||e.name==='ai_failure'||(e.name==='api_request'&&(e.status>=400||e.status===0)));
  const issueMap=new Map();for(const e of errorRows){const reason=reasons[e.reasonCode]||(e.name==='api_request'?(e.status===0?'تعذر الاتصال بالشبكة':`استجابة HTTP ${e.status}؛ السبب التفصيلي بانتظار المصدر`):reasons.unknown),location=e.component?`${e.path} · ${e.component}`:e.path;const key=[e.project,e.name,reason,location].join('|');if(!issueMap.has(key))issueMap.set(key,{project:e.project,type:e.name,reason,location,count:0,lastAt:e.ts});const issue=issueMap.get(key);issue.count++;issue.lastAt=e.ts;}
  add('issues','الأخطاء المرصودة',Object.keys(sourceNames).some(has)?errorRows.length:null,['poc','wallet','business']);
  const clicks=db.prepare("SELECT project,target,path,COUNT(*) count FROM events WHERE ts>=? AND ts<? AND name='click' GROUP BY project,target,path ORDER BY count DESC LIMIT 100").all(range.start,range.end);
  return {range,metrics,users:userRows,issues:[...issueMap.values()].sort((a,b)=>b.lastAt-a.lastAt),clicks,sources:Object.keys(sourceNames).map(project=>({project,name:sourceNames[project],connected:has(project)})),updatedAt:new Date().toISOString(),feeMinor:115};
}
