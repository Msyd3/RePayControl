import { createHmac } from 'node:crypto';
import { maskMobile } from './report.mjs';

const cache=new Map();
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
function registrationDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;
  const date=Date.parse(value);
  return Number.isFinite(date)&&date<=Date.now()?date:null;
}

export const validAvatar=id=>typeof id==='string'&&/^remoji-(0[1-9]|10)$/.test(id);
function avatarFor(waitlistNumber,secret){
  if(waitlistNumber===null)return null;
  const index=createHmac('sha256',secret).update(String(waitlistNumber)).digest()[0]%10;
  return 'remoji-'+String(index+1).padStart(2,'0');
}

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
    const users=d.userList.map(u=>{
      const waitlistNumber=count(u.waitlistNumber)||null;
      const phoneAvatarKey=typeof u.phoneAvatarKey==='string'&&/^[a-f0-9]{64}$/.test(u.phoneAvatarKey)?u.phoneAvatarKey:null;
      return {waitlistNumber,phoneAvatarKey,avatarId:validAvatar(u.avatarId)?u.avatarId:avatarFor(waitlistNumber,env.POC_ANALYTICS_PASSWORD),
        name:String(u.name||'لم يحدد الاسم').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120),
        mobile:maskMobile(u.mobile),operations:count(u.operations),conversations:count(u.conversations),
        registeredAt:registrationDate(u.registeredAt)};
    });
    value={state:'connected',scope:'all_time',source:'poc',users,metrics:{users:d.users,conversations:d.conversations,transferRequests:d.transfers,averageRequestsPerUser:amount(d.averageOperations)},fetchedAt:new Date().toISOString()};
  }catch{value={state:'error',scope:'all_time',message:'تعذر تحديث بيانات واتساب؛ أعد المحاولة لاحقًا'};}
  cache.clear();cache.set(key,{at:Date.now(),value});return value;
}
