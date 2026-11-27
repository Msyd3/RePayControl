import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import mammoth from 'mammoth';
import {normalizeDigits} from './auth.mjs';
import { taroutStorage } from './tarout-storage.mjs';
import {createNdaPdf} from './nda-pdf.mjs';
import {randomBytes,createCipheriv,createDecipheriv,createHash,timingSafeEqual} from 'node:crypto';
const ADMIN='m@repay.sa', VERSION='NDA-v1';
const NDA_TEXT="وحيث كانت طبيعة العمل المتفق عليه بين الطرفين تقتضي كشف الطرف الأول عن جزء معلوماته السرية للطرف الثاني واطلاعه عليها، لذا فقد اتفق الطرفان على ما يلي:\n\n1- يقر كلا الطرفين أن هذه الاتفاقية قد تحررت بغية حماية الملكية المشروعة والأعمال التجارية وغيرها من المصالح التي تخص كل طرف ويقصد بذلك أن تكون ملزمة وواجبة النفاذ.\n\n2- لأغراض هذه الاتفاقية:\n\n2-1 يقصد \"بالمعلومات السرية\" كافة المعلومات غير العامة والبيانات والوثائق بجميع أنواعها وفي أي شكل من أشكالها، ويشمل ذلك على سبيل المثال لا الحصر (أ) المعلومات المصرفية والشخصية والمالية لطرف ما أو عملاؤه (ب) المعلومات المحددة أو المفصح عنها صراحة أو ضمنا على أنها سرية (ج) المعلومات المتعارف عليها بشكل تقليدي في الأعمال التجارية لطرف ما كأسرار تجارية، (د) كافة أشكال وأنماط المعلومات المالية أو التجارية أو الفنية أو التشغيلية أو الهندسية بما في ذلك المنتجات والخدمات والمشورات والوسائل والتقنيات والعمليات والإجراءات والبرامج بغض النظر عن ما إذا كانت نسخ ورقية أو إلكترونية أو وسيط تخزين غير مادي، (هـ) كافة النسخ التي يتم توفيرها أو الإفصاح عنها من جانب طرف ما للطرف الآخر سواء خطيا أم شفهيا أم إلكترونيا أو بأي وسائل أخرى، وذلك في سياق التفاوض بشأن اتفاقية أو مذكرة تفاهم أو إبرامهما، وسواء تم إبرام أي منهما أم لا، أو في سياق إبرام أو تنفيذ أو تطبيق هذه الاتفاقية أو غيرها من الاتفاقيات المبرمة أو المنفذة فيما بعد.\n\n2-2 يقصد \"بالطرف\" أي من الطرفين الموقعين على هذه الاتفاقية، أو غيرها من الاتفاقيات المبرمة فيما بعد، وشركته القابضة أو الأم وشركاته التابعة للمجموعة، والموظفين بها والمتعهدون للطرف المعينين من جانبه لتقديم المشورة أو تنفيذ أو إجراء الأعمال أو الخدمات ذات الصلة بالمشروع.\n\n2-3 يقصد بالمشروع: مراجعة وتطوير الصيغ القياسية لنماذج العقود والاتفاقيات.\n\n3- يحق لكل طرف الاطلاع على المعلومات السرية واستخدامها للغرض الخاص بالمشروع فقط.\n\n3-1 لا يقوم أي طرف بنسخ أو إعادة إنتاج أي مادة تحتوي على معلومات سرية. ويتعين على أي منهما بناء على طلب الطرف الآخر إعادة كافة المواد أو المعلومات السرية في أي وقت أو التخلص منها عند الطلب دون أي تأخير غير مبرر.\n\n3-2 لا يجوز لأي طرف الإفصاح عن اسم الطرف الآخر (كمرجع) في أي نقاش أو عرض تقديمي أو حملة تسويقية لأي طرف ثالث دون الحصول على موافقة الطرف الآخر خطيا.\n\n3-3 في حالة قام أحد الطرفين بانتهاك أي من الشروط المنصوص عليها في هذه الاتفاقية بأي شكل من الأشكال، يكون ذلك الطرف مسؤولا عن تعويض الطرف الآخر فورا وعلى نحو كاف ودون المساس بأي من الحقوق القانونية التي قد تتاح للطرف الآخر نتيجة لهذا الانتهاك الوشيك أو الفعلي.\n\n4- يقوم كلا الطرفين بما يلي:\n\n4-1 الاحتفاظ بالمعلومات السرية في سياج من السرية التامة وتقييد إطلاع الموظفين أو الوكلاء أو المتنازل لهم عليها استنادا إلى احتياجهم لمعرفتها تحقيقا لأغراض المشروع، شريطة أن يكون هؤلاء الموظفين أو الوكلاء أو المتنازل لهم أو غير ذلك من الشركات التابعة المحددة في البند 2-2 أعلاه قد تم تعيينهم حسب الأصول القانونية من جانب الطرف المفوض بموجب التزامات السرية والقيود التي تعادل معايير هذه الاتفاقية.\n\n4-2 الامتناع عن استخدام المعلومات السرية بموجب هذه الاتفاقية لأي غرض آخر بخلاف أغراض هذا المشروع.\n\n4-3 عدم الكشف عن المعلومات السرية أو تحرير نسخ منها أو الإفصاح عنها للغير دون الحصول على الموافقة الخطية المسبقة لكلا الطرفين.\n\n5- تظل التزامات السرية الملزمة على كلا الطرفين بموجب هذه الاتفاقية قائمة طيلة مدة المشروع وبعد انتهاء المشروع المتفق عليه إلى حين إنهاء الطرفين لها بموجب اتفاق كتابي.\n\n6- بغض النظر عن أي شيء يرد على خلاف ذلك في هذه الاتفاقية، لا يتعهد أي من الطرفين بأي التزام يتعلق بأي من المعلومات السرية الخاصة بالطرف الآخر أو أي جزء، عندما تكون:\n\n• متاحة للعامة من دون إخلال أو إهمال غير مشروع من الطرف المستلم لتلك المعلومات؛\n• تم الحصول عليه بشكل قانوني من طرف آخر غير ملزم بالحفاظ على المعلومات السرية كملكية أو سرية؛\n• معروفة سلفا دون أي التزام بموجب هذه الاتفاقية للحفاظ عليها في سياج من السرية؛\n• تم تطويرها على نحو مستقل بشكل أو طريقة لا تشكل انتهاكا لهذه الاتفاقية.\n• تم الكشف عنها من جانب الطرف المستلم لها امتثالا لقرار أو توجيه محكمة أو هيئة حكومية أو جهة تنظيمية عامة.\n\n7- لا تمنح تحت هذه الاتفاقية أي من حقوق العلامة التجارية أو براءة اختراع أو حق نشر أو أي حق آخر من حقوق الملكية الفكرية أو يفترض منحها ضمنا بموجب الإفصاح أو في المعلومات السرية المفصح عنها.\n\n8- لا يجوز لأي طرف التنازل عن أي من حقوقه أو التزاماته المنصوص عليها بموجب هذه الاتفاقية أو نقلها أو استبدالها كليا أو جزئيا إلا بناء على موافقة خطية مسبقة من الطرف الآخر.\n\n9- تجري كافة المراسلات خطيا وتسلم باليد مقابل إيصال بالاستلام أو بموجب بريد مسجل مصادق عليه مسبقا يتم إرساله إلى المكتب المسجل للطرف وفقا لما ذكر أعلاه.\n\n10- تخضع هذه الاتفاقية في كافة أوجهها لقوانين المملكة العربية السعودية ولوائحها، جميع النزاعات الناشئة عن هذا الاتفاقية من اختصاص الجهات القضائية بالمملكة العربية السعودية.";
const NDA_FOLDER='private-nda';
const folders=['Registration','Business Info','Legal','Branding','Financial Data','Market','Product & Technology','PI','Partnerships','Marketing','HR','Legal','KPIs','Cap Table'];
const runDocumentTool = promisify(execFile);
async function renderPdfPreview(bytes, page) {
 const directory = await mkdtemp(join(tmpdir(), 'repay-pdf-'));
 try {
  const source = join(directory, 'document.pdf');
  await writeFile(source, bytes, {mode:0o600});
  if (page === null) {
   const {stdout} = await runDocumentTool('pdfinfo', [source], {timeout:8000, maxBuffer:65536});
   return Number(stdout.match(/^Pages:\s+(\d+)$/m)?.[1]);
  }
  const {stdout} = await runDocumentTool('pdftoppm',
   ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '1450', '-jpeg', source],
   {encoding:'buffer', timeout:12000, maxBuffer:8*1024*1024});
  if (!stdout.length) throw Error('Page unavailable');
  return stdout;
 } finally {
  await rm(directory, {recursive:true,force:true});
 }
}
export function createDataRoom(env,fetcher=fetch,pdfPreview=renderPdfPreview){
 const sessions=new Map(),limits=new Map();let serial=Promise.resolve();
 const sharedStorage = env.DATAROOM_STORAGE_MODE === 'shared';
 const dedicatedStorage = !env.DATAROOM_STORAGE_MODE || env.DATAROOM_STORAGE_MODE === 'dedicated';
 const sharedBucket = sharedStorage ? taroutStorage(env, fetcher) : null;
 const dedicatedBucket = dedicatedStorage && env.DATAROOM_BUCKET_ID !== env.TAROUT_BUCKET_ID
  ? taroutStorage({
   TAROUT_BUCKET_ID: env.DATAROOM_BUCKET_ID,
   TAROUT_ACCESS_KEY: env.DATAROOM_ACCESS_KEY,
   TAROUT_SECRET_KEY: env.DATAROOM_SECRET_KEY,
  }, fetcher)
  : null;
 const backend = sharedBucket || dedicatedBucket;
 const adminPin = normalizeDigits(env.DATAROOM_ADMIN_PASSWORD || env.ADMIN_PASSWORD);
 const ready = () => Boolean(backend && env.DATAROOM_ENCRYPTION_KEY?.length >= 32 && adminPin.length >= 4);
 const isActiveInvite=invite=>Boolean(invite&&!invite.revokedAt&&(invite.role==='team'&&invite.expiresAt===null||Date.parse(invite.expiresAt)>Date.now()));
 const roleFor=(db,email)=>{if(email===ADMIN)return 'owner';const i=Object.hasOwn(db.invites,email)?db.invites[email]:null;return isActiveInvite(i)?i.role:null;};
 const isAdmin=role=>role==='owner'||role==='admin';
 const err=(status,message)=>Object.assign(new Error(message),{status});
 const key=()=>createHash('sha256').update(env.DATAROOM_ENCRYPTION_KEY).digest();
 function seal(buf){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,c.update(buf),c.final(),c.getAuthTag()]);}
 function open(buf){if(buf.length<28)throw err(503,'Storage unavailable');const d=createDecipheriv('aes-256-gcm',key(),buf.subarray(0,12));d.setAuthTag(buf.subarray(-16));return Buffer.concat([d.update(buf.subarray(12,-16)),d.final()]);}
 async function storage(name,method='GET',body){
  const url = new URL(backend.bucket.href + '/dataroom/' + name);
  const r = await backend.request(url,{method,headers:{'Content-Type':'application/octet-stream'},body,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(r.status===404&&['GET','DELETE'].includes(method))return null;
  if(!r.ok)throw err(503,'Data room storage unavailable');
  return method==='GET'?open(Buffer.from(await r.arrayBuffer())):null;
 }
 async function readIndex(){
  const bytes=await storage('index.bin');
  const db=bytes?JSON.parse(bytes.toString()):{
   folders:folders.map((name,i)=>({id:'root-'+(i+1),parent:null,name,number:i+1})),
   files:[],acceptances:{},
  };
  db.invites??={};
  const legal=db.folders.find(f=>f.id==='root-3'&&f.parent===null&&f.name==='Legal');
  const duplicate=db.folders.find(f=>f.id==='root-12'&&f.parent===null&&f.name==='Legal'&&!f.private);
  if(legal&&duplicate){
   let nextNumber=Math.max(0,...db.folders.filter(f=>f.parent===legal.id).map(f=>f.number))+1;
   for(const folder of db.folders){
    if(folder.parent!==duplicate.id)continue;
    folder.parent=legal.id;
    folder.number=nextNumber++;
   }
   for(const file of db.files)if(file.parent===duplicate.id)file.parent=legal.id;
   db.folders=db.folders.filter(f=>f.id!==duplicate.id);
  }
  if(!db.folders.some(f=>f.id===NDA_FOLDER)){
   const number=1+Math.max(0,...db.folders.filter(f=>f.parent==='root-3').map(f=>f.number));
   db.folders.push({id:NDA_FOLDER,parent:'root-3',name:'NDA',number,private:true});
  }
  return db;
 }
 function privateFolder(db,id){const seen=new Set();while(id){if(seen.has(id))return true;seen.add(id);const f=db.folders.find(x=>x.id===id);if(!f)return true;if(f.private||f.id===NDA_FOLDER)return true;id=f.parent;}return false;}
 async function mutate(fn){const work=serial.then(async()=>{const db=await readIndex(),result=await fn(db);await storage('index.bin','PUT',seal(Buffer.from(JSON.stringify(db))));return result;});serial=work.catch(()=>{});return work;}
 async function body(req,max=16384){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw err(413,'File too large');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw err(400,'Invalid request');}}
 function throttle(k,max,window){const now=Date.now();if(limits.size>5000){for(const [id,v] of limits)if(v.until<now)limits.delete(id);if(limits.size>5000)throw err(429,'Try again later');}let v=limits.get(k);if(!v||v.until<now){v={n:0,until:now+window};limits.set(k,v);}if(++v.n>max)throw err(429,'Too many attempts');}
 function cleanName(s){if(typeof s!=='string'||!s.trim()||s.length>180||/[\\/\x00-\x1f]/.test(s))throw err(400,'Invalid name');return s.trim();}
 function session(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const s=sessions.get(token);if(!s||s.exp<Date.now())throw err(401,'Sign in first');return s;}
 async function controlAccess(req){
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  const user=sessions.get(token);
  if(!user||user.exp<Date.now())return null;
  const role=roleFor(await readIndex(),user.email);
  return role===user.role&&(isAdmin(role)||role==='viewer'||role==='team')?role:null;
 }
 async function handle(req,res,url,json,sameOrigin){
  if(!ready())return json(res,503,{error:'Data room access and storage are not configured'});
  if(req.method==='POST'&&!sameOrigin())return json(res,403,{error:'Forbidden'});
  const route=url.pathname.slice('/api/dataroom/'.length),remote=req.socket.remoteAddress||'unknown';
  if(route==='login'&&req.method==='POST'){
   const data=await body(req);
   const email=String(data.email||'').trim().toLowerCase();
   throttle('login:'+remote,30,900000);
   const access=await mutate(db=>{
    const role=roleFor(db,email);
    if(!role)throw err(403,'غير مصرح لك بالدخول');
    if(isAdmin(role)){
     if(data.password===undefined)return {requiresPassword:true};
     const attemptKey='admin-password:'+remote;
     throttle(attemptKey,5,900000);
     const candidate=normalizeDigits(data.password);
     const expected=Buffer.from(adminPin);
     const supplied=Buffer.from(candidate);
     if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){
      throw err(401,'كلمة المرور غير صحيحة');
     }
     limits.delete(attemptKey);
    }
    const invite=db.invites[email];
    if(invite){
     invite.firstLoginAt??=new Date().toISOString();
     invite.lastLoginAt=new Date().toISOString();
    }
    return {role,accepted:db.acceptances[email]};
   });
   if(access.requiresPassword)return json(res,200,access);
   const {role,accepted}=access;
   for(const [token,session] of sessions)if(session.exp<Date.now())sessions.delete(token);
   const token=randomBytes(32).toString('hex');
   sessions.set(token,{email,role,exp:Date.now()+3600000});
   return json(res,200,{token,role,admin:isAdmin(role),needsNda:!isAdmin(role)&&accepted?.version!==VERSION,name:isAdmin(role)?'Admin':accepted?.name||''});
  }
  const s=session(req);const currentDb=await readIndex();const role=roleFor(currentDb,s.email);if(!role||role!==s.role)throw err(403,'انتهت أو ألغيت صلاحية الوصول');const admin=isAdmin(role);
  if(route==='logout'&&req.method==='POST'){sessions.delete((req.headers.authorization||'').slice(7));return json(res,200,{ok:true});}
  const accepted=currentDb.acceptances[s.email];
  if(route==='session'&&req.method==='GET')return json(res,200,{
   email:s.email,role,admin,needsNda:!isAdmin(role)&&accepted?.version!==VERSION,
   name:admin?'Admin':accepted?.name||'',
  });
  if(route==='accept'&&req.method==='POST'){
   if(admin)return json(res,200,{ok:true,admin:true,name:'Admin'});
   const d=await body(req);if(d.agree!==true||d.version!==VERSION)throw err(400,'NDA acceptance required');const name=cleanName(d.name);
   const record=await mutate(async db=>{const old=db.acceptances[s.email];if(old?.version===VERSION)return old;
    const acceptedAt=new Date().toISOString(),id=randomBytes(16).toString('hex');
    const record={name,email:s.email,version:VERSION,acceptedAt,method:'declared email and explicit electronic acceptance',agreementHash:createHash('sha256').update(NDA_TEXT).digest('hex'),fileId:id};
    const bytes=await createNdaPdf(NDA_TEXT,record);
    const f={id,name:'NDA - '+s.email+' - '+VERSION+'.pdf',parent:NDA_FOLDER,size:bytes.length,private:true};
    await storage('files/'+id+'.bin','PUT',seal(bytes));db.files.push(f);db.acceptances[s.email]=record;return record;
   });return json(res,200,{ok:true,admin:false,name:record.name});
  }
  const db=await readIndex();if(!admin&&db.acceptances[s.email]?.version!==VERSION)throw err(403,'Accept NDA first');
  if(route==='list'&&req.method==='GET')return json(res,200,{folders:db.folders.filter(f=>admin||!privateFolder(db,f.id)),files:db.files.filter(f=>admin||(!f.private&&!privateFolder(db,f.parent))),admin,role});
  if(route==='preview'&&req.method==='GET'){
   const file=db.files.find(item=>item.id===url.searchParams.get('id'));
   if(!file||(!admin&&(file.private||privateFolder(db,file.parent))))throw err(404,'File not found');
   let bytes=await storage('files/'+file.id+'.bin');
   if(!bytes)throw err(404,'File not found');
   let type;
   if(bytes.subarray(0,5).toString()==='%PDF-'){
    const value=url.searchParams.get('page');
    const page=value===null?null:Number(value);
    if(page!==null&&(!Number.isSafeInteger(page)||page<1||page>250))throw err(400,'رقم الصفحة غير صالح');
    throttle('document-preview:'+s.email,600,900000);
    let rendered;
    try{rendered=await pdfPreview(bytes,page);}
    catch{throw err(415,'تعذرت معاينة ملف PDF');}
    if(page===null){
     if(!Number.isSafeInteger(rendered)||rendered<1||rendered>250)throw err(415,'المعاينة تدعم ملفات PDF حتى 250 صفحة');
     const record=admin?Object.values(db.acceptances).find(item=>item.fileId===file.id):null;
     const acceptance=record?{name:record.name,email:record.email,acceptedAt:record.acceptedAt}:null;
     return json(res,200,{pages:rendered,acceptance});
    }
    bytes=rendered;
    type='image/jpeg';
   }
   else if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))type='image/png';
   else if(bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))type='image/jpeg';
   else if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))type='image/gif';
   else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')type='image/webp';
   else if(/\.(txt|csv|md)$/i.test(file.name))type='text/plain; charset=utf-8';
   else if(/\.docx$/i.test(file.name)){
    try{bytes=Buffer.from((await mammoth.extractRawText({buffer:bytes})).value);}
    catch{throw err(415,'تعذرت معاينة مستند Word');}
    type='text/plain; charset=utf-8';
   }
   if(!type)throw err(415,'هذا النوع لا يدعم المعاينة');
   res.writeHead(200,{'Content-Type':type,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(file.name),'Cache-Control':'no-store'});
   return res.end(bytes);
  }
  if(!admin)throw err(403,'Admin only');
  function inviteStatus(invite) {
   if(invite.revokedAt)return 'Revoked';
   if(!isActiveInvite(invite))return 'Expired';
   if(!invite.firstLoginAt)return 'Invited';
   if(invite.role==='dataroom'&&db.acceptances[invite.email]?.version!==VERSION)return 'Pending';
   return 'Accepted';
  }
  if(route==='invites'&&req.method==='GET'){
   const invites=Object.values(db.invites).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    .map(invite=>({...invite,status:inviteStatus(invite),editable:invite.email!==s.email}));
   return json(res,200,{invites});
  }
  if(['invite','edit-invite','revoke'].includes(route)&&req.method==='POST'){
   const input=await body(req);
   const email=String(input.email||'').trim().toLowerCase();
   const days=input.days;
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw err(400,'بريد إلكتروني غير صالح');
   if(email===ADMIN||email===s.email)throw err(403,'لا يمكن تعديل صلاحية هذا الحساب');
   if(route!=='revoke'&&!['admin','viewer','dataroom','team'].includes(input.role))throw err(400,'صلاحية غير صالحة');
   const duration=Number(days);
   const validDuration=Number.isSafeInteger(duration)&&duration>=1&&duration<=3650;
   if(input.role!=='team'&&(route==='invite'||(route==='edit-invite'&&days!==undefined))&&!validDuration)
    throw err(400,'مدة وصول غير صالحة');
   let invalidateSessions=route!=='edit-invite';
   const invite=await mutate(index=>{
    if(!isAdmin(roleFor(index,s.email))||roleFor(index,s.email)!==s.role)throw err(403,'غير مصرح لك');
    const existing=index.invites[email];
    if(route==='edit-invite'){
     if(!isActiveInvite(existing))throw err(404,'الدعوة غير سارية');
     if(existing.role==='team'&&input.role!=='team'&&!validDuration)throw err(400,'اختر مدة الوصول للصلاحية الجديدة');
     invalidateSessions=existing.role!==input.role;
     existing.role=input.role;
     if(input.role==='team')existing.expiresAt=null;
     else if(days!==undefined)existing.expiresAt=new Date(Date.now()+duration*86400000).toISOString();
     return existing;
    }
    if(route==='revoke'){
     if(!existing)throw err(404,'الدعوة غير موجودة');
     existing.revokedAt=new Date().toISOString();
     return existing;
    }
    if(isActiveInvite(existing))throw err(409,'لهذا الحساب دعوة سارية. عدّل الصلاحية من القائمة.');
    const now=Date.now();
    const item={email,role:input.role,createdAt:new Date(now).toISOString(),expiresAt:input.role==='team'?null:new Date(now+duration*86400000).toISOString(),firstLoginAt:null,lastLoginAt:null,revokedAt:null};
    index.invites[email]=item;
    return item;
   });
   if(invalidateSessions)for(const [token,active] of sessions)if(active.email===email)sessions.delete(token);
   return json(res,200,{ok:true,invite});
  }
  if(route==='delete'&&req.method==='POST'){
   const {kind,id}=await body(req);
   if(!['file','folder'].includes(kind)||typeof id!=='string')throw err(400,'Invalid item');
   const pending=await mutate(db=>{
    db.pendingFileDeletes??=[];
    const folderIds=new Set();
    if(kind==='folder'){
     if(!db.folders.some(folder=>folder.id===id))throw err(404,'Folder not found');
     folderIds.add(id);
     for(const folderId of folderIds){
      for(const folder of db.folders)if(folder.parent===folderId)folderIds.add(folder.id);
     }
     if(folderIds.has(NDA_FOLDER))throw err(409,'مجلد أرشيف عدم الإفصاح محمي');
    }else if(!db.files.some(file=>file.id===id)&&!db.pendingFileDeletes.includes(id)){
     throw err(404,'File not found');
    }
    const removed=db.files.filter(file=>kind==='file'?file.id===id:folderIds.has(file.parent));
    const removedIds=new Set(removed.map(file=>file.id));
    db.files=db.files.filter(file=>!removedIds.has(file.id));
    db.folders=db.folders.filter(folder=>!folderIds.has(folder.id));
    db.pendingFileDeletes=[...new Set([...db.pendingFileDeletes,...removedIds])];
    return db.pendingFileDeletes;
   });
   const deleted=[];
   for(const fileId of pending){
    try{await storage('files/'+fileId+'.bin','DELETE');deleted.push(fileId);}
    catch{console.warn('Data Room object deletion pending');}
   }
   if(deleted.length)await mutate(db=>{
    const done=new Set(deleted);
    db.pendingFileDeletes=db.pendingFileDeletes.filter(fileId=>!done.has(fileId));
   });
   return json(res,200,{ok:true,pending:pending.length-deleted.length});
  }
  if(route==='folder'&&req.method==='POST'){const d=await body(req),name=cleanName(d.name),parent=d.parent??null;const folder=await mutate(db=>{if(parent!==null&&!db.folders.some(x=>x.id===parent))throw err(404,'Folder not found');if(db.folders.some(f=>f.parent===parent&&f.name.toLowerCase()===name.toLowerCase()))throw err(409,'يوجد مجلد بهذا الاسم');const item={id:randomBytes(16).toString('hex'),name,parent,number:1+Math.max(0,...db.folders.filter(x=>x.parent===parent).map(x=>x.number))};db.folders.push(item);return item;});return json(res,201,folder);}
  if(['rename-folder','rename-file'].includes(route)&&req.method==='POST'){
   const input=await body(req);
   const requestedName=cleanName(input.name);
   const isFile=route==='rename-file';
   const renamed=await mutate(db=>{
    if(!isAdmin(roleFor(db,s.email))||roleFor(db,s.email)!==s.role)throw err(403,'غير مصرح لك');
    const items=isFile?db.files:db.folders;
    const target=items.find(f=>f.id===input.id);
    if(!target)throw err(404,isFile?'الملف غير موجود':'المجلد غير موجود');
    const extension=isFile?(target.name.match(/\.[^.]+$/)?.[0]??''):'';
    const name=cleanName(extension&&!requestedName.toLowerCase().endsWith(extension.toLowerCase())?requestedName+extension:requestedName);
    if(items.some(f=>f.id!==target.id&&f.parent===target.parent&&f.name.toLowerCase()===name.toLowerCase()))
     throw err(409,isFile?'يوجد ملف بهذا الاسم':'يوجد مجلد بهذا الاسم');
    target.name=name;
    return target;
   });
   return json(res,200,renamed);
  }
  if(route==='upload'&&req.method==='POST'){const d=await body(req,14*1024*1024),name=cleanName(d.name),parent=d.parent;if(typeof d.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(d.data))throw err(400,'Invalid file');const bytes=Buffer.from(d.data,'base64');if(!bytes.length||bytes.length>10*1024*1024)throw err(413,'Maximum 10 MB');const file=await mutate(async db=>{if(!db.folders.some(x=>x.id===parent))throw err(404,'Folder not found');const f={id:randomBytes(16).toString('hex'),name,parent,size:bytes.length};await storage('files/'+f.id+'.bin','PUT',seal(bytes));db.files.push(f);return f;});return json(res,201,file);}
  return json(res,404,{error:'Not found'});
 };
 handle.controlAccess=controlAccess;
 return handle;
}
