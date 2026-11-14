import { sign } from 'node:crypto';

const metricNames=['activeUsers','engagedSessions','userEngagementDuration','sessions','screenPageViews'];
const tokenUrl='https://oauth2.googleapis.com/token';

export function googleAnalytics(env,fetcher){
  const {GA4_PROPERTY_ID:property,GA4_START_DATE:from,GA4_SERVICE_ACCOUNT_JSON:credentials}=env;
  let cached;
  let pending;
  async function read(){
    const {client_email:email,private_key:key}=JSON.parse(credentials);
    const now=Math.floor(Date.now()/1000);
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const claims=encode({iss:email,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:tokenUrl,iat:now,exp:now+3600});
    const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+claims;
    const assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
    const token=await fetcher(tokenUrl,{method:'POST',body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion
    }),signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!token.ok)throw Error('Google token request failed');
    const {access_token}=await token.json();
    if(typeof access_token!=='string'||!access_token)throw Error('Google token missing');
    const response=await fetcher(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,{
      method:'POST',headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},
      body:JSON.stringify({dateRanges:[{startDate:from,endDate:'today'}],metrics:metricNames.map(name=>({name}))}),
      signal:AbortSignal.timeout(8000),redirect:'error'
    });
    if(!response.ok)throw Error('Google report request failed');
    const report=await response.json();
    const values=report.rowCount===0&&!report.rows?.length?metricNames.map(()=>0):
      report.rows?.[0]?.metricValues?.map(metric=>metric.value==null?NaN:Number(metric.value));
    if(values?.length!==metricNames.length||values.some(value=>!Number.isFinite(value)||value<0))throw Error('Unexpected Google metrics');
    const [activeUsers,engagedSessions,engagementSeconds,sessions,views]=values;
    return {state:'connected',from,activeUsers,engagedSessions,averageEngagementSeconds:sessions?Math.round(engagementSeconds/sessions):0,views};
  }
  return async function(){
    if(!/^\d+$/.test(property||'')||!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!credentials)return {state:'not_configured'};
    if(cached&&Date.now()-cached.at<60000)return cached.result;
    if(!pending)pending=read()
      .catch(()=>cached?.result.state==='connected'?{...cached.result,stale:true}:{state:'error'})
      .then(result=>{cached={at:Date.now(),result};return result;})
      .finally(()=>{pending=null;});
    return pending;
  };
}
