import http from 'node:http';
import {createDataRoom} from './dataroom.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { Store, projects, validateEvent } from './store.mjs';
import { prepareProfiles } from './report.mjs';
import { taroutJournal, storageUnavailable } from './tarout-journal.mjs';
import { connections } from './connectors.mjs';
import { walletAvatars } from './wallet-avatars.mjs';
import { googleAnalytics } from './google-analytics.mjs';
import { pocSnapshot, validAvatar } from './poc-snapshot.mjs';
import { normalizeDigits, configuredPassword } from './auth.mjs';

const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
function equal(a,b){const hash=x=>createHmac('sha256','repay-control-constant-compare').update(String(x||'')).digest();return timingSafeEqual(hash(a),hash(b));}
function csv(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function createApp({env=process.env,store,fetcher=fetch,journal=null}={}){
  const dataRoom=createDataRoom(env,fetcher);
  const readGoogle=googleAnalytics(env,fetcher);
  function backedReport(kind,readSource,accept){
    let saved;
    let pending;
    let refreshAt=0;
    let stale=false;
    return async function(){
      if(!journal)return readSource();
      if(!pending&&Date.now()>=refreshAt){
        refreshAt=Date.now()+60000;
        pending=(async()=>{
          if(saved===undefined)saved=await journal.readSnapshot(kind);
          const incoming=await readSource();
          if(incoming.state!=='connected'||incoming.stale||!accept(incoming,saved)){
            stale=true;
            return;
          }
          const comparable=({fetchedAt,...report})=>JSON.stringify(report);
          if(!saved||comparable(saved)!==comparable(incoming)){
            await journal.saveSnapshot(kind,incoming);
            saved=incoming;
          }
          stale=false;
        })().catch(()=>{stale=true;console.warn('Snapshot synchronization failed: '+kind);})
          .finally(()=>{pending=null;});
      }
      if(!saved&&pending)await pending;
      return saved?{...saved,storage:'tarout',stale}:{state:'error',message:'النسخة المحفوظة في تاروت غير متاحة حاليًا'};
    };
  }
  const readUsers=backedReport('users',()=>pocSnapshot(env,fetcher),
    (incoming,saved)=>Array.isArray(incoming.users)&&(!saved||incoming.users.length>=saved.users.length));
  const readMeasurement=backedReport('measurement',readGoogle,()=>true);
  const retention=journal||env.RETENTION_DAYS==='0'?0:Math.max(1,Math.min(365,Number(env.RETENTION_DAYS)||90));
  if(!store){mkdirSync(env.DATA_DIR||'data',{recursive:true});store=new Store(path.join(env.DATA_DIR||'data','control.sqlite'),env.SESSION_SECRET||'',retention);}
  const origins={wallet:(env.WALLET_ORIGINS||'https://wallet.repay.sa').split(','),business:(env.BUSINESS_ORIGINS||'https://repay.sa,https://www.repay.sa').split(','),poc:(env.POC_ORIGINS||'https://repay-poc.onrender.com').split(',')};
  for(const p of projects)origins[p]=origins[p].map(x=>x.trim()).filter(Boolean);
  const allowed=new Set(Object.values(origins).flat());
  const rate=new Map();
  function limit(key,max,window=60000){const now=Date.now();if(rate.size>20000){for(const[k,v]of rate)if(v.until<now)rate.delete(k);if(rate.size>20000)return false;}let r=rate.get(key);if(!r||r.until<now){r={n:0,until:now+window};rate.set(key,r);}return ++r.n<=max;}
  function signed(value){return createHmac('sha256',env.SESSION_SECRET||'disabled').update(value).digest('base64url');}
  function authenticated(req){if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return false;const bearer=(req.headers.authorization||'').startsWith('Bearer ')?req.headers.authorization.slice(7):'';const token=bearer||decodeURIComponent((req.headers.cookie||'').match(/(?:^|; )rc_session=([^;]*)/)?.[1]||'');const parts=token.split('.');return parts.length===3&&Number(parts[0])>Date.now()&&equal(parts[2],signed(parts[0]+'.'+parts[1]));}
  const json=(res,status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value));};
  async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536){throw Object.assign(new Error('Too large'),{status:413});}}try{return JSON.parse(text);}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
  async function persist(kind, rows) {
    if (!journal) return;
    try { await journal.append(kind,rows); }
    catch { throw storageUnavailable(); }
  }
  async function addEvents(events,trusted) {
    let rows;
    try { rows=events.map(event=>validateEvent(event,trusted,store.secret)); }
    catch { throw Object.assign(new Error('Invalid event payload'),{status:400}); }
    await persist('events',rows);
    return store.insertEvents(rows);
  }
  async function addProfiles(profiles) {
    let rows;
    try { rows=prepareProfiles(store.secret,profiles); }
    catch { throw Object.assign(new Error('Invalid profile payload'),{status:400}); }
    await persist('profiles',rows);
    return store.insertProfiles(rows);
  }
  const adminFrontendOrigins = new Set((env.ADMIN_FRONTEND_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean));
  const handler=async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; frame-src blob:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const url=new URL(req.url,'http://localhost');const origin=req.headers.origin||'';
    if(adminFrontendOrigins.has(origin)&&url.pathname.startsWith('/api/')&&!['/api/events','/api/server-events','/api/profiles'].includes(url.pathname)){
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Max-Age':'600'});return res.end();}
    }
    const remote=req.socket.remoteAddress||'unknown';
    const sameOrigin=()=>{if(!origin)return false;if(adminFrontendOrigins.has(origin))return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}};
    try{
      if(url.pathname.startsWith('/api/dataroom/'))return await dataRoom(req,res,url,json,sameOrigin);
      if(url.pathname==='/health')return json(res,200,{status:'ok'});
      if(url.pathname==='/api/wallet/avatars'){
        if(!origins.wallet.includes(origin))return json(res,403,{error:'Origin not allowed'});
        res.setHeader('Access-Control-Allow-Origin',origin);
        res.setHeader('Vary','Origin');
        if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
        if(!limit('wallet-avatars:'+remote,30))return json(res,429,{error:'Rate limit'});
        const id=url.searchParams.get('id');
        if(!/^[a-f0-9]{32}$/.test(id||''))return json(res,400,{error:'Invalid transfer review'});
        try{return json(res,200,await walletAvatars(id,env,fetcher,store,readUsers,journal));}
        catch{return json(res,200,{});}
      }
      if(url.pathname==='/api/events'){
        if(!allowed.has(origin))return json(res,403,{error:'Origin not allowed'});
        res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
        if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});return res.end();}
        if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
        if(!limit('events:'+remote,240))return json(res,429,{error:'Rate limit'}, {'Retry-After':'60'});
        const data=await body(req);
        if(!Array.isArray(data.events)||data.events.length<1||data.events.length>40)return json(res,400,{error:'Expected 1–40 events'});
        if(data.events.some(e=>!e||!origins[e.project]?.includes(origin)))return json(res,403,{error:'Project origin mismatch'});
        return json(res,202,{accepted:await addEvents(data.events,false)});
      }
      if(url.pathname==='/api/server-events'||url.pathname==='/api/profiles'){
        if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
        if(!env.SERVER_INGEST_KEY||!equal(req.headers.authorization,'Bearer '+env.SERVER_INGEST_KEY))return json(res,401,{error:'Unauthorized'});
        if(!limit('server:'+remote,600))return json(res,429,{error:'Rate limit'});
        const data=await body(req);
        if(url.pathname==='/api/profiles'){
          return json(res,202,{accepted:await addProfiles(data.profiles)});
        }
        if(!Array.isArray(data.events)||!data.events.length||data.events.length>40)return json(res,400,{error:'Expected 1–40 events'});
        return json(res,202,{accepted:await addEvents(data.events,true)});
      }
      if(url.pathname==='/api/login'){
        if(req.method!=='POST'||!sameOrigin())return json(res,403,{error:'Forbidden'});
        if(!limit('login:'+remote,5,900000))return json(res,429,{error:'محاولات كثيرة؛ أعد المحاولة بعد 15 دقيقة'}, {'Retry-After':'900'});
        if(!configuredPassword(env)||!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return json(res,503,{error:'أكمل إعداد ADMIN_PASSWORD و SESSION_SECRET على الخادم أولًا'});
        const data=await body(req);if(!equal(normalizeDigits(data.password),normalizeDigits(env.ADMIN_PASSWORD)))return json(res,401,{error:'كلمة المرور غير صحيحة'});
        const value=(Date.now()+8*3600000)+'.'+randomBytes(24).toString('base64url');
        const secure=env.NODE_ENV==='production'?'; Secure':'';
        return json(res,200,{ok:true,token:value+'.'+signed(value)},{'Set-Cookie':`rc_session=${value+'.'+signed(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`});
      }
      if(url.pathname==='/api/logout'){
        if(req.method!=='POST'||!sameOrigin())return json(res,403,{error:'Forbidden'});
        return json(res,200,{ok:true},{'Set-Cookie':'rc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
      }
      if(url.pathname.startsWith('/api/')){
        const role=authenticated(req)?'owner':await dataRoom.controlAccess(req);
        if(!role)return json(res,401,{error:'Unauthorized'});
        if(['viewer','team'].includes(role)&&(req.method!=='GET'||!['/api/me','/api/control-report'].includes(url.pathname)))
          return json(res,403,{error:'هذا الحساب للعرض فقط'});
        if(url.pathname==='/api/users/avatar'&&req.method==='POST'){
          if(!sameOrigin())return json(res,403,{error:'Forbidden'});
          const input=await body(req);
          if(!Number.isSafeInteger(input?.waitlistNumber)||input.waitlistNumber<1||!validAvatar(input.avatarId))
            return json(res,400,{error:'اختر أحد الميموجي المتاحة'});
          const {waitlistNumber,avatarId}=input;
          if(!journal)throw storageUnavailable();
          const snapshot=await readUsers();
          if(snapshot.state!=='connected')return json(res,503,{error:'تعذر الاتصال بمصدر المستخدمين'});
          if(!snapshot.users.some(user=>user.waitlistNumber===waitlistNumber))
            return json(res,404,{error:'المستخدم غير موجود'});
          const change={waitlistNumber,avatarId,version:`${Date.now()}-${randomBytes(8).toString('hex')}`};
          try{await journal.appendAvatar(change);}
          catch{throw storageUnavailable();}
          store.insertAvatars([change]);
          return json(res,200,{avatarId:store.avatar(waitlistNumber)});
        }
        if(url.pathname==='/api/recovered-report'&&req.method==='POST'){
          if(!sameOrigin())return json(res,403,{error:'Forbidden'});
          if(!journal)throw storageUnavailable();
          const input=await body(req);
          if(!input||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt))||!input.metrics||typeof input.metrics!=='object')return json(res,400,{error:'Invalid report'});
          const report=store.report(input.from,input.to);
          const metrics=report.metrics.filter(metric=>Object.hasOwn(input.metrics,metric.key)&&typeof input.metrics[metric.key]==='number'&&Number.isFinite(input.metrics[metric.key])&&input.metrics[metric.key]>=0).map(metric=>({...metric,value:input.metrics[metric.key]}));
          if(!metrics.length)return json(res,400,{error:'Report has no metrics'});
          const recovered={capturedAt:new Date(input.capturedAt).toISOString(),from:report.range.from,to:report.range.to,metrics};
          await persist('reports',[recovered]);store.insertRecoveredReports([recovered]);
          return json(res,202,{accepted:1});
        }
        if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
        if(url.pathname==='/api/me')return json(res,200,['viewer','team'].includes(role)?{authenticated:true,role}:{authenticated:true});
        if(url.pathname==='/api/control-report'){
          const dashboard=url.searchParams.get('view')==='dashboard';
          const report=dashboard?store.dashboard():store.report(url.searchParams.get('from'),url.searchParams.get('to'));
          const [poc,google]=await Promise.all([readUsers(),dashboard?readMeasurement():null]);
          report.pocSnapshot=poc.state==='connected'?{...poc,users:poc.users.map(({phoneAvatarKey,...user})=>({
            ...user,avatarId:store.avatar(user.waitlistNumber)??user.avatarId
          }))}:poc;
          if(dashboard)report.googleAnalytics=google;
          return json(res,200,report);
        }
        const project=url.searchParams.get('project')||'all',days=Math.max(1,Math.min(90,Number(url.searchParams.get('days'))||30));
        if(url.pathname==='/api/overview')return json(res,200,store.query(project,days));
        if(url.pathname==='/api/connections')return json(res,200,{...await connections(env,fetcher),origins,collector:{state:'ready',retentionDays:retention},checkedAt:new Date().toISOString()});
        if(url.pathname==='/api/export'){
          const d=store.query(project,days);
          const content=csv([['project','event','count','server_verified'],...d.events.map(e=>[e.project,e.name,e.count,e.trusted?'yes':'no'])]);
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="RePayControl-events.csv"','Cache-Control':'no-store'});return res.end(content);
        }
        return json(res,404,{error:'Not found'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
      const assets={'/dataroom':'dataroom/index.html','/dataroom/':'dataroom/index.html','/dataroom/room.css':'dataroom/room.css','/dataroom/room.js':'dataroom/room.js','/control-entry.js':'control-entry.js','/runtime-config.js':'runtime-config.js','/assets/repay-logo.png':'assets/repay-logo.png','/':'index.html','/index.html':'index.html','/dashboard.js':'dashboard.js','/styles.css':'styles.css','/export-pdf.js':'export-pdf.js','/vendor/pdf-lib.min.js':'vendor/pdf-lib.min.js','/vendor/html2canvas.min.js':'vendor/html2canvas.min.js','/repay-control.js':'repay-control.js','/fonts/Tajarib-Regular.otf':'fonts/Tajarib-Regular.otf','/fonts/Tajarib-Bold.otf':'fonts/Tajarib-Bold.otf','/fonts/Tajarib-License.pdf':'fonts/Tajarib-License.pdf'};
      const avatarAsset=/^\/assets\/avatars\/remoji-(0[1-9]|10)-still\.svg$/.test(url.pathname);
      const asset=avatarAsset?url.pathname.slice(1):assets[url.pathname];if(!asset)return json(res,404,{error:'Not found'});
      const types={'.svg':'image/svg+xml','.png':'image/png','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.otf':'font/otf','.pdf':'application/pdf'};
      res.writeHead(200,{'Content-Type':types[path.extname(asset)],'Cache-Control':asset==='repay-control.js'?'public, max-age=300':'no-cache'});
      return res.end(req.method==='HEAD'?undefined:readFileSync(path.join(publicDir,asset)));
    }catch(error){return json(res,error.status||500,{error:error.status?error.message:'تعذر إكمال الطلب'});}
  };
  const purgeTimer=setInterval(()=>store.purge(),3600000);purgeTimer.unref();
  const server=http.createServer(handler);
  const syncBackup=()=>{void readUsers();void readMeasurement();};
  const backupTimer=journal?setInterval(syncBackup,5*60000):null;
  backupTimer?.unref();
  if(journal)server.once('listening',syncBackup);
  server.on('close',()=>{clearInterval(purgeTimer);clearInterval(backupTimer);});
  return {server,store};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production'&&(!configuredPassword(process.env)||!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32||!process.env.SERVER_INGEST_KEY||process.env.SERVER_INGEST_KEY.length<32))throw new Error('Configure ADMIN_PASSWORD (4+ characters), SESSION_SECRET and SERVER_INGEST_KEY (32+ characters each)');
  const journal=taroutJournal(process.env);
  const {server,store}=createApp({journal});
  const host=process.env.HOST||'0.0.0.0';
  server.listen(Number(process.env.PORT)||4317,host,()=>{
    console.log(`RePayControl: http://${host}:${process.env.PORT||4317}`);
    if(journal)void journal.restore(store).catch(()=>console.warn('Initial Tarout restore failed'));
  });
}
