import { createSign } from 'node:crypto';

const cache=new Map();
export async function connections(env=process.env,fetcher=fetch) {
  const key=[env.POC_API_ORIGIN,env.POC_ANALYTICS_PASSWORD,env.GOOGLE_CLIENT_EMAIL,env.GOOGLE_PRIVATE_KEY,env.GOOGLE_SPREADSHEET_ID].join('|');
  const cached=cache.get(key);if(cached&&Date.now()-cached.at<60000)return cached.data;
  const result={poc:{state:'not_configured'},sheets:{state:'not_configured'}};
  const tasks=[];
  if(env.POC_ANALYTICS_PASSWORD) tasks.push((async()=>{
    try {
      const origin=new URL(env.POC_API_ORIGIN||'https://repay-poc.onrender.com');
      if(origin.protocol!=='https:'||origin.username||origin.password)throw new Error('HTTPS required');
      const res=await fetcher(new URL('/api/analytics',origin),{headers:{Authorization:`Bearer ${env.POC_ANALYTICS_PASSWORD}`},signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!res.ok){result.poc={state:'error',status:res.status};return;}
      const d=await res.json(),metrics={};
      for(const k of ['users','conversations','transfers','totalAmounts','averageAmounts','averageOperations']) if(typeof d[k]==='number'&&Number.isFinite(d[k]))metrics[k]=d[k];
      if(['users','conversations','transfers'].some(k=>metrics[k]===undefined))throw new Error('Unexpected analytics schema');
      result.poc={state:'connected',metrics,updatedAt:new Date().toISOString(),scope:'all_time',note:'transfers are recorded requests, not settled payments'};
    }catch{result.poc={state:'error',message:'تعذر الوصول إلى إحصاءات واتساب'};}
  })());
  if(env.GOOGLE_CLIENT_EMAIL&&env.GOOGLE_PRIVATE_KEY&&env.GOOGLE_SPREADSHEET_ID)tasks.push((async()=>{
    try{
      const now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
      const input=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:env.GOOGLE_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
      const signature=createSign('RSA-SHA256').update(input).sign(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n'),'base64url');
      const token=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signature}),signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!token.ok)throw new Error('Google authentication failed');
      const auth=await token.json();
      const range=`'${(env.GOOGLE_SHEET_TITLE||'الورقة1').replace(/'/g,"''")}'!A2:A100001`;
      const res=await fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}`,{headers:{Authorization:`Bearer ${auth.access_token}`},signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!res.ok)throw new Error('Sheet unavailable');
      const data=await res.json();
      const dates=(data.values||[]).map(row=>Date.parse(row[0])).filter(Number.isFinite);
      result.sheets={state:'connected',totalLeads:dates.length,last30Days:dates.filter(t=>t>=Date.now()-30*86400000).length,updatedAt:new Date().toISOString(),scope:'all_time',limit:100000};
    }catch{result.sheets={state:'error',message:'تعذر قراءة جدول طلبات التواصل'};}
  })());
  await Promise.allSettled(tasks);cache.clear();cache.set(key,{at:Date.now(),data:result});return result;
}
