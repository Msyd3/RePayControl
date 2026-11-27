'use strict';

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
