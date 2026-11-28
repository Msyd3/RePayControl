let pdfLibraries;
function loadPdfLibraries(){if(!pdfLibraries)pdfLibraries=(async()=>{for(const src of ["/vendor/pdf-lib.min.js","/vendor/html2canvas.min.js","/export-pdf.js"]){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('PDF library unavailable'));};document.head.append(s);});}})().catch(e=>{pdfLibraries=null;throw e;});return pdfLibraries;}
'use strict';
const $=s=>document.querySelector(s);
const apiOrigin=window.REPAY_DATAROOM_API_ORIGIN??window.REPAY_CONTROL_API_ORIGIN??'';
let readOnly=false;
let adminToken='';try{adminToken=sessionStorage.getItem('repay-control-session')||'';}catch{}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v);
const state={report:null,authenticated:false,loading:false,exporting:false};
const dateFormat=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory',dateStyle:'medium'});
const timestampFormat=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory',dateStyle:'medium',timeStyle:'short'});
const date=v=>v==null?'—':dateFormat.format(v);
const sortedUsers=users=>[...users].sort((a,b)=>(b.waitlistNumber??-1)-(a.waitlistNumber??-1));
const numeric=v=>`<bdi>${number(v)}</bdi>`;

const eventLabels={transfer_failed:'فشل عملية تحويل',withdrawal_failed:'فشل سحب بنكي',payment_failed:'فشل دفع',message_failed:'فشل تسليم رسالة',webhook_failed:'فشل معالجة الرسالة',ai_failure:'فشل المزوّد',js_error:'خلل في الواجهة',api_request:'خطأ في طلب الخدمة'};

