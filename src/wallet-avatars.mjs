import { maskMobile } from './report.mjs';

function maskName(name){
  return name.split(' ').filter(Boolean).map(part=>
    part.length<=1?part+'***':part[0]+'*'.repeat(Math.min(part.length-1,8))
  ).join(' ');
}

export async function walletAvatars(id,env,fetcher,store,readUsers){
  const origin=new URL(env.POC_API_ORIGIN||'https://repay-poc.onrender.com');
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')return {};
  const response=await fetcher(new URL('/api/transfer-reviews/'+id,origin),{
    signal:AbortSignal.timeout(5000),redirect:'error'
  });
  if(!response.ok)return {};
  const review=await response.json();
  if(review.id!==id)return {};
  const snapshot=await readUsers();
  if(snapshot.state!=='connected')return {};
  const avatars={};
  for(const role of ['sender','recipient']){
    const person=review[role];
    if(typeof person?.name!=='string')continue;
    const mobile=maskMobile(person.phone);
    if(mobile==='—')continue;
    const matches=snapshot.users.filter(user=>user.mobile===mobile);
    if(matches.length!==1||maskName(matches[0].name)!==person.name)continue;
    const user=matches[0];
    const avatar=store.avatar(user.waitlistNumber)??user.avatarId;
    if(avatar)avatars[role]=avatar;
  }
  return avatars;
}
