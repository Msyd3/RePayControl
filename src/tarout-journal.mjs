import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const prefix = 'control-journal/';
const batchLimit = 128 * 1024;
const listLimit = 1000;
export const storageUnavailable = () => Object.assign(new Error('تعذر حفظ البيانات؛ أعد المحاولة لاحقًا'), {status:503});

export function taroutJournal(env, fetcher = fetch) {
  const { TAROUT_BUCKET_ID, TAROUT_ACCESS_KEY, TAROUT_SECRET_KEY, SESSION_SECRET } = env;
  if (!TAROUT_BUCKET_ID && !TAROUT_ACCESS_KEY && !TAROUT_SECRET_KEY) return null;
  if (!/^[a-z0-9-]{12,80}$/.test(TAROUT_BUCKET_ID || '') || !TAROUT_ACCESS_KEY || !TAROUT_SECRET_KEY || (SESSION_SECRET || '').length < 32) {
    throw new Error('Configure Tarout storage and the stable session secret');
  }
  const bucket = new URL(`/api/storage/gateway/${TAROUT_BUCKET_ID}`, 'https://tarout.sa');
  const headers = { Authorization:`Bearer ${TAROUT_ACCESS_KEY}:${TAROUT_SECRET_KEY}` };
  const key = createHash('sha256').update('RePayControl Tarout journal v1\0' + SESSION_SECRET).digest();

  async function request(url, method, body) {
    const response = await fetcher(url, {
      method, headers:{...headers,...(body ? {'Content-Type':'application/octet-stream'} : {})}, body,
      redirect:'error', cache:'no-store', signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw storageUnavailable();
    return response;
  }

  function seal(entry) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(gzipSync(JSON.stringify(entry))),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
  }

  function open(data) {
    if (data.length < 28 || data.length > batchLimit) throw storageUnavailable();
    const decipher = createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    const plain = gunzipSync(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]),{maxOutputLength:batchLimit*8});
    return JSON.parse(plain);
  }

  async function list(stem = '') {
    const url = new URL(bucket);
    url.searchParams.set('prefix',prefix+stem);
    const response = await request(url,'GET');
    const xml = await response.text();
    if (!xml.includes('ListBucketResult')) throw storageUnavailable();
    const keys = [...xml.matchAll(/<Key>(control-journal\/[0-9a-f]{32}\.bin)<\/Key>/g)].map(match=>match[1]);
    // Tarout caps lists at 1000. Split the namespace into smaller prefixes
    // whenever the response reaches the cap, so history isn't truncated.
    if (keys.length < listLimit && !/<IsTruncated>true<\/IsTruncated>/.test(xml)) return keys;
    if (stem.length >= 32) throw storageUnavailable();
    const children=[];
    for(const digit of '0123456789abcdef')children.push(...await list(stem+digit));
    return children;
  }

  function objectUrl(name) {return new URL(bucket.href+'/'+name);}
  return {
    async append(kind, rows) {
      const name = prefix+randomBytes(16).toString('hex')+'.bin';
      const body = seal({version:1,kind,rows});
      if (body.length > batchLimit) throw storageUnavailable();
      await request(objectUrl(name),'PUT',body);
    },
    async restore(store) {
      const keys = await list();
      const batches=[];
      for (let i=0;i<keys.length;i+=8) {
        const entries=await Promise.all(keys.slice(i,i+8).map(async name=>open(Buffer.from(await (await request(objectUrl(name),'GET')).arrayBuffer()))));
        batches.push(...entries);
      }
      const events=[],profiles=[],reports=[];
      for(const entry of batches){
        if(entry.version!==1||!Array.isArray(entry.rows))throw storageUnavailable();
        if(entry.kind==='events')events.push(...entry.rows);
        else if(entry.kind==='profiles')profiles.push(...entry.rows);
        else if(entry.kind==='reports')reports.push(...entry.rows);
        else throw storageUnavailable();
      }
      events.sort((a,b)=>a.ts-b.ts);
      profiles.sort((a,b)=>a.updatedAt-b.updatedAt);
      store.insertEvents(events);
      store.insertProfiles(profiles);
      store.insertRecoveredReports(reports);
      return {events:events.length,profiles:profiles.length};
    },
  };
}
