import { taroutStorage } from './tarout-storage.mjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const prefix = 'control-journal/';
const batchLimit = 128 * 1024;
const listLimit = 1000;
const snapshotLimit = 2 * 1024 * 1024;
export const storageUnavailable = () => Object.assign(new Error('تعذر حفظ البيانات؛ أعد المحاولة لاحقًا'), {status:503});

export function taroutJournal(env, fetcher = fetch) {
  const { SESSION_SECRET } = env;
  const storage = taroutStorage(env, fetcher);
  if (!storage && !env.TAROUT_BUCKET_ID && !env.TAROUT_ACCESS_KEY && !env.TAROUT_SECRET_KEY && !env.STORAGE_BUCKET) return null;
  if (!storage || (SESSION_SECRET || '').length < 32) {
    throw new Error('Configure Tarout storage and the stable session secret');
  }
  const { bucket } = storage;
  const key = createHash('sha256').update('RePayControl Tarout journal v1\0' + SESSION_SECRET).digest();

  async function request(url, method, body, allowMissing=false) {
    const response = await storage.request(url, {
      method, headers:body ? {'Content-Type':'application/octet-stream'} : {}, body,
      redirect:'error', cache:'no-store', signal:AbortSignal.timeout(15000),
    });
    if (!response.ok && !(allowMissing && response.status===404)) throw storageUnavailable();
    return response;
  }

  function seal(entry) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(gzipSync(JSON.stringify(entry))),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
  }

  function open(data, limit=batchLimit) {
    if (data.length < 28 || data.length > limit) throw storageUnavailable();
    const decipher = createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    const plain = gunzipSync(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]),{maxOutputLength:limit*8});
    return JSON.parse(plain);
  }

  async function list(stem = '',namespace=prefix) {
    const url = new URL(bucket);
    url.searchParams.set('prefix',namespace+stem);
    const response = await request(url,'GET');
    const xml = await response.text();
    if (!xml.includes('ListBucketResult')) throw storageUnavailable();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match=>match[1]).filter(name=>name.startsWith(namespace)&&/^[0-9a-f]{32}\.bin$/.test(name.slice(namespace.length)));
    // Tarout caps lists at 1000. Split the namespace into smaller prefixes
    // whenever the response reaches the cap, so history isn't truncated.
    if (keys.length < listLimit && !/<IsTruncated>true<\/IsTruncated>/.test(xml)) return keys;
    if (stem.length >= 32) throw storageUnavailable();
    const children=[];
    for(const digit of '0123456789abcdef')children.push(...await list(stem+digit,namespace));
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
    async readSnapshot(kind) {
      const response=await request(objectUrl('control-'+kind+'/latest.bin'),'GET',undefined,true);
      if(response.status===404)return null;
      const saved=open(Buffer.from(await response.arrayBuffer()),snapshotLimit);
      if(saved.version!==1||saved.snapshot?.state!=='connected')throw storageUnavailable();
      return saved.snapshot;
    },
    async saveSnapshot(kind,snapshot) {
      const body=seal({version:1,snapshot});
      if(body.length>snapshotLimit)throw storageUnavailable();
      await request(objectUrl('control-'+kind+'/latest.bin'),'PUT',body);
    },
    async phoneAvatar(phoneKey,defaultId) {
      const url=objectUrl('control-phone-avatars/'+phoneKey+'.bin');
      const response=await request(url,'GET',undefined,true);
      if(response.status!==404){
        const saved=open(Buffer.from(await response.arrayBuffer()));
        if(saved.version!==1||!/^remoji-(0[1-9]|10)$/.test(saved.avatarId))throw storageUnavailable();
        return saved.avatarId;
      }
      await request(url,'PUT',seal({version:1,avatarId:defaultId}));
      return defaultId;
    },
    async appendAvatar(change) {
      const name='control-avatars/'+randomBytes(16).toString('hex')+'.bin';
      await request(objectUrl(name),'PUT',seal(change));
    },
    async restore(store) {
      const [keys,avatarKeys] = await Promise.all([list(),list('','control-avatars/')]);
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
      for(let i=0;i<avatarKeys.length;i+=8){
        const rows=await Promise.all(avatarKeys.slice(i,i+8).map(async name=>
          open(Buffer.from(await (await request(objectUrl(name),'GET')).arrayBuffer()))));
        store.insertAvatars(rows);
      }
      return {events:events.length,profiles:profiles.length};
    },
  };
}
