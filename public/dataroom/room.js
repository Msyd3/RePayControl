'use strict';

const $ = id => document.getElementById(id);
const origin = window.REPAY_DATAROOM_API_ORIGIN ?? window.REPAY_CONTROL_API_ORIGIN ?? '';
const sessionKey = 'repay-control-session';
const token = sessionStorage.getItem(sessionKey);
const app = $('room-app');
const nda = $('room-nda');
const viewer = $('file-viewer');
let session;
let current = null;
let db;
let previews = [];
let viewerUrl;
let renderId = 0;
let changing = false;

async function request(route, data) {
  const response = await fetch(origin + '/api/dataroom/' + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(data === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
  });
  if (response.status === 401) {
    sessionStorage.removeItem(sessionKey);
    location.replace('/');
  }
  if (!response.ok) {
    const {error} = await response.json().catch(() => ({}));
    throw Error(error || 'تعذر الاتصال');
  }
  return response;
}

async function api(route, data) {
  return (await request(route, data)).json();
}

async function logout() {
  try { await api('logout', {}); }
  finally {
    sessionStorage.removeItem(sessionKey);
    location.replace('/');
  }
}

$('room-logout').onclick = logout;
$('sidebar-logout').onclick = logout;
window.setupControlInvitations(api);
$('nda-decline').onclick = logout;
$('nda-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('nda-continue');
  button.disabled = true;
  try {
    const result = await api('accept', {name: $('nda-name').value.trim(), agree: true, version: 'NDA-v1'});
    session.name = result.name;
    await openRoom();
  } catch (error) {
    $('nda-status').textContent = error.message;
    updateConsent();
  }
};

function updateConsent() {
  $('nda-continue').disabled = !$('nda-agree').checked || !$('nda-name').value.trim();
}

$('nda-agree').onchange = updateConsent;
$('nda-name').oninput = updateConsent;

async function openRoom() {
  db = await api('list');
  $('room-email').textContent = session.email;
  $('room-name').textContent = session.name;
  $('room-layout').classList.toggle('control-layout', db.admin);
  $('room-sidebar').hidden = !db.admin;
  $('room-header').hidden = db.admin;
  nda.hidden = true;
  app.hidden = false;
  show(null);

}

function menu(kind, item) {
  const details = document.createElement('details');
  details.className = 'file-menu';
  const trigger = document.createElement('summary');
  trigger.textContent = '⋮';
  trigger.setAttribute('aria-label', 'خيارات ' + item.name);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'حذف';
  remove.onclick = () => {
    const message = kind === 'folder'
      ? 'حذف «' + item.name + '» والمجلدات والملفات اللي بداخله؟'
      : 'حذف «' + item.name + '»؟';
    details.open = false;
    if (confirm(message)) void change(() => api('delete', {kind, id: item.id}));
  };
  details.append(trigger, remove);
  return details;
}

function folderCard(folder) {
  const card = document.createElement('div');
  card.className = 'room-folder-card';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'room-folder';
  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.dir = 'auto';
  label.textContent = folder.name;
  button.append(icon, label);
  button.onclick = () => show(folder.id);
  card.append(button);
  if (db.admin && folder.id !== 'private-nda') card.append(menu('folder', folder));
  return card;
}

async function preview(file, target, thumbnail, active) {
  const response = await request('preview?id=' + encodeURIComponent(file.id));
  const type = response.headers.get('content-type') || '';
  if (type.startsWith('text/plain')) {
    const text = await response.text();
    if (!active()) return;
    const node = document.createElement('pre');
    node.dir = 'auto';
    node.textContent = thumbnail ? text.slice(0, 1400) : text;
    target.replaceChildren(node);
    return;
  }
  const blob = await response.blob();
  if (!active()) return;
  const url = URL.createObjectURL(blob);
  if (thumbnail) previews.push(url);
  else viewerUrl = url;
  const isPdf = type.startsWith('application/pdf');
  const node = document.createElement(isPdf ? 'iframe' : 'img');
  node.src = url + (isPdf ? '#toolbar=0&navpanes=0&scrollbar=0&view=FitH' : '');
  if (isPdf) node.title = file.name;
  else node.alt = file.name;
  target.replaceChildren(node);
}

