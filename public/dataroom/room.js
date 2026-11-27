'use strict';
const names=['Registration','Business Info','Legal','Branding','Financial Data','Market','Product & Technology','PI','Partnerships','Marketing','HR','Legal','KPIs','Cap Table'];
const $=id=>document.getElementById(id);
const login=$('room-login'),app=$('room-app'),list=$('folder-list'),detail=$('folder-detail');
function label(name,i){return String(i+1).padStart(2,'0')+' — '+name;}
function showList(){detail.hidden=true;list.hidden=false;app.classList.remove('room-detail-mode');$('folders').querySelector('button')?.focus();}
function render(){const grid=$('folders');grid.replaceChildren();let count=0;names.forEach((name,i)=>{const title=label(name,i);count++;const b=document.createElement('button');b.type='button';b.className='room-folder';const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(ns,'path');p.setAttribute('fill','currentColor');p.setAttribute('d','M3 4h6l2 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z');svg.append(p);const t=document.createElement('span');t.dir='ltr';t.textContent=name;b.append(svg,t);b.setAttribute('aria-label',title);const item=document.createElement('div');item.className='room-grid-item';const number=document.createElement('span');number.className='room-folder-number';number.textContent=String(i+1).padStart(2,'0');item.append(number,b);b.addEventListener('click',()=>{list.hidden=true;detail.hidden=false;app.classList.add('room-detail-mode');$('folder-title').textContent=title;$('folder-back').focus();});grid.append(item);});$('folder-count').textContent=count;}
// Fail closed until the actual approved agreement is provided.
const agreement = null;
const nda=$('room-nda'), agree=$('nda-agree'), next=$('nda-continue');
let pendingEmail='';
function resetAccess(){pendingEmail='';app.hidden=true;nda.hidden=true;login.hidden=false;$('room-email').textContent='';$('room-name').textContent='';$('email').value='';$('nda-name').value='';$('nda-email').value='';agree.checked=false;agree.disabled=!agreement;next.disabled=true;$('email').focus();}
function updateNda(){next.disabled=!agreement||!pendingEmail||!$('nda-name').value.trim()||!agree.checked;}
$('room-form').addEventListener('submit',e=>{e.preventDefault();if(!$('email').checkValidity())return;pendingEmail=$('email').value.trim();$('nda-email').value=pendingEmail;login.hidden=true;app.hidden=true;nda.hidden=false;agree.disabled=!agreement;updateNda();$('nda-name').focus();});
$('nda-name').addEventListener('input',updateNda);agree.addEventListener('change',updateNda);
$('nda-form').addEventListener('submit',e=>{e.preventDefault();if(!agreement||!pendingEmail||!agree.checked||!$('nda-name').value.trim()||!e.target.checkValidity())return;$('room-email').textContent=pendingEmail;$('room-name').textContent=$('nda-name').value.trim();nda.hidden=true;app.hidden=false;render();showList();});
$('nda-decline').addEventListener('click',resetAccess);$('room-logout').addEventListener('click',resetAccess);
$('folder-back').addEventListener('click',showList);