/* RePayControl SDK v1.0. No form values, cookies, message bodies, query strings or payment data. */
(function(){
  'use strict';
  if(window.RePayControl)return;
  var script=document.currentScript,config=window.REPAY_CONTROL_CONFIG||{};
  var project=config.project||(script&&script.dataset.project),endpoint=config.endpoint||(script&&script.dataset.endpoint)||'';
  var started=false,queue=[],visitor='',session='',lastActivity=Date.now(),lastInteraction=Date.now(),lastPulse=Date.now(),scrollSteps=new Set(),forms=new WeakSet(),observers=[],interval;
  var originalFetch=window.fetch.bind(window),allowedProjects=['wallet','business','poc'];
  var uuid=function(){return crypto.randomUUID();};
  var safe=function(v){return typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(v)&&!/[0-9]{7,}/.test(v)?v:'';};
  var path=function(value){
    var p=String(value||location.pathname).split(/[?#]/)[0].replace(/\/+$/,'').replace(/\.html$/,'')||'/';if(p==='/index')p='/';
    var known=['/','/home','/login','/otp','/profile','/summary','/success','/failure','/bank-account','/api/leads','/api/session','/api/profile','/api/wallet','/api/auth/otp/request','/api/auth/otp/verify','/api/auth/otp/resend','/api/auth/logout','/api/bank-accounts','/webhooks/whatsapp','/health'];
    if(known.includes(p))return p;
    if(/^\/api\/transactions\/[^/]+(?:\/cancel)?$/.test(p))return p.endsWith('/cancel')?'/api/transactions/:id/cancel':'/api/transactions/:id';
    if(/^\/api\/bank-accounts\/[^/]+$/.test(p))return '/api/bank-accounts/:id';
    if(/^\/api\/transfer-reviews\/[^/]+$/.test(p))return '/api/transfer-reviews/:id';
    return '/other';
  };
  var gaId=config.gaMeasurementId||(script&&script.dataset.gaId)||'',gaReady=false;
  if(!/^G-[A-Z0-9]{6,20}$/.test(gaId)||!['wallet','business'].includes(project))gaId='';
  function gaContext(){return {page_location:location.origin+path(),page_title:'RePay '+project,page_referrer:'',repay_source:project};}
  function gaStart(){
    if(!gaId)return;
    window['ga-disable-'+gaId]=false;
    if(!gaReady){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
      window.gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
      window.gtag('consent','update',{analytics_storage:'granted'});
      window.gtag('js',new Date());window.gtag('config',gaId,Object.assign(gaContext(),{send_page_view:true,allow_google_signals:false,allow_ad_personalization_signals:false}));
      var tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id='+gaId;document.head.appendChild(tag);gaReady=true;
    }else window.gtag('consent','update',{analytics_storage:'granted'});
  }
  function gaEvent(name,p){
    if(!gaReady||!started)return;
    window.gtag('set',gaContext());
    // GA enhanced measurement owns automatic page views; custom events use a separate prefix.
    if(name==='page_view'||name==='engagement')return;
    window.gtag('event','repay_'+name,Object.assign(gaContext(),{send_to:gaId,button_id:safe(p.target),metric:p.metric,value:p.value,http_status:p.status}));
  }
  var device=function(){return /iPad|Tablet/i.test(navigator.userAgent)?'tablet':/Mobi|Android|iPhone/i.test(navigator.userAgent)?'mobile':'desktop';};
  var browser=function(){var u=navigator.userAgent;return /Edg/.test(u)?'Edge':/Firefox/.test(u)?'Firefox':/Chrome|Chromium/.test(u)?'Chrome':/Safari/.test(u)?'Safari':'Other';};
  var referrer=function(){try{if(!document.referrer)return 'direct';var h=new URL(document.referrer).hostname;if(h===location.hostname)return 'internal';if(/(^|\.)(google\.[a-z.]+|bing.com|duckduckgo.com)$/.test(h))return 'search';if(/(^|\.)(t.co|x.com|twitter.com|facebook.com|instagram.com|linkedin.com|tiktok.com)$/.test(h))return 'social';return 'referral';}catch{return 'direct';}};
  function storageGet(key){try{return localStorage.getItem(key);}catch{return null;}}
  function storageSet(key,v){try{localStorage.setItem(key,v);}catch{}}
  function ensureSession(){
    var now=Date.now(),key='rc:'+project+':session',saved;
    try{saved=JSON.parse(storageGet(key)||'null');}catch{}
    if(!session){if(saved&&now-saved.at<1800000&&safe(saved.id))session=saved.id;else session=uuid();}
    if(now-lastActivity>1800000){session=uuid();scrollSteps.clear();}
    lastActivity=now;storageSet(key,JSON.stringify({id:session,at:now}));
  }
  function event(name,props){
    if(!started)return;ensureSession();
    var p=props||{},q=new URLSearchParams(location.search);
    gaEvent(name,p);
    if(!endpoint)return;
    queue.push({id:uuid(),project:project,name:name,visitor:visitor,session:session,path:path(p.path),target:safe(p.target),device:device(),browser:browser(),referrer:referrer(),source:safe(q.get('utm_source')),medium:safe(q.get('utm_medium')),campaign:safe(q.get('utm_campaign')),metric:p.metric,value:p.value,duration:p.duration,status:p.status});
    if(queue.length>=20)flush();
  }
  function flush(){
    if(!started||!queue.length)return;
    var batch=queue.splice(0,40);
    originalFetch(endpoint+'/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),credentials:'omit',mode:'cors',keepalive:true}).then(function(r){if(r.status===429||r.status>=500)queue= batch.concat(queue).slice(-80);}).catch(function(){queue=batch.concat(queue).slice(-80);});
  }
  function target(el){return safe(el.getAttribute('data-control-id'))||safe(el.getAttribute('data-testid'))||safe(el.id)||el.tagName.toLowerCase()+'-'+Array.from(document.querySelectorAll(el.tagName)).indexOf(el);}
  function clicked(e){if(!started)return;var el=e.target.closest&&e.target.closest('button,a,[role="button"],[data-control-id]');if(!el)return;
    event('click',{target:target(el)});
    if(el.tagName==='A'){try{var link=new URL(el.href,location.href);if(el.hasAttribute('download'))event('download',{target:target(el)});else if(link.origin!==location.origin)event('outbound_click',{target:target(el)});}catch{}}
  }
  function formStart(e){if(!started)return;var f=e.target.closest&&e.target.closest('form');if(f&&!forms.has(f)){forms.add(f);event('form_start',{target:target(f)});}}
  function formSubmit(e){if(started)event('form_submit',{target:target(e.target)});}
  function scroll(){if(!started)return;lastInteraction=Date.now();var range=document.documentElement.scrollHeight-innerHeight;if(range<=0)return;var depth=Math.round(scrollY/range*100);[25,50,75,100].forEach(function(n){if(depth>=n&&!scrollSteps.has(n)){scrollSteps.add(n);event('scroll',{target:'depth-'+n,value:n});}});}
  function pulse(force){var now=Date.now();if(started&&(force||!document.hidden)&&now-lastInteraction<60000)event('engagement',{duration:Math.min(now-lastPulse,15000)});lastPulse=now;flush();}
  function observe(type,fn){try{var o=new PerformanceObserver(function(list){if(started)fn(list.getEntries());});o.observe({type:type,buffered:true});observers.push(o);}catch{}}
  var lcp=null,cls=0,clsWindow=0,clsStart=0,clsLast=0;
  function metrics(){
    var nav=performance.getEntriesByType('navigation')[0];if(nav)event('performance',{metric:'TTFB',value:nav.responseStart});
    observe('paint',function(entries){entries.forEach(function(e){if(e.name==='first-contentful-paint')event('performance',{metric:'FCP',value:e.startTime});});});
    observe('largest-contentful-paint',function(entries){if(entries.length)lcp=entries[entries.length-1].startTime;});
    observe('layout-shift',function(entries){entries.forEach(function(e){if(e.hadRecentInput)return;if(e.startTime-clsLast>1000||e.startTime-clsStart>5000){clsWindow=e.value;clsStart=e.startTime;}else clsWindow+=e.value;clsLast=e.startTime;cls=Math.max(cls,clsWindow);});});
  }
  var finalized=false;
  function finalize(){if(!started)return;if(!finalized){if(lcp!==null)event('performance',{metric:'LCP',value:lcp});event('performance',{metric:'CLS',value:cls});finalized=true;}pulse(true);}
  function page(){scrollSteps.clear();forms=new WeakSet();event('page_view');flush();}
  function start(){
    if(started||!allowedProjects.includes(project)||(!endpoint&&!gaId)||navigator.globalPrivacyControl||navigator.doNotTrack==='1')return false;
    try{if(endpoint){var u=new URL(endpoint,location.href);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))return false;endpoint=u.origin;}}catch{return false;}
    started=true;finalized=false;lcp=null;cls=0;clsWindow=0;clsStart=0;clsLast=0;visitor=storageGet('rc:'+project+':visitor');if(!safe(visitor)){visitor=uuid();storageSet('rc:'+project+':visitor',visitor);}lastActivity=Date.now();lastInteraction=Date.now();lastPulse=Date.now();
    ensureSession();gaStart();page();metrics();interval=setInterval(pulse,15000);return true;
  }
  function revoke(){started=false;queue=[];clearInterval(interval);observers.forEach(function(o){o.disconnect();});observers=[];
    if(gaId){window['ga-disable-'+gaId]=true;if(gaReady)window.gtag('consent','update',{analytics_storage:'denied'});}
    try{localStorage.removeItem('rc:'+project+':visitor');localStorage.removeItem('rc:'+project+':session');localStorage.removeItem('rc:'+project+':consent');}catch{}visitor='';session='';}
  document.addEventListener('click',clicked,true);document.addEventListener('focusin',formStart,true);document.addEventListener('submit',formSubmit,true);window.addEventListener('scroll',scroll,{passive:true});
  ['pointerdown','keydown','touchstart'].forEach(function(n){window.addEventListener(n,function(){if(started){lastInteraction=Date.now();ensureSession();}},{passive:true});});
  document.addEventListener('visibilitychange',function(){if(document.hidden)finalize();else lastPulse=Date.now();});window.addEventListener('pagehide',finalize);
  window.addEventListener('pageshow',function(e){if(e.persisted){finalized=false;lastPulse=Date.now();}});
  window.addEventListener('error',function(){event('js_error',{target:'runtime-error'});});window.addEventListener('unhandledrejection',function(){event('js_error',{target:'unhandled-promise'});});
  ['pushState','replaceState'].forEach(function(k){var fn=history[k];history[k]=function(){var prev=location.pathname,result=fn.apply(this,arguments);if(prev!==location.pathname&&started)page();return result;};});window.addEventListener('popstate',function(){if(started)page();});
  window.fetch=function(input,options){
    var t=performance.now(),u;try{u=new URL(typeof input==='string'?input:input.url,location.href);}catch{return originalFetch(input,options);}
    var measured=started&&u.origin===location.origin&&u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/api/events');
    if(measured&&['/api/leads','/api/auth/otp/request','/api/auth/otp/verify','/api/auth/otp/resend'].includes(u.pathname)){
      ensureSession();var headers=new Headers(options&&options.headers||((input instanceof Request)?input.headers:undefined));headers.set('X-RePayControl-Session',session);headers.set('X-RePayControl-Visitor',visitor);options=Object.assign({},options||{},{headers:headers});
    }
    return originalFetch(input,options).then(function(r){if(measured)event('api_request',{path:u.pathname,status:r.status,duration:performance.now()-t});return r;},function(e){if(measured)event('api_request',{path:u.pathname,status:0,duration:performance.now()-t});throw e;});
  };
  window.RePayControl={
    grantConsent:function(){storageSet('rc:'+project+':consent','yes');return start();},
    revokeConsent:revoke,
    track:function(name,props){if(['form_start','form_submit','click'].includes(name))event(name,props);},
    session:function(){return started?session:'';},
    visitor:function(){return started?visitor:'';},
    flush:flush,
    enabled:function(){return started;}
  };
  if(storageGet('rc:'+project+':consent')==='yes')start();
})();
