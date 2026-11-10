import { readFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { importLeadSnapshot } from './leads.mjs';
import path from 'node:path';
const dir=process.env.DATA_DIR||'data';const store=new Store(path.join(dir,'control.sqlite'),process.env.SESSION_SECRET);
try{const count=importLeadSnapshot(store,JSON.parse(readFileSync(path.join(dir,'leads-snapshot.json'),'utf8')));console.log('Imported masked lead records:',count);}finally{store.close();}
