import { maskMobile } from './report.mjs';

const cache=new Map();
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export async function pocSnapshot(env=process.env,fetcher=fetch){
  if(!env.POC_ANALYTICS_PASSWORD)return {state:'not_configured',scope:'all_time'};
  const key=env.POC_API_ORIGIN+'|'+env.POC_ANALYTICS_PASSWORD;
  const saved=cache.get(key);if(saved&&Date.now()-saved.at<60000)return saved.value;
  let value;
  try{
    const origin=new URL(env.POC_API_ORIGIN||'https://repay-poc.onrender.com');
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')throw Error('Invalid origin');
    const response=await fetcher(new URL('/api/analytics',origin),{headers:{Authorization:'Bearer '+env.POC_ANALYTICS_PASSWORD},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw Error('Upstream unavailable');
    const d=await response.json();
    if(['users','conversations','transfers'].some(k=>count(d[k])===null)||!Array.isArray(d.userList)||d.userList.length>10000)throw Error('Unexpected schema');
    const users=d.userList.map(u=>({name:String(u.name||'لم يحدد الاسم').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120),mobile:maskMobile(u.mobile),operations:count(u.operations),conversations:count(u.conversations),averageOperations:amount(u.averageOperations)}));
    value={state:'connected',scope:'all_time',source:'poc',users,metrics:{users:d.users,conversations:d.conversations,transferRequests:d.transfers,totalRequestedAmount:amount(d.totalAmounts),averageRequestedAmount:amount(d.averageAmounts),averageRequestsPerUser:amount(d.averageOperations)},fetchedAt:new Date().toISOString()};
  }catch{value={state:'error',scope:'all_time',message:'تعذر تحديث بيانات واتساب؛ أعد المحاولة لاحقًا'};}
  cache.clear();cache.set(key,{at:Date.now(),value});return value;
}
