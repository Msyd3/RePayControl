'use strict';

function setupControlLogin() {
  const form = document.querySelector('#login-form');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#password');
  const passwordField = document.querySelector('#login-password-field');

  password.addEventListener('input', () => {
    password.value = password.value
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  });

  email.addEventListener('input', () => {
    passwordField.hidden = true;
    password.required = false;
    password.value = '';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const status = document.querySelector('#login-error');
    button.disabled = true;
    status.textContent = '';
    try {
      const origin = window.REPAY_DATAROOM_API_ORIGIN ?? window.REPAY_CONTROL_API_ORIGIN ?? '';
      const response = await fetch(origin + '/api/dataroom/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: email.value.trim(), password: passwordField.hidden ? undefined : password.value}),
      });
      const session = await response.json();
      if (!response.ok) throw Error(session.error || 'تعذر تسجيل الدخول');
      if (session.requiresPassword) {
        passwordField.hidden = false;
        password.required = true;
        password.focus();
        return;
      }
      password.value = '';
      sessionStorage.setItem('repay-control-session', session.token);
      if (session.role === 'dataroom') location.replace('/dataroom/');
      else location.reload();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

if (document.querySelector('#login-form')) setupControlLogin();

window.setupControlInvitations = api => {
  const trigger = document.getElementById('open-invites');
  const template = document.createElement('template');
  template.innerHTML = `<dialog id="room-invites" class="invites-dialog" aria-labelledby="invites-title">
<header><h2 id="invites-title">الدعوات والصلاحيات</h2><form method="dialog"><button class="primary">إغلاق</button></form></header>
<form id="invite-form">
<label>البريد الإلكتروني <input name="email" type="email" dir="ltr" required></label>
<label>الصلاحية <select name="role"><option value="dataroom">البيانات</option><option value="viewer">متصفح</option><option value="admin">مدير</option></select></label>
<label>مدة الوصول <select name="days"><option value="7">7 أيام</option><option value="14">14 يومًا</option><option value="30">30 يومًا</option></select></label>
<button class="primary">إضافة دعوة</button>
</form>
<p id="invite-status" role="status"></p><ul id="invite-list"></ul>
</dialog>`;
  document.body.append(template.content);
  const $ = id => document.getElementById(id);

  const roleLabels = {dataroom: 'البيانات', viewer: 'متصفح', admin: 'مدير'};
  const statusLabels = {Pending: 'بانتظار الدخول', Active: 'سارية', Expired: 'منتهية', Revoked: 'ملغاة'};

  async function openInvites() {
    const dialog = $('room-invites');
    if (!dialog.open) dialog.showModal();
    try {
      const {invites} = await api('invites');
      $('invite-list').replaceChildren(...invites.map(invite => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = [invite.email, roleLabels[invite.role], statusLabels[invite.status]].join(' · ');
        row.append(label);
        if (['Pending', 'Active'].includes(invite.status)) {
          const revoke = document.createElement('button');
          revoke.type = 'button';
          revoke.textContent = 'إلغاء الوصول';
          revoke.onclick = async () => {
            if (!confirm('إلغاء وصول ' + invite.email + '؟')) return;
            try { await api('revoke', {email: invite.email}); await openInvites(); }
            catch (error) { $('invite-status').textContent = error.message; }
          };
          row.append(revoke);
        }
        return row;
      }));
    } catch (error) {
      $('invite-status').textContent = error.message;
    }
  }

  $('invite-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('invite', Object.fromEntries(new FormData(form)));
      form.reset();
      $('invite-status').textContent = 'تم حفظ الدعوة';
      await openInvites();
    } catch (error) {
      $('invite-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };

  trigger.addEventListener('click', openInvites);
};


window.applyControlPermissions = role => {
  for (const item of document.querySelectorAll('.control-sidebar [data-roles]')) {
    const enabled = item.dataset.roles.split(' ').includes(role);
    item.setAttribute('aria-disabled', String(!enabled));
    if (item instanceof HTMLButtonElement) item.disabled = !enabled;
    else if (!enabled) item.removeAttribute('href');
  }
};
