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
const viewerUrls = new Set();
let pageObserver;
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
  $('room-layout').classList.add('control-layout');
  const isViewer = ['viewer', 'team'].includes(session.role);
  $('room-admin-nav').hidden = !db.admin && !isViewer;
  $('open-invites').hidden = !db.admin;
  $('room-sidebar').hidden = false;
  nda.hidden = true;
  app.hidden = false;
  show(null);

}

function menu(kind, item) {
  const details = document.createElement('details');
  details.className = 'file-menu';
  const trigger = document.createElement('summary');
  const dots = document.createElement('span');
  dots.className = 'file-menu-dots';
  dots.setAttribute('aria-hidden', 'true');
  trigger.append(dots);
  trigger.setAttribute('aria-label', 'خيارات ' + item.name);
  const actions = document.createElement('div');
  actions.className = 'file-menu-actions';
  {
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'تعديل الاسم';
    rename.onclick = () => {
      details.open = false;
      openFolderDialog(item, kind);
    };
    actions.append(rename);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'حذف';
  remove.onclick = async () => {
    const message = kind === 'folder'
      ? 'حذف «' + item.name + '» والمجلدات والملفات اللي بداخله؟'
      : 'حذف «' + item.name + '»؟';
    details.open = false;
    if (await window.confirmControlAction(message)) void change(() => api('delete', {kind, id: item.id}));
  };
  if (item.id !== 'private-nda') actions.append(remove);
  details.append(trigger, actions);
  return details;
}

function folderCard(folder) {
  const card = document.createElement('div');
  card.className = 'room-folder-card';
  card.dataset.folderId = folder.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'room-folder';
  if (folder.parent === null) {
    const number = document.createElement('span');
    number.className = 'folder-number';
    number.dir = 'ltr';
    number.textContent = String(folder.number);
    button.append(number);
  }
  const label = document.createElement('span');
  label.className = 'folder-label';
  label.dir = 'auto';
  label.title = folder.name;
  label.textContent = folder.name;
  button.append(label);
  if (folder.englishName) {
    card.classList.add('room-bilingual-card');
    label.lang = 'ar';
    const english = document.createElement('span');
    english.className = 'folder-english-label';
    english.dir = 'ltr';
    english.lang = 'en';
    english.textContent = folder.englishName;
    button.append(english);
  }
  button.onclick = () => show(folder.id);
  card.append(button);
  if (db.admin) card.append(menu('folder', folder));
  return card;
}

async function preview(file, target, active) {
  const response = await request('preview?id=' + encodeURIComponent(file.id));
  const type = response.headers.get('content-type') || '';
  if (type.startsWith('application/json')) {
    const {pages, acceptance} = await response.json();
    if (!active()) return;
    if (acceptance) {
      const record = document.createElement('section');
      record.className = 'viewer-acceptance';
      const heading = document.createElement('h3');
      heading.textContent = 'تم توقيع اتفاقية عدم الإفصاح';
      const method = document.createElement('p');
      method.textContent = 'موافقة إلكترونية';
      const fields = document.createElement('dl');
      const formatTime = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium', timeZone: 'Asia/Riyadh',
      });
      for (const [label, value] of [
        ['الاسم', acceptance.name],
        ['البريد الإلكتروني', acceptance.email],
        ['تاريخ الموافقة', formatTime.format(new Date(acceptance.acceptedAt))],
      ]) {
        const field = document.createElement('dt');
        const detail = document.createElement('dd');
        field.textContent = label;
        detail.dir = 'auto';
        detail.textContent = value;
        fields.append(field, detail);
      }
      record.append(heading, method, fields);
      $('viewer-title').textContent = 'اتفاقية عدم الإفصاح';
      target.replaceChildren(record);
      return;
    }
    const documentPages = document.createElement('div');
    documentPages.className = 'viewer-pages';
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!active()) return;
        observer.unobserve(entry.target);
        const page = entry.target;
        void (async () => {
          try {
            const imageResponse = await request('preview?id=' + encodeURIComponent(file.id) + '&page=' + page.dataset.number);
            const image = await imageResponse.blob();
            if (!active()) return;
            const url = URL.createObjectURL(image);
            viewerUrls.add(url);
            const picture = document.createElement('img');
            picture.src = url;
            picture.alt = 'صفحة ' + page.dataset.number;
            picture.draggable = false;
            page.replaceChildren(picture);
          } catch (error) {
            if (active()) page.textContent = error.message;
          }
        })();
      }
    }, {root: viewer, rootMargin: '150px'});
    pageObserver = observer;
    for (let i = 1; i <= pages; i++) {
      const page = document.createElement('div');
      page.className = 'viewer-page';
      page.dataset.number = String(i);
      page.textContent = 'جارٍ فتح الصفحة ' + i;
      documentPages.append(page);
      pageObserver.observe(page);
    }
    target.replaceChildren(documentPages);
    return;
  }
  if (type.startsWith('text/plain')) {
    const text = await response.text();
    if (!active()) return;
    const node = document.createElement('pre');
    node.dir = 'auto';
    node.textContent = text;
    target.replaceChildren(node);
    return;
  }
  if (type.startsWith('application/pdf')) throw Error('معاينة هذا الملف غير متاحة حاليًا');
  const blob = await response.blob();
  if (!active()) return;
  const url = URL.createObjectURL(blob);
  viewerUrls.add(url);
  const node = document.createElement('img');
  node.src = url;
  node.alt = file.name;
  node.draggable = false;
  target.replaceChildren(node);
}