function fileCard(file, version) {
  const card = document.createElement('article');
  card.className = 'room-file-card';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'room-file-open';
  const title = document.createElement('span');
  title.className = 'room-file-title';
  const extension = file.name.split('.').at(-1).toUpperCase();
  const badge = document.createElement('span');
  badge.className = 'file-type';
  badge.dataset.type = extension;
  badge.textContent = extension.length <= 5 ? extension : 'FILE';
  const name = document.createElement('span');
  name.dir = 'auto';
  name.textContent = file.name;
  title.append(badge, name);
  const picture = document.createElement('div');
  picture.className = 'room-file-picture';
  picture.textContent = 'معاينة الملف';
  button.append(title, picture);
  button.onclick = () => openFile(file);
  card.append(button);
  if (db.admin) card.append(menu('file', file));
  observer.observe(picture);
  picture.loadPreview = () => preview(file, picture, true, () => renderId === version)
    .catch(() => { picture.textContent = 'المعاينة غير متاحة'; });
  return card;
}

const observer = new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) {
    if (!isIntersecting) continue;
    observer.unobserve(target);
    void target.loadPreview();
  }
});

function openFile(file) {
  const target = $('viewer-content');
  $('viewer-title').textContent = file.name;
  target.textContent = 'جارٍ فتح الملف';
  viewer.showModal();
  const id = Symbol();
  viewer.previewId = id;
  const active = () => viewer.open && viewer.previewId === id;
  void preview(file, target, false, active)
    .catch(error => { if (active()) target.textContent = error.message; });
}

viewer.addEventListener('close', () => {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
  $('viewer-content').replaceChildren();
});

function show(id) {
  current = id;
  renderId += 1;
  observer.disconnect();
  previews.forEach(url => URL.revokeObjectURL(url));
  previews = [];
  const root = id === null;
  const folders = db.folders.filter(folder => folder.parent === id);
  $('folder-list').hidden = !root;
  $('folder-detail').hidden = root;
  $('room-admin-tools').hidden = !db.admin;
  $('upload-file').hidden = root;
  $(root ? 'folders' : 'nested-folders').replaceChildren(...folders.map(folderCard));
  $('folder-count').textContent = db.folders.filter(folder => folder.parent === null).length;
  if (root) return;
  $('folder-title').textContent = db.folders.find(folder => folder.id === id).name;
  const files = db.files.filter(file => file.parent === id);
  $('folder-files').replaceChildren(...files.map(file => fileCard(file, renderId)));
  if (!files.length && !folders.length) {
    const empty = document.createElement('p');
    empty.className = 'room-empty';
    empty.textContent = 'المجلد فارغ';
    $('folder-files').append(empty);
  }
}

$('folder-back').onclick = () => show(db.folders.find(folder => folder.id === current)?.parent ?? null);

async function change(action) {
  if (changing) return;
  changing = true;
  const status = $('admin-status');
  status.textContent = 'جارٍ الحفظ';
  try {
    const result = await action();
    db = await api('list');
    show(current === null || db.folders.some(folder => folder.id === current) ? current : null);
    status.textContent = result.pending ? 'أزيل الملف من الداتا روم، وحذفه من المخزن قيد المتابعة' : 'تم الحفظ';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    changing = false;
  }
}

$('new-folder').onclick = () => {
  const name = prompt('اسم المجلد')?.trim();
  if (name) void change(() => api('folder', {name, parent: current}));
};
$('upload-file').onclick = () => $('file-input').click();
$('file-input').onchange = event => {
  const file = event.target.files[0];
  const parent = current;
  event.target.value = '';
  if (!file || !parent) return;
  if (file.size > 10 * 1024 * 1024) {
    $('admin-status').textContent = 'الحد الأقصى 10 MB';
    return;
  }
  void change(async () => {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return api('upload', {name: file.name, parent, data});
  });
};

(async () => {
  if (!token) { location.replace('/'); return; }
  try {
    session = await api('session');
    if (session.role === 'viewer') { location.replace('/'); return; }
    if (session.needsNda) {
      $('nda-email').value = session.email;
      nda.hidden = false;
      $('nda-name').focus();
    } else {
      await openRoom();
    }
  } catch (error) {
    $('room-error').hidden = false;
    $('room-error').textContent = error.message;
  }
})();
