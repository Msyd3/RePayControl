import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
// Use a Unicode-aware PDF renderer with Arabic shaping and bidi handling.
export async function createNdaPdf(text,record){
 const PDFDocument=require('pdfkit');
 const bidi=require('bidi-js')();
 const font=fileURLToPath(new URL('../public/fonts/Tajarib-Regular.otf',import.meta.url));
 const doc=new PDFDocument({size:'A4',margin:48,info:{Title:'RePay NDA',Subject:'Electronic acceptance record'}});
 const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.font(font).fontSize(12);
 const width=doc.page.width-96;
 // Layout logical directional runs separately so fontkit shapes Arabic before
 // placement. The bidi algorithm supplies their visual ordering.
 function line(logical){
  const levels=bidi.getEmbeddingLevels(logical,'rtl').levels;
  const order=bidi.getReorderedIndices(logical,{levels,paragraphs:[{start:0,end:logical.length-1,level:1}]});
  const runs=[];for(let i=0;i<logical.length;){const start=i,level=levels[i];while(i<logical.length&&levels[i]===level)i++;runs.push({start,end:i,text:logical.slice(start,i),level});}
  const visual=[];for(const idx of order){const run=runs.find(r=>idx>=r.start&&idx<r.end);if(run&&!visual.includes(run))visual.push(run);}
  const y=doc.y;if(y>doc.page.height-70)doc.addPage();
  const baseline=doc.y;const sizes=visual.map(r=>doc.widthOfString(r.text));let x=doc.page.width-48-sizes.reduce((a,b)=>a+b,0);
  for(let i=0;i<visual.length;i++){doc.text(visual[i].text,x,baseline,{lineBreak:false});x+=sizes[i];}doc.y=baseline+22;
 }
 function paragraph(p){if(!p.trim()){doc.y+=8;return;}let row='';for(const word of p.split(/\s+/)){const candidate=row?row+' '+word:word;if(row&&doc.widthOfString(candidate)>width){line(row);row=word;}else row=candidate;}if(row)line(row);}
 doc.fontSize(18);line('اتفاقية عدم إفصاح');doc.moveDown(.5);doc.fontSize(12);
 for(const p of text.split('\n'))paragraph(p);
 doc.addPage();doc.fontSize(18).text('RePay - Electronic acceptance',{align:'left'});doc.moveDown();doc.fontSize(12);
 for(const [label,value] of [['Name',record.name],['Email',record.email],['Accepted at (UTC)',record.acceptedAt],['Version',record.version],['Method',record.method],['SHA-256',record.agreementHash]]){doc.text(label+':',{align:'left'});if(label==='Name'&&/[\u0600-\u06ff]/.test(value))paragraph(value);else doc.text(String(value),{align:'left',width});doc.moveDown(.5);}
 doc.end();return result;
}
