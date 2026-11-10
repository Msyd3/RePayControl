const endpoint = import.meta.env.VITE_CONTROL_ORIGIN;
if (endpoint) {
  const base = import.meta.env.BASE_URL;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'control-consent.css'; document.head.appendChild(css);
  const sdk = document.createElement('script'); sdk.src = base + 'repay-control.js'; sdk.dataset.project = 'business'; sdk.dataset.endpoint = endpoint;
  sdk.dataset.gaId = import.meta.env.VITE_GA4_MEASUREMENT_ID || 'G-0HYVR4PYX4';
  sdk.onload = () => { const consent = document.createElement('script'); consent.src = base + 'control-consent.js'; document.head.appendChild(consent); };
  document.head.appendChild(sdk);
}
export {};
