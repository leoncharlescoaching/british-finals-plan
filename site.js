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
      body: JSON.stringify({first_name: form.first_name.value.trim(), email: form.email.value.trim(), website: form.website.value, marketingConsent: form.marketingConsent?.checked === true, consentVersion: "2026-09-16-v1"}),
      signal: AbortSignal.timeout(60000)
    });
    const data = await response.json();
    if (!response.ok || !data.downloadPageUrl) throw new Error(data.error || 'We couldn’t get your plan. Please try again.');
    const download = new URL(data.downloadPageUrl, location.origin);
    if (download.origin !== location.origin || download.pathname !== '/download.html') throw new Error('Please try again.');
    location.assign(download.href);
  } catch (err) {
    error.textContent = err.name === 'TimeoutError' || err instanceof TypeError
      ? 'The connection timed out. Please check your connection and try again.' : err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'GET THE PLAN';
  }
});


if(new URLSearchParams(location.search).has('expired')) {
  error.textContent='Your download link has expired. Enter your email to get a fresh link.';
  error.hidden=false;
}

