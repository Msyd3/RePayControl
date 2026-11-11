import test from 'node:test';
import assert from 'node:assert/strict';
import { Store,validateEvent } from '../src/store.mjs';
import { prepareProfiles } from '../src/report.mjs';
import { taroutJournal } from '../src/tarout-journal.mjs';

test('encrypted Tarout batches restore historical events and do not count retried events twice',async()=>{
  const env={TAROUT_BUCKET_ID:'mock-bucket-1234',TAROUT_ACCESS_KEY:'mock-access',TAROUT_SECRET_KEY:'mock-secret',SESSION_SECRET:'mock-session-key-at-least-thirty-two-characters'};
  const files=new Map();
  const fetcher=async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer mock-access:mock-secret');
    const name=url.pathname.split('/').slice(5).join('/');
    if(options.method==='PUT'){files.set(name,Buffer.from(options.body));return new Response(null,{status:200});}
    if(url.searchParams.has('prefix'))return new Response(`<ListBucketResult>${[...files.keys()].map(k=>`<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`);
    return new Response(files.get(name));
  };
  const journal=taroutJournal(env,fetcher);
  const old={...validateEvent({id:'retry-id',project:'wallet',name:'page_view'},false,env.SESSION_SECRET),ts:Date.now()-500*86400000};
  await journal.append('events',[old]);
  await journal.append('events',[old]);
  await journal.append('profiles',prepareProfiles(env.SESSION_SECRET,[{project:'poc',userId:'example',name:'Example Person',mobile:'0501234567'}]));
  assert.ok([...files.values()].every(bytes=>!bytes.includes('Example Person')&&!bytes.includes('0501234567')));
  const restored=new Store(':memory:',env.SESSION_SECRET,0);
  try{
    await taroutJournal(env,fetcher).restore(restored);
    restored.purge();
    assert.equal(restored.db.prepare('SELECT count(*) AS n FROM events').get().n,1);
    assert.equal(restored.db.prepare('SELECT mobileMasked FROM user_profiles').get().mobileMasked,'050 XXXX 4567');
  }finally{restored.close();}
});
