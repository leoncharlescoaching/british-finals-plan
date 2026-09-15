const token = new URLSearchParams(location.search).get('token');
const link = document.querySelector('#download-link');
const status = document.querySelector('#download-status');
if (token) {
  fetch('/api/plan?token=' + encodeURIComponent(token), { signal: AbortSignal.timeout(15000) })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error('expired');
      link.href = data.url;
      link.hidden = false;
      status.textContent = 'Your download should start automatically. Save your copy below.';
      link.click();
    })
    .catch(() => {
      location.replace('/?expired=1');
    });
} else {
  status.textContent = 'Request your plan from the home page to get download access.';
}
