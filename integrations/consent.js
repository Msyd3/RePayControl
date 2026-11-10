(function(){
  if(!window.RePayControl)return;
  var project=(window.REPAY_CONTROL_CONFIG||{}).project||document.querySelector('script[data-project]')?.dataset.project;
  var hasChoice=false;
  try{hasChoice=localStorage.getItem('rc:'+project+':consent')==='yes'||localStorage.getItem('rc:'+project+':declined')==='yes';}catch{}
  if(navigator.globalPrivacyControl||navigator.doNotTrack==='1')return;
  var el=document.createElement('section');el.className='rc-consent';el.setAttribute('aria-label','تفضيلات قياس الاستخدام');
  var p=document.createElement('p');p.textContent='نستخدم قياسًا اختياريًا لفهم الزيارات وتحسين التجربة، دون تسجيل بيانات الحقول أو بيانات الدفع. يمكنك استخدام الموقع دون الموافقة.';el.append(p);
  var accept=document.createElement('button');accept.type='button';accept.textContent='السماح بالقياس';
  var decline=document.createElement('button');decline.type='button';decline.textContent='رفض';
  accept.onclick=function(){window.RePayControl.grantConsent();el.remove();};decline.onclick=function(){try{localStorage.setItem('rc:'+project+':declined','yes');}catch{}el.remove();};el.append(accept,decline);
  function mount(){document.body.appendChild(el);}
  function init(){var prefs=document.createElement('button');prefs.type='button';prefs.className='rc-preferences';prefs.textContent='تفضيلات القياس';prefs.onclick=function(){window.RePayControl.openPreferences();};document.body.appendChild(prefs);if(!hasChoice)mount();}
  if(document.body)init();else document.addEventListener('DOMContentLoaded',init,{once:true});
  window.RePayControl.openPreferences=function(){window.RePayControl.revokeConsent();try{localStorage.removeItem('rc:'+project+':declined');}catch{}mount();};
})();
