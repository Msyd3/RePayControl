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
<header><h2 id="invites-title">الدعوات والصلاحيات</h2><form method="dialog"><button class="invite-close" aria-label="إغلاق">×</button></form></header>
<form id="invite-form">
<label>البريد الإلكتروني <input name="email" type="email" dir="ltr" required></label>
<label>الصلاحية <select name="role"><option value="dataroom">البيانات</option><option value="viewer">متصفح</option><option value="admin">مدير</option></select></label>
<label>مدة الوصول <select name="days"><option value="7">7 أيام</option><option value="14">14 يومًا</option><option value="30">30 يومًا</option></select></label>
<button class="invite-submit">إضافة دعوة</button>
</form>
<p id="invite-status" role="status"></p><h3 class="invite-list-title">الدعوات</h3><ul id="invite-list"></ul>
</dialog>`;
  document.body.append(template.content);
  const $ = id => document.getElementById(id);

  const roleLabels = {dataroom: 'البيانات', viewer: 'متصفح', admin: 'مدير'};
  const expiryFormat = new Intl.DateTimeFormat('en-GB', {numberingSystem: 'latn', timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric'});
  const defaultMessage = 'مرحبًا،\n\nتمت دعوتك إلى منصة ري باي. افتح الرابط وسجّل دخولك بالبريد الإلكتروني نفسه:\nhttps://control.repay.sa/\n\nفريق ري باي';
  const statusLabels = {Invited: 'دعوة', Pending: 'انتظار', Accepted: 'قبول', Active: 'قبول', Expired: 'منتهية', Revoked: 'ملغاة'};

  async function openInvites() {
    const dialog = $('room-invites');
    if (!dialog.open) dialog.showModal();
    try {
      const {invites} = await api('invites');
      const rows = invites.map(invite => {
        const row = document.createElement('li');
        const identity = document.createElement('div');
        identity.className = 'invite-identity';
        const email = document.createElement('bdi');
        email.textContent = invite.email;
        const status = document.createElement('span');
        status.className = 'invite-badge';
        status.dataset.status = invite.status;
        status.textContent = statusLabels[invite.status] ?? invite.status;
        identity.append(email, status);
        const expiry = new Date(invite.expiresAt);
        if (Number.isFinite(expiry.getTime())) {
          const expiryLabel = document.createElement('span');
          expiryLabel.className = 'invite-expiry';
          expiryLabel.textContent = 'ينتهي ' + expiryFormat.format(expiry);
          identity.append(expiryLabel);
        }
        const heading = document.createElement('div');
        heading.className = 'invite-row-heading';
        heading.append(identity);
        row.append(heading);

        if (invite.editable === false || ['Expired', 'Revoked'].includes(invite.status)) {
          const role = document.createElement('span');
          role.textContent = roleLabels[invite.role];
          heading.append(role);
          return row;
        }

        const actions = document.createElement('div');
        actions.className = 'invite-actions';
        actions.hidden = true;
        const menu = document.createElement('details');
        menu.className = 'invite-menu';
        const summary = document.createElement('summary');
        summary.setAttribute('aria-label', 'خيارات ' + invite.email);
        summary.textContent = '⋯';
        const choices = document.createElement('div');
        choices.className = 'invite-menu-items';
        menu.append(summary, choices);
        heading.append(menu);
        menu.addEventListener('toggle', () => {
          if (menu.open) row.parentElement?.querySelectorAll('.invite-menu[open]').forEach(other => {
            if (other !== menu) other.open = false;
          });
        });
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'صلاحية ' + invite.email);
        for (const [value, label] of Object.entries(roleLabels)) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = value === invite.role;
          select.append(option);
        }
        const duration = document.createElement('select');
        duration.setAttribute('aria-label', 'مدة دعوة ' + invite.email);
        for (const [value, label] of [['', 'تعديل المدة'], ['7', '7 أيام من اليوم'], ['14', '14 يومًا من اليوم'], ['30', '30 يومًا من اليوم']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          duration.append(option);
        }
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'حفظ';
        const hasAccessChanges = () => select.value !== invite.role || Boolean(duration.value);
        const updateSave = () => { save.disabled = !hasAccessChanges(); };
        updateSave();
        select.onchange = duration.onchange = updateSave;
        save.onclick = async () => {
          save.disabled = true;
          select.disabled = duration.disabled = true;
          try {
            await api('edit-invite', {email: invite.email, role: select.value, days: duration.value || undefined});
            $('invite-status').textContent = 'تم تحديث الدعوة';
            await openInvites();
          } catch (error) { $('invite-status').textContent = error.message; }
          finally { select.disabled = duration.disabled = false; updateSave(); }
        };
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.textContent = 'حذف';
        revoke.onclick = async () => {
          menu.open = false;
          if (!confirm('حذف صلاحية ' + invite.email + ' وإيقاف وصوله فورًا؟')) return;
          try { await api('revoke', {email: invite.email}); await openInvites(); }
          catch (error) { $('invite-status').textContent = error.message; }
        };
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = 'تعديل';
        edit.onclick = () => {
          menu.open = false;
          actions.hidden = false;
          select.focus();
        };
        const send = document.createElement('a');
        send.className = 'invite-email-link';
        send.textContent = 'إرسال';
        const recipient = encodeURIComponent(invite.email).replace('%40', '@');
        const subject = encodeURIComponent('دعوة إلى ري باي');
        send.href = 'mailto:' + recipient + '?subject=' + subject + '&body=' + encodeURIComponent(defaultMessage);
        send.onclick = () => { menu.open = false; };
        choices.append(edit, revoke, send);
        actions.append(select, duration, save);
        row.append(actions);
        return row;
      });
      if (!rows.length) {
        const empty = document.createElement('li');
        empty.textContent = 'ما فيه دعوات حتى الآن';
        rows.push(empty);
      }
      $('invite-list').replaceChildren(...rows);
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


const sidebarToggle = document.querySelector('.sidebar-toggle');
if (sidebarToggle) {
  const sidebar = sidebarToggle.closest('.control-sidebar');
  const menuIsOpen = () => sidebarToggle.getAttribute('aria-expanded') === 'true';
  const setMenuOpen = open => sidebarToggle.setAttribute('aria-expanded', String(open));
  sidebarToggle.addEventListener('click', () => setMenuOpen(!menuIsOpen()));
  document.addEventListener('click', event => {
    if (menuIsOpen() && !sidebar.contains(event.target)) setMenuOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menuIsOpen() || document.querySelector('dialog[open]')) return;
    setMenuOpen(false);
    sidebarToggle.focus();
  });
  matchMedia('(max-width: 760px)').addEventListener('change', () => setMenuOpen(false));
}
