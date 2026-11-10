import { readFile, writeFile, mkdir, readdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(own,'..');
const args=process.argv.slice(2),kind=args[0],repo=path.resolve(args[1]||'.'),originArg=args.find(x=>x.startsWith('--origin=')),apply=args.includes('--apply');
if(!['wallet','business','poc'].includes(kind)||!args[1])throw new Error('Usage: node integrations/install.mjs wallet|business|poc /path/to/repo --origin=https://control.example.com [--apply]');
const origin=originArg?new URL(originArg.slice(9)):null;
const gaId=(args.find(x=>x.startsWith('--ga-id='))||'--ga-id=G-0HYVR4PYX4').slice(8);
if(gaId&&!/^G-[A-Z0-9]{6,20}$/.test(gaId))throw new Error('Invalid GA4 measurement ID');
if(!origin||origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')throw new Error('Pass --origin=https://YOUR_CONTROL_HOST with no path or credentials');
const changes=new Map();
async function set(file,body){changes.set(file,body);}
async function copy(source,dest){changes.set(dest,await readFile(source));}
async function replace(file,before,after){let content=changes.has(file)?String(changes.get(file)):await readFile(path.join(repo,file),'utf8');if(content.includes(after))return;if(!content.includes(before))throw new Error('Source changed; review before patching: '+file);changes.set(file,content.replace(before,after));}
async function browserAssets(base){await copy(path.join(root,'public/repay-control.js'),base+'/repay-control.js');await copy(path.join(own,'consent.js'),base+'/control-consent.js');await copy(path.join(own,'consent.css'),base+'/control-consent.css');}
if(kind==='wallet'){
  await access(path.join(repo,'public/js/config.js'));await browserAssets('public/js');
  await set('public/js/control-config.js',`window.REPAY_CONTROL_CONFIG = Object.freeze(${JSON.stringify({project:'wallet',endpoint:origin.origin,gaMeasurementId:gaId})});\n`);
  const tags='  <link rel="stylesheet" href="js/control-consent.css">\n  <script src="js/control-config.js" defer></script>\n  <script src="js/repay-control.js" defer></script>\n  <script src="js/control-consent.js" defer></script>\n';
  for(const file of await readdir(path.join(repo,'public'))){if(!file.endsWith('.html'))continue;const name='public/'+file,text=await readFile(path.join(repo,name),'utf8');if(!text.includes('js/repay-control.js'))await set(name,text.replace('</head>',tags+'</head>'));}
  await replace('public/_headers',"connect-src 'self';",`connect-src 'self' ${origin.origin};`);
  if(gaId){await replace('public/_headers',"script-src 'self';","script-src 'self' https://www.googletagmanager.com;");await replace('public/_headers',`connect-src 'self' ${origin.origin};`,`connect-src 'self' ${origin.origin} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com;`);await replace('public/_headers',"img-src 'self' data:;","img-src 'self' data: https://*.google-analytics.com;");}
}else if(kind==='business'){
  const client='artifacts/repay-business',server='artifacts/api-server';await browserAssets(client+'/public');
  await copy(path.join(own,'business-control.ts'),client+'/src/control.ts');await copy(path.join(own,'business-server-control.ts'),server+'/src/lib/control.ts');
  await replace(client+'/src/main.tsx',"import './index.css';","import './index.css';\nimport './control';");
  await replace(server+'/src/routes/leads.ts','const router: IRouter = Router();','import { recordLeadCreated } from "../lib/control";\n\nconst router: IRouter = Router();');
  await replace(server+'/src/routes/leads.ts','await appendContactLead(lead);','await appendContactLead(lead);\n    await recordLeadCreated(req);');
  await set(client+'/.env.control.example',`VITE_CONTROL_ORIGIN=${origin.origin}\nVITE_GA4_MEASUREMENT_ID=${gaId}\n`);
  await set(server+'/.env.control.example',`REPAY_CONTROL_ORIGIN=${origin.origin}\nREPAY_CONTROL_SERVER_KEY=\n`);
}else{
  await copy(path.join(own,'RePayControlClient.cs'),'Infrastructure/Analytics/RePayControlClient.cs');
  await replace('Program.cs','builder.Services.AddSingleton<ConversationStore>();','builder.Services.AddSingleton<ConversationStore>();\nbuilder.Services.AddHttpClient<RePayControlClient>();');
  await replace('Endpoints/WebhookInboxWorker.cs','await orchestrator.HandleAsync(item.Payload, stoppingToken);','await orchestrator.HandleAsync(item.Payload, stoppingToken);\n                await scope.ServiceProvider.GetRequiredService<RePayControlClient>().ObserveWebhookAsync(item.Payload, stoppingToken);');
  await set('.env.control.example',`RePayControl__Origin=${origin.origin}\nRePayControl__ServerKey=\n`);
}
console.log((apply?'Applying':'Dry run:')+' '+changes.size+' files in '+repo);
for(const [file,body] of changes){console.log('  '+file);if(apply){await mkdir(path.dirname(path.join(repo,file)),{recursive:true});await writeFile(path.join(repo,file),body);}}
if(!apply)console.log('Review the list, then repeat with --apply. Use a separate branch and inspect the diff.');
else console.log('Installed. Configure environment variables and run the original project checks before publishing.');
