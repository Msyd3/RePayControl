import aws4 from 'aws4';

export function taroutStorage(env, fetcher = fetch) {
  const { TAROUT_BUCKET_ID, TAROUT_ACCESS_KEY, TAROUT_SECRET_KEY } = env;
  if (/^[a-z0-9-]{12,80}$/.test(TAROUT_BUCKET_ID || '') && TAROUT_ACCESS_KEY && TAROUT_SECRET_KEY) {
    return {
      bucket: new URL('/api/storage/gateway/' + TAROUT_BUCKET_ID, 'https://tarout.sa'),
      request(url, options) {
        const headers = { ...options.headers, Authorization: 'Bearer ' + TAROUT_ACCESS_KEY + ':' + TAROUT_SECRET_KEY };
        return fetcher(url, { ...options, headers });
      },
    };
  }

  const { STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY } = env;
  if (!STORAGE_ENDPOINT || !STORAGE_BUCKET || !STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY) return null;

  const bucket = new URL(STORAGE_ENDPOINT);
  bucket.pathname = bucket.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(STORAGE_BUCKET);
  return {
    bucket,
    request(url, options) {
      const signed = aws4.sign({
        host: url.host,
        path: url.pathname + url.search,
        method: options.method,
        service: 's3',
        region: env.STORAGE_REGION || 'auto',
        headers: { ...options.headers },
        body: options.body,
      }, { accessKeyId: STORAGE_ACCESS_KEY_ID, secretAccessKey: STORAGE_SECRET_ACCESS_KEY });
      return fetcher(url, { ...options, headers: signed.headers });
    },
  };
}
