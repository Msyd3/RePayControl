import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const input=process.env.CONTROL_API_ORIGIN;
const frontendOnly=process.argv.includes('--frontend-only');
if(!input&&!frontendOnly)throw Error('CONTROL_API_ORIGIN is required. GitHub Pages needs a separately deployed RePayControl API.');
const url=input?new URL(input):null;if(url&&(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'))throw Error('Use the verified HTTPS API origin without a path.');
if(url&&url.hostname==='control.repay.sa')throw Error('The GitHub Pages hostname cannot also be the Node API origin.');
await mkdir('dist-pages',{recursive:true});await cp('public','dist-pages',{recursive:true});
let html=await readFile('public/index.html','utf8');html=html.replace(/(src|href)="\//g,'$1="./');
const css=(await readFile('public/styles.css','utf8')).replaceAll("url('/","url('./");await writeFile('dist-pages/styles.css',css);
await writeFile('dist-pages/runtime-config.js',`window.REPAY_CONTROL_API_ORIGIN=${JSON.stringify(url?.origin||'')};\nwindow.REPAY_CONTROL_FRONTEND_ONLY=${!url};\n`);
for(const file of ['dashboard.js','export-pdf.js','runtime-config.js','styles.css']){
  const content=await readFile('dist-pages/'+file);
  const version=createHash('sha256').update(content).digest('hex').slice(0,12);
  html=html.replace(`"./${file}"`,`"./${file}?v=${version}"`);
}
await writeFile('dist-pages/index.html',html);
await writeFile('dist-pages/.nojekyll','');await writeFile('dist-pages/CNAME','control.repay.sa\n');
console.log(url?'Built Pages frontend with external API.':'Built Pages frontend only; login and data wait for an API.');
