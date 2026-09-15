const token = new URLSearchParams(location.search).get('token');
const link = document.querySelector('#download-link');
const status = document.querySelector('#download-status');
if (token) {
  link.href = '/api/download?token=' + encodeURIComponent(token);
  link.hidden = false;
  status.textContent = 'Your download should start automatically. Save your copy below.';
  link.click();
} else {
  status.textContent = 'Request your plan from the home page to get download access.';
}
