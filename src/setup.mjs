import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.env'))throw new Error('.env already exists. Edit it locally; existing secrets were preserved.');
let text=readFileSync('.env.example','utf8');
for(const name of ['ADMIN_PASSWORD','SESSION_SECRET','SERVER_INGEST_KEY'])text=text.replace(name+'=\n',name+'='+randomBytes(32).toString('base64url')+'\n');
text=text.replace('NODE_ENV=production','NODE_ENV=development');
writeFileSync('.env',text,{mode:0o600});
console.log('Created private .env for local use. Read ADMIN_PASSWORD locally to sign in. Set NODE_ENV=production and HTTPS on your host. Keep this file out of source control.');
