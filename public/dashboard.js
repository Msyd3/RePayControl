'use strict';
const $=s=>document.querySelector(s);
const apiOrigin=window.REPAY_CONTROL_API_ORIGIN||'';
let adminToken='';try{adminToken=sessionStorage.getItem('rc-admin-session')||'';}catch{}
const sourceNames={poc:'واتساب',business:'الموقع التعريفي'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v);
const state={report:null,authenticated:false,loading:false,exporting:false};
const dateFormat=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory',dateStyle:'medium'});
const timestampFormat=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory',dateStyle:'medium',timeStyle:'short'});
const date=v=>v==null?'—':dateFormat.format(v);
const sortedUsers=users=>[...users].sort((a,b)=>(b.registeredAt??-1)-(a.registeredAt??-1));
const numeric=v=>`<bdi>${number(v)}</bdi>`;

const businessButtons={
  'button-language-toggle':'تغيير اللغة',
  'button-close-demo':'إغلاق نموذج التواصل',
  'button-submit-demo':'إرسال الطلب',
  'button-cookie-accept':'موافق',
  'button-analytics-accept':'السماح بالقياس',
  'button-analytics-decline':'المتابعة دون قياس',
  'a-0':'ابدأ الآن',
  'a-1':'سياسة الخصوصية',
  'button-faq-0':'ما هي RePay؟',
  'button-faq-1':'كيف يتم الحفاظ على بياناتي؟',
  'button-faq-2':'كيف يدفع وكيل الذكاء الاصطناعي بالنيابة عني؟',
  'button-faq-3':'كيف أؤكد عمليات الدفع والتحويل؟',
  'button-faq-4':'هل أقدر أستقبل الأموال في أيٍّ من حساباتي؟'
};
const eventLabels={transfer_failed:'فشل عملية تحويل',withdrawal_failed:'فشل سحب بنكي',payment_failed:'فشل دفع',message_failed:'فشل تسليم رسالة',webhook_failed:'فشل معالجة الرسالة',ai_failure:'فشل المزوّد',js_error:'خلل في الواجهة',api_request:'خطأ في طلب الخدمة'};