function metricCard(metric){
  const value=metric.value;
  return `<article class="metric"><div class="metric-label">${esc(metric.label)}</div><div class="metric-value">${value!=null&&metric.unit==='seconds'?'<small>ث</small>':''}${numeric(value)}</div>${metric.detail?`<p class="section-note">${esc(metric.detail)}</p>`:''}</article>`;
}
function table(headers,rows){
  return `<div class="panel"><div class="table-scroll"><table><thead><tr>${headers.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((cell,i)=>`<td><span class="mobile-column-label" aria-hidden="true">${esc(headers[i])}</span><span>${cell}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
const avatarIds=Array.from({length:10},(_,i)=>'remoji-'+String(i+1).padStart(2,'0'));
const avatarImage=id=>`<img class="user-avatar" src="/assets/avatars/${id}-still.svg?v=repay-shapes-20261120" width="32" height="32" alt="">`;
function avatarIdFor(user){
  if(avatarIds.includes(user.avatarId))return user.avatarId;
  const seed=String(user.waitlistNumber??user.phoneAvatarKey??user.mobile??user.name??'0');
  let hash=2166136261;
  for(let index=0;index<seed.length;index++)hash=Math.imul(hash^seed.charCodeAt(index),16777619);
  return avatarIds[(hash>>>0)%avatarIds.length];
}
function userName(user){
  const avatarId=avatarIdFor(user);
  const image=avatarImage(avatarId);
  const avatar=!readOnly&&user.waitlistNumber?`<button type="button" class="avatar-trigger" data-avatar-user="${user.waitlistNumber}" aria-label="تغيير ميموجي ${esc(user.name)}">${image}</button>`:image;
  return `<span class="user-with-avatar">${avatar}<span>${esc(user.name)}</span></span>`;
}
function pocUsersTable(users){
  return table(['رقم قائمة الانتظار','المستخدم','الجوال','طلبات التحويل','المحادثات'],users.map(u=>[
    numeric(u.waitlistNumber),userName(u),`<bdi>${esc(u.mobile)}</bdi>`,numeric(u.operations),numeric(u.conversations)
  ]));
}
function issuesTable(issues){
  return table(['الخلل','السبب','مكان الخلل','عدد المرات','آخر ظهور'],issues.map(i=>[
    esc(eventLabels[i.type]||i.type),esc(i.reason),`<code class="place">${esc(i.location)}</code>`,
    numeric(i.count),esc(timestampFormat.format(i.lastAt))
  ]));
}
function sections(report){
  const snapshot=report.pocSnapshot;
  const pocLabels={users:'عدد المستخدمين',conversations:'عدد المحادثات',transferRequests:'طلبات التحويل المسجّلة'};
  const pocMetrics=snapshot?.state==='connected'?Object.entries(pocLabels).map(([key,label])=>({label,value:snapshot.metrics[key]})):[];
  const google=report.googleAnalytics;
  const googleMetrics=google?.state==='connected'?[
    {label:'مستخدمون نشطون',value:google.activeUsers},
    {label:'الجلسات المتفاعلة',value:google.engagedSessions},
    {label:'متوسط مدة التفاعل لكل جلسة',value:google.averageEngagementSeconds,unit:'seconds'},
    {label:'المشاهدات',value:google.views}
  ]:[];
  const issues=project=>({title:'الأخطاء وأسباب الفشل اليوم',rows:report.issues.filter(issue=>issue.project===project),markup:issuesTable});
  return [
    {title:'بيانات القياس',layout:'measurement',
      metrics:googleMetrics,empty:google?.state==='error'?'تعذر تحديث بيانات Google Analytics.':'بانتظار ربط مصدر بيانات Google Analytics.',
      tables:[issues('business')]},
    {title:'المستخدمون',metrics:pocMetrics,
      empty:snapshot?.message||'بيانات واتساب غير متاحة حاليًا.',
      tables:[{rows:sortedUsers(snapshot?.users||[]),markup:pocUsersTable},issues('poc')]}
  ];
}
function sectionIntro(section){
  return `<h2 class="section-title">${section.title}</h2>${
    section.metrics.length?`<div class="metrics${section.layout==='measurement'?' measurement-metrics':''}">${section.metrics.map(metricCard).join('')}</div>`:`<p class="notice">${esc(section.empty)}</p>`
  }`;
}
function sectionTable(table,rows){
  return `${table.title?`<h3>${table.title}</h3>`: ''}${rows.length?table.markup(rows):`<p class="section-note">${table.empty}</p>`}`;
}
function render(){
  $('#content').innerHTML=sections(state.report).map(section=>`<section class="product-section">${sectionIntro(section)}${
    section.tables.filter(t=>t.rows.length||t.empty).map(t=>sectionTable(t,t.rows)).join('')
  }</section>`).join('');
  $('#sync-status').textContent='تم التحديث';
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,4000);}
function login(){state.authenticated=false;$('#app').hidden=true;$('#control-layout').hidden=true;$('#login-screen').hidden=false;}
async function api(url,options){const headers=new Headers(options&&options.headers);if(adminToken)headers.set('Authorization','Bearer '+adminToken);const r=await fetch(apiOrigin+url,{...(options||{}),headers,credentials:apiOrigin?'omit':'same-origin'});if(r.status===401){login();throw Error('سجّل الدخول مجددًا');}const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر تحميل البيانات');return d;}
async function load(){
  if(!state.authenticated||state.loading||$('#avatar-picker').open)return;
  state.loading=true;
  $('#export').disabled=true;
  $('#sync-status').textContent='جارٍ التحديث';
  try{
    state.report=await api('/api/control-report?view=dashboard');
    $('#load-error').hidden=true;
    render();
  }catch(error){
    if(state.authenticated){
      $('#load-error').hidden=false;
      $('#load-error').textContent=error.message;
      $('#sync-status').textContent='تعذر التحديث';
    }
  }finally{
    state.loading=false;
    $('#export').disabled=!state.report||state.exporting;
  }
}

function pdfPages(report){
  return sections(report).flatMap(section=>[
    sectionIntro(section),
    ...section.tables.flatMap(t=>{
      if(!t.rows.length)return t.empty?[`<h2>${section.title}</h2>${sectionTable(t,[])}`]:[];
      const pages=[];
      for(let start=0;start<t.rows.length;start+=7){
        pages.push(`<h2>${section.title}</h2>${sectionTable(t,t.rows.slice(start,start+7))}`);
      }
      return pages;
    })
  ]);
}
const avatarPicker=$('#avatar-picker');
$('#content').addEventListener('click',event=>{
  const trigger=event.target.closest('[data-avatar-user]');
  if(readOnly||!trigger||state.loading)return;
  const user=state.report.pocSnapshot.users.find(item=>item.waitlistNumber===Number(trigger.dataset.avatarUser));
  if(!user)return;
  avatarPicker.dataset.user=String(user.waitlistNumber);
  $('#avatar-options').innerHTML=avatarIds.map((id,index)=>
    `<button type="button" data-avatar-id="${id}" aria-label="ميموجي ${index+1}" aria-pressed="${id===avatarIdFor(user)}">${avatarImage(id)}</button>`
  ).join('');
  $('#avatar-error').textContent='';
  avatarPicker.showModal();
});
$('#avatar-cancel').addEventListener('click',()=>avatarPicker.close());
avatarPicker.addEventListener('cancel',event=>{if(avatarPicker.dataset.saving)event.preventDefault();});
$('#avatar-options').addEventListener('click',async event=>{
  const button=event.target.closest('[data-avatar-id]');
  if(!button||avatarPicker.dataset.saving)return;
  avatarPicker.dataset.saving='true';
  const buttons=avatarPicker.querySelectorAll('button');
  buttons.forEach(item=>item.disabled=true);
  $('#avatar-error').textContent='';
  const waitlistNumber=Number(avatarPicker.dataset.user);
  try{
    const {avatarId}=await api('/api/users/avatar',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({waitlistNumber,avatarId:button.dataset.avatarId})});
    const user=state.report.pocSnapshot.users.find(item=>item.waitlistNumber===waitlistNumber);
    user.avatarId=avatarId;
    avatarPicker.close();
    render();
    document.querySelector(`[data-avatar-user="${waitlistNumber}"]`)?.focus();
    toast('تم حفظ الميموجي');
  }catch(error){
    if(!state.authenticated)avatarPicker.close();
    else $('#avatar-error').textContent=error.message;
  }finally{
    delete avatarPicker.dataset.saving;
    buttons.forEach(item=>item.disabled=false);
  }
});
window.setupControlInvitations((route,data)=>api('/api/dataroom/'+route,data===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}));
$('#logout').addEventListener('click',async()=>{
 try{await api('/api/dataroom/logout',{method:'POST'});}
 catch(error){toast(error.message);}
 finally{state.report=null;adminToken='';sessionStorage.removeItem('repay-control-session');login();}
});
$('#export').addEventListener('click',async()=>{if(!state.report||state.exporting)return;state.exporting=true;const b=$('#export');b.disabled=true;b.textContent='جارٍ تجهيز PDF…';try{await loadPdfLibraries();await window.exportControlPDF(state.report,pdfPages(state.report));toast('تم تنزيل التقرير PDF');}catch(e){toast('تعذر تجهيز PDF. أعد المحاولة.');console.error('PDF export failed');}finally{state.exporting=false;b.disabled=false;b.innerHTML='<span aria-hidden="true">↓</span> تصدير PDF';}});
(async()=>{
 if(!adminToken){login();return;}
 try{
  const me=await api('/api/me');
  readOnly=['viewer','team'].includes(me.role);
  window.applyControlPermissions(readOnly?me.role:'admin');
  $('#open-invites').hidden=readOnly;
  $('#app').classList.toggle('read-only',readOnly);
  $('#export').hidden=readOnly;
  state.authenticated=true;
  $('#login-screen').hidden=true;
  $('#control-layout').hidden=false;
  $('#app').hidden=false;
  await load();
 }catch(error){
  if(error.message==='سجّل الدخول مجددًا'){
   try{
    const room=await api('/api/dataroom/session');
    if(room.role==='dataroom'){location.replace('/dataroom/');return;}
   }catch{}
   sessionStorage.removeItem('repay-control-session');
   adminToken='';
  }
  login();
  $('#login-error').textContent=error.message==='سجّل الدخول مجددًا'?'':error.message;
 }
})();