function fileCard(file) {
  const card = document.createElement('article');
  card.className = 'room-folder-card room-file-card';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'room-folder';
  const extension = (file.name.match(/\.([^.]+)$/)?.[1] ?? 'FILE').toUpperCase();
  const badge = document.createElement('span');
  badge.className = 'file-type';
  badge.dataset.type = extension;
  badge.textContent = extension.length <= 5 ? extension : 'FILE';
  const name = document.createElement('span');
  name.className = 'folder-label';
  name.dir = 'auto';
  name.title = file.name;
  name.textContent = file.name;
  button.append(badge, name);
  button.onclick = () => openFile(file);
  card.append(button);
  if (db.admin) card.append(menu('file', file));
  return card;
}

function openFile(file) {
  const target = $('viewer-content');
  $('viewer-title').textContent = file.name;
  target.textContent = 'جارٍ فتح الملف';
  viewer.showModal();
  const id = Symbol();
  viewer.previewId = id;
  const active = () => viewer.open && viewer.previewId === id;
  void preview(file, target, active)
    .catch(error => { if (active()) target.textContent = error.message; });
}

viewer.addEventListener('contextmenu', event => event.preventDefault());
viewer.addEventListener('close', () => {
  pageObserver?.disconnect();
  for (const url of viewerUrls) URL.revokeObjectURL(url);
  viewerUrls.clear();
  $('viewer-content').replaceChildren();
});

function show(id) {
  current = id;
  const root = id === null;
  const folders = db.folders.filter(folder => folder.parent === id).sort((a, b) => a.number - b.number);
  $('folder-list').hidden = !root;
  $('folder-detail').hidden = root;
  const tools = $('room-admin-tools');
  $(root ? 'root-folder-tools' : 'folder-toolbar').append(tools);
  tools.hidden = !db.admin;
  $('upload-file').hidden = root;
  $(root ? 'folders' : 'nested-folders').replaceChildren(...folders.map(folderCard));
  $('folder-count').textContent = db.folders.filter(folder => folder.parent === null).length;
  if (root) return;
  $('folder-title').textContent = db.folders.find(folder => folder.id === id).name;
  const files = db.files.filter(file => file.parent === id);
  $('folder-files').replaceChildren(...files.map(fileCard));
  $('folder-files').hidden = files.length === 0;
  $('folder-empty').hidden = files.length > 0 || folders.length > 0;
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

const folderDialog = $('new-folder-dialog');
const folderForm = $('new-folder-form');
let editTarget = null;

function openFolderDialog(item = null, kind = 'folder') {
  if (changing) return;
  editTarget = item ? {item, kind} : null;
  folderForm.reset();
  const label = kind === 'file' ? 'الملف' : 'المجلد';
  $('new-folder-title').textContent = item ? 'تعديل اسم ' + label : 'إضافة مجلد';
  $('new-folder-label').textContent = 'اسم ' + label;
  $('new-folder-name').value = item?.name ?? '';
  $('new-folder-error').textContent = '';
  folderForm.querySelector('button').textContent = item ? 'حفظ الاسم' : 'إضافة المجلد';
  folderDialog.showModal();
}

$('new-folder').onclick = () => openFolderDialog();
folderForm.onsubmit = async event => {
  event.preventDefault();
  if (changing) return;
  const name = $('new-folder-name').value.trim();
  const errorNotice = $('new-folder-error');
  if (!name) {
    errorNotice.textContent = 'اكتب الاسم';
    return;
  }
  const item = editTarget?.item;
  const parent = item ? item.parent : current;
  const submit = folderForm.querySelector('button');
  const status = $('admin-status');
  changing = true;
  submit.disabled = true;
  errorNotice.textContent = '';
  status.textContent = 'جارٍ الحفظ';
  try {
    const folder = item
      ? await api('rename-' + editTarget.kind, {id: item.id, name})
      : await api('folder', {name, parent});
    if (item) Object.assign(item, folder);
    else db.folders.push(folder);
    if (folderDialog.open) folderDialog.close();
    show(parent);
    const grid = $(parent === null ? 'folders' : 'nested-folders');
    const card = [...grid.children].find(element => element.dataset.folderId === folder.id);
    card?.scrollIntoView({block: 'nearest'});
    status.textContent = item ? 'تم تعديل الاسم' : 'تمت إضافة المجلد';
  } catch (error) {
    errorNotice.textContent = error.message;
    status.textContent = error.message;
  } finally {
    changing = false;
    submit.disabled = false;
  }
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
