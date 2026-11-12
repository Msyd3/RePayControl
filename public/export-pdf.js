'use strict';
window.exportControlPDF=async function(report,pages){
  if(!window.PDFLib||!window.html2canvas)throw Error('PDF libraries unavailable');
  await document.fonts.ready;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory',dateStyle:'medium'}).format(new Date(report.updatedAt));
  const root=document.createElement('div');root.className='pdf-export-root';root.setAttribute('aria-hidden','true');
  root.innerHTML=pages.map((body,i)=>`<section class="pdf-page"><div class="pdf-heading"><h1>نظرة عامة</h1><span>${esc(date)}</span></div>${body}<div class="pdf-footer"><span dir="ltr">RePayControl</span><span>${i+1} / ${pages.length}</span><span>توقيت الرياض</span></div></section>`).join('');
  document.body.appendChild(root);
  try{
    const pdf=await PDFLib.PDFDocument.create();pdf.setTitle('RePayControl - Overview');pdf.setCreator('RePayControl');
    for(const element of root.children){const canvas=await html2canvas(element,{scale:2,backgroundColor:'#fff',logging:false,width:1120,height:792,windowWidth:1440,windowHeight:1000});const png=await pdf.embedPng(canvas.toDataURL('image/png'));const page=pdf.addPage([841.89,595.28]);page.drawImage(png,{x:0,y:0,width:841.89,height:595.28});canvas.width=0;canvas.height=0;}
    const bytes=await pdf.save(),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=`RePayControl-${report.range.from}-${report.range.to}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }finally{root.remove();}
};
