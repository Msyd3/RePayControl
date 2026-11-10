import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const source=readFileSync(new URL('../public/repay-control.js',import.meta.url),'utf8');
function browser(dnt=false,gaId=''){
  const requests=[],listeners={},saved=new Map(),documentListeners={},scripts=[];
  const context={URL,URLSearchParams,Headers,Request,Set,WeakSet,Date,Array,JSON,Math,Promise,crypto:{randomUUID},navigator:{userAgent:'Test Chrome',doNotTrack:dnt?'1':'0'},location:{origin:'https://wallet.example',hostname:'wallet.example',pathname:'/home',search:'?phone=966500000000&token=private&email=private@example.com'},
    history:{pushState(){},replaceState(){}},performance:{now:()=>10,getEntriesByType:()=>[]},innerHeight:800,scrollY:0,
    setInterval:()=>1,clearInterval(){},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    document:{head:{appendChild:x=>scripts.push(x)},createElement:()=>({}),currentScript:{dataset:{project:'wallet',endpoint:'https://control.example',gaId}},referrer:'',hidden:false,documentElement:{scrollHeight:1000},addEventListener:(k,f)=>documentListeners[k]=f,querySelectorAll:()=>[]},
    addEventListener:(k,f)=>listeners[k]=f,
    fetch:async(url,options)=>{requests.push({url,options});return {status:202};},
    PerformanceObserver:class{observe(){}disconnect(){}}
  };
  context.window=context;vm.createContext(context);vm.runInContext(source,context);return {context,requests,listeners,documentListeners,saved,scripts};
}
test('SDK does not send events before consent and respects Do Not Track',()=>{
  const a=browser();assert.equal(a.requests.length,0);assert.equal(a.context.RePayControl.enabled(),false);
  const b=browser(true);assert.equal(b.context.RePayControl.grantConsent(),false);assert.equal(b.requests.length,0);
});
test('SDK sends visits and clicks without URL secrets, then stops after revocation',()=>{
  const b=browser();assert.equal(b.context.RePayControl.grantConsent(),true);
  const el={tagName:'BUTTON',id:'confirm-button',getAttribute:()=>null};b.documentListeners.click({target:{closest:()=>el}});b.context.RePayControl.flush();
  const payloads=b.requests.filter(x=>x.url.endsWith('/api/events')).flatMap(x=>JSON.parse(x.options.body).events);
  assert.equal(payloads.filter(x=>x.name==='page_view').length,1);assert.equal(payloads.find(x=>x.name==='click').target,'confirm-button');
  assert.ok(!JSON.stringify(payloads).includes('private'));assert.ok(!JSON.stringify(payloads).includes('966500000000'));
  b.context.RePayControl.revokeConsent();const count=b.requests.length;b.documentListeners.click({target:{closest:()=>el}});b.context.RePayControl.flush();assert.equal(b.requests.length,count);assert.equal(b.context.RePayControl.enabled(),false);
});
test('SDK adds correlation only to approved same-origin API calls and never sends the server secret',async()=>{
  const b=browser();b.context.RePayControl.grantConsent();
  await b.context.fetch('https://wallet.example/api/auth/otp/verify',{method:'POST',headers:{'X-CSRF-Token':'csrf-test'},body:'{"code":"123456"}'});
  const original=b.requests.find(x=>x.url.includes('/api/auth/otp/verify'));assert.ok(original.options.headers.get('X-RePayControl-Session'));assert.equal(original.options.headers.get('X-CSRF-Token'),'csrf-test');
  await b.context.fetch('https://third.example/api/other',{method:'GET'});const external=b.requests.find(x=>x.url.startsWith('https://third'));assert.equal(external.options.headers,undefined);
  b.context.RePayControl.flush();const payloads=b.requests.filter(x=>x.url.endsWith('/api/events')).map(x=>x.options.body).join('');assert.ok(!payloads.includes('123456'));assert.ok(!payloads.includes('csrf-test'));assert.ok(!payloads.includes('Authorization'));
});

test('GA4 starts only after consent, sends a sanitized location and stops after revocation',()=>{
 const b=browser(false,'G-TEST12345');assert.equal(b.scripts.length,0);b.context.RePayControl.grantConsent();assert.equal(b.scripts.length,1);const calls=b.context.dataLayer.map(x=>Array.from(x));const config=calls.find(x=>x[0]==='config')[2];assert.equal(config.page_location,'https://wallet.example/home');assert.equal(config.page_referrer,'');assert.equal(config.send_page_view,true);assert.ok(!JSON.stringify(calls).includes('966500000000'));b.context.RePayControl.revokeConsent();assert.equal(b.context['ga-disable-G-TEST12345'],true);
});
