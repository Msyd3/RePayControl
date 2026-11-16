import { createHmac } from 'node:crypto';
function defaultPhoneAvatar(phone){
  let hash=2166136261;
  for(const digit of phone)hash=Math.imul(hash^digit.charCodeAt(0),16777619);
  return 'remoji-'+String((hash>>>0)%10+1).padStart(2,'0');
}

export async function walletAvatars(id,env,fetcher,store,readUsers,journal){
  const origin=new URL(env.POC_API_ORIGIN||'https://repay-poc.onrender.com');
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')return {};
  const response=await fetcher(new URL('/api/transfer-reviews/'+id,origin),{
    signal:AbortSignal.timeout(5000),redirect:'error'
  });
  if(!response.ok)return {};
  const review=await response.json();
  if(review.id!==id)return {};
  const snapshot=await readUsers();
  const users=snapshot.state==='connected'?snapshot.users:[];
  const entries=await Promise.all(['sender','recipient'].map(async role=>{
    const person=review[role];
    // This ID comes from the verified server-side review, never from a phone supplied by the browser.
    const phone=person?.id;
    if(typeof phone!=='string'||!/^9665[0-9]{8}$/.test(phone))return null;
    const lookupKey=createHmac('sha256',env.POC_ANALYTICS_PASSWORD||'')
      .update('repay-avatar-phone:'+phone).digest('hex');
    const user=users.find(record=>record.phoneAvatarKey===lookupKey);
    const selected=user?store.avatar(user.waitlistNumber):null;
    if(selected)return [role,selected];
    const assigned=user?.avatarId;
    const fallback=assigned??defaultPhoneAvatar(phone);
    if(!journal)return [role,fallback];
    const key=createHmac('sha256',store.secret).update('phone-avatar:'+phone).digest('hex');
    try{return [role,await journal.phoneAvatar(key,fallback)];}
    catch{return [role,fallback];}
  }));
  return Object.fromEntries(entries.filter(Boolean));
}
