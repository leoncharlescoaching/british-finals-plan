const form = document.querySelector('#lead-form');
const button = document.querySelector('#submit-button');
const error = document.querySelector('#form-error');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'GETTING YOUR PLAN…';
  try {
    const response = await fetch('/api/subscribe', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: form.email.value.trim(), website: form.website.value}),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok || !data.downloadUrl) throw new Error(data.error || 'We couldn’t get your plan. Please try again.');
    const download = new URL(data.downloadUrl, location.origin);
    if (download.origin !== location.origin || download.pathname !== '/api/download') throw new Error('Please try again.');
    document.querySelector('#download-link').href = download.href;
    document.querySelector('#delivery-message').textContent = data.emailQueued
      ? 'Download it now. Your email copy is on its way—check your junk folder if it doesn’t arrive.'
      : 'Your download is ready below. We couldn’t send an email copy just now, so save your plan here.';
    document.querySelector('#form-state').hidden = true;
    const success = document.querySelector('#success-state');
    success.hidden = false;
    success.focus();
  } catch (err) {
    error.textContent = err.name === 'TimeoutError' || err instanceof TypeError
      ? 'The connection timed out. Please check your connection and try again.' : err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = 'SEND ME THE PLAN <span aria-hidden="true">↗</span>';
  }
});
