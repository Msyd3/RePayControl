'use strict';
window.exportControlPDF=async function(report,renderers){
  if(!window.PDFLib||!window.html2canvas)throw Error('PDF libraries unavailable');
  await document.fonts.ready;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=`${report.range.from} — ${report.range.to} · الرياض`;
  const chunks=(rows,size)=>rows.length?Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size)):[[]];
  const pages=[];
  for(const [i,metrics]of chunks(report.metrics,20).entries())pages.push(`<h2 class="section-title">${i?'المقاييس · تابع':'المقاييس'}</h2><div class="metrics">${metrics.map(renderers.metricCard).join('')}</div><p class="section-note">الإيرادات = عدد السحوبات البنكية الناجحة × 1.15 ريال. — تعني أن المصدر لم يرسل بيانات المقياس.</p>`);
  for(const users of chunks(report.users,6))pages.push(`<h2 class="section-title">المستخدمون</h2>${renderers.usersTable(users,false)}<p class="section-note">كل المستخدمين داخل التقرير، دون تطبيق بحث قائمة المستخدمين. الأرقام تخص الفترة المختارة. أرقام الجوال مخفية.</p>`);
  const repeatHeaders=['المستخدم','المصدر','تكرار المحادثات','تكرار التحويلات','الزيارات / تكرارها','أسباب الفشل'];
  for(const users of chunks(report.users,7))pages.push(`<h2 class="section-title">تفاصيل التكرار وأسباب الفشل لكل مستخدم</h2><table><thead><tr>${repeatHeaders.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${users.length?users.map(u=>`<tr><td>${esc(u.name)}<span class="cell-sub">${esc(u.mobile)}</span></td><td>${esc({poc:'واتساب',business:'الموقع التعريفي',wallet:'المحفظة'}[u.project])}</td><td>${u.repeatConversations??'—'}</td><td>${u.repeatTransfers??'—'}</td><td>${u.visits??'—'} / ${u.repeatVisits??'—'}</td><td style="white-space:normal;max-width:280px">${esc(u.failureReasons.join('، ')||'لم يرد سبب فشل')}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-cell"><strong>تفاصيل المستخدمين بانتظار البيانات</strong></td></tr>'}</tbody></table>`);
  for(const issues of chunks(report.issues,7))pages.push(`<h2 class="section-title">الأخطاء وأسباب الفشل</h2>${renderers.issuesTable(issues)}`);
  for(const clicks of chunks(report.clicks,9))pages.push(`<h2 class="section-title">تفاصيل نقرات الأزرار</h2>${renderers.clicksTable(clicks)}`);
  const root=document.createElement('div');root.className='pdf-export-root';root.setAttribute('aria-hidden','true');
  root.innerHTML=pages.map((body,i)=>`<section class="pdf-page"><div class="pdf-heading"><h1>نظرة عامة</h1><span>${esc(date)}</span></div>${body}<div class="pdf-footer"><span dir="ltr">RePayControl</span><span>${i+1} / ${pages.length}</span><span>المصدر مكتوب تحت كل مقياس</span></div></section>`).join('');
  document.body.appendChild(root);
  try{
    const pdf=await PDFLib.PDFDocument.create();pdf.setTitle('RePayControl - Overview');pdf.setCreator('RePayControl');
    for(const element of root.children){const canvas=await html2canvas(element,{scale:2,backgroundColor:'#fff',logging:false,width:1120,height:792,windowWidth:1440,windowHeight:1000});const png=await pdf.embedPng(canvas.toDataURL('image/png'));const page=pdf.addPage([841.89,595.28]);page.drawImage(png,{x:0,y:0,width:841.89,height:595.28});canvas.width=0;canvas.height=0;}
    const bytes=await pdf.save(),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=`RePayControl-${report.range.from}-${report.range.to}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }finally{root.remove();}
};