function metricCard(metric){
  const value=metric.unit==='SAR'&&metric.value!=null?metric.value/100:metric.value;
  return `<article class="metric"><div class="metric-label">${esc(metric.label)}</div><div class="metric-value">${value!=null&&metric.unit==='SAR'?'<small>ر.س</small>':''}${numeric(value)}</div></article>`;
}
function table(headers,rows){
  return `<div class="panel"><div class="table-scroll"><table><thead><tr>${headers.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((cell,i)=>`<td><span class="mobile-column-label" aria-hidden="true">${esc(headers[i])}</span><span>${cell}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
const person=u=>[esc(u.name),`<bdi>${esc(u.mobile)}</bdi>`,esc(date(u.registeredAt))];
function pocUsersTable(users){
  return table(['المستخدم','الجوال','تاريخ التسجيل','طلبات التحويل','المحادثات'],users.map(u=>[...person(u),numeric(u.operations),numeric(u.conversations)]));
}
function issuesTable(issues){
  return table(['الخلل','السبب','مكان الخلل','عدد المرات','آخر ظهور'],issues.map(i=>[
    esc(eventLabels[i.type]||i.type),esc(i.reason),`<code class="place">${esc(i.location)}</code>`,
    numeric(i.count),esc(timestampFormat.format(i.lastAt))
  ]));
}
function clicksTable(clicks){
  return table(['اسم الزر','الصفحة','عدد النقرات'],clicks.map(click=>[
    esc(Object.hasOwn(businessButtons,click.target)?businessButtons[click.target]:'اسم الزر غير متاح'),
    `<code class="place">${esc(click.path)}</code>`,numeric(click.count)
  ]));
}
function sections(report){
  const snapshot=report.pocSnapshot;
  const pocLabels={users:'عدد المستخدمين',conversations:'عدد المحادثات',transferRequests:'طلبات التحويل المسجّلة'};
  const pocMetrics=snapshot?.state==='connected'?Object.entries(pocLabels).map(([key,label])=>({label,value:snapshot.metrics[key]})):[];
  const website=report.website;
  const issues=project=>({title:'الأخطاء وأسباب الفشل اليوم',rows:report.issues.filter(issue=>issue.project===project),markup:issuesTable});
  const websiteNotes=[];
  if(website?.hasHistoricalVisitors)websiteNotes.push('عدد الزوار تقديري عند جمع السجلات المحفوظة والجديدة، وقد يُحسب الزائر العائد أكثر من مرة.');
  if(website?.unattributedClicks)websiteNotes.push(`يتضمن الإجمالي ${number(website.unattributedClicks)} نقرة محفوظة بدون اسم زر.`);
  return [
    {title:sourceNames.poc,scope:'منذ بدء تسجيل المحادثات',metrics:pocMetrics,
      empty:snapshot?.message||'بيانات واتساب غير متاحة حاليًا.',
      tables:[{title:'المستخدمون',rows:sortedUsers(snapshot?.users||[]),markup:pocUsersTable},issues('poc')]},
    {title:sourceNames.business,scope:'منذ بدء القياس',metrics:website?.metrics||[],
      empty:'بيانات الزيارات غير متاحة حاليًا.',notes:websiteNotes,
      tables:[{title:'نقرات الأزرار',rows:website?.clicks||[],markup:clicksTable,empty:'لا تتوفر تفاصيل نقرات مسجّلة.'},issues('business')]}
  ];
}
function sectionIntro(section){
  return `<h2 class="section-title">${section.title}</h2><p class="section-note">${section.scope}</p>${
    section.metrics.length?`<div class="metrics">${section.metrics.map(metricCard).join('')}</div>`:`<p class="notice">${esc(section.empty)}</p>`
  }${(section.notes||[]).map(note=>`<p class="section-note">${esc(note)}</p>`).join('')}`;
}
function sectionTable(table,rows){
  return `<h3>${table.title}</h3>${rows.length?table.markup(rows):`<p class="section-note">${table.empty}</p>`}`;
}
function render(){
  $('#content').innerHTML=sections(state.report).map(section=>`<section class="product-section">${sectionIntro(section)}${
    section.tables.filter(t=>t.rows.length||t.empty).map(t=>sectionTable(t,t.rows)).join('')
  }</section>`).join('');
  $('#sync-status').textContent='تم التحديث';
  $('#updated-at').textContent='آخر تحديث '+timestampFormat.format(new Date(state.report.updatedAt));
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,4000);}
function login(){state.authenticated=false;$('#app').hidden=true;$('#login-screen').hidden=false;}
async function api(url,options){const headers=new Headers(options&&options.headers);if(adminToken)headers.set('Authorization','Bearer '+adminToken);const r=await fetch(apiOrigin+url,{...(options||{}),headers,credentials:apiOrigin?'omit':'same-origin'});if(r.status===401&&url!=='/api/login'){login();throw Error('سجّل الدخول مجددًا');}const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر تحميل البيانات');return d;}
async function load(){
  if(!state.authenticated||state.loading)return;
  state.loading=true;
  $('#refresh').classList.add('refreshing');
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
    $('#refresh').classList.remove('refreshing');
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
$('#refresh').addEventListener('click',load);
$('#password').addEventListener('input',e=>{e.target.value=e.target.value.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));});
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('#login-error').textContent='';try{const signedIn=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#password').value})});adminToken=signedIn.token||'';try{sessionStorage.setItem('rc-admin-session',adminToken);}catch{}$('#password').value='';state.authenticated=true;$('#login-screen').hidden=true;$('#app').hidden=false;await load();}catch(e){$('#login-error').textContent=e.message;}finally{b.disabled=false;}});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});state.report=null;adminToken='';try{sessionStorage.removeItem('rc-admin-session');}catch{}login();}catch(e){toast(e.message);}});
$('#export').addEventListener('click',async()=>{if(!state.report||state.exporting)return;state.exporting=true;const b=$('#export');b.disabled=true;b.textContent='جارٍ تجهيز PDF…';try{await window.exportControlPDF(state.report,pdfPages(state.report));toast('تم تنزيل التقرير PDF');}catch(e){toast('تعذر تجهيز PDF. أعد المحاولة.');console.error('PDF export failed');}finally{state.exporting=false;b.disabled=false;b.innerHTML='<span aria-hidden="true">↓</span> تصدير PDF';}});
(async()=>{if(window.REPAY_CONTROL_FRONTEND_ONLY){login();$('#login-error').textContent='الواجهة منشورة على GitHub. الدخول والبيانات بانتظار ربط خادم التطبيق.';$('#password').disabled=true;$('#login-form button').disabled=true;return;}try{await api('/api/me');state.authenticated=true;$('#app').hidden=false;await load();}catch(e){login();$('#login-error').textContent=e.message==='سجّل الدخول مجددًا'?'':'تعذر الاتصال بالخادم';}})();
setInterval(()=>{if(state.authenticated&&!document.hidden)load();},30000);
