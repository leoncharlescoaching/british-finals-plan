const token = new URLSearchParams(location.search).get('token');
const link = document.querySelector('#download-link');
const status = document.querySelector('#download-status');
const retry = document.createElement('button');
retry.type = 'button'; retry.textContent = 'TRY AGAIN'; retry.hidden = true;
status.after(retry);
async function prepareDownload() {
  retry.hidden = true;
  status.textContent = 'Preparing your plan…';
  try {
    const response = await fetch('/api/plan?token=' + encodeURIComponent(token), { signal: AbortSignal.timeout(15000) });
    if (response.status === 403) { location.replace('/?expired=1'); return; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error('Download unavailable');
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.vercel-storage.com')) throw new Error('Unexpected destination');
    url.searchParams.set('download', '1');
link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = false;
    status.textContent = 'Your download is starting…';
link.textContent = 'Click here if your download doesn’t start';
document.querySelector('.download-note').textContent = 'Read the execution rules first. Then get to work.';
link.click();
  } catch {
    status.textContent = 'We couldn’t prepare the PDF just now. Try again below—you don’t need to enter your details again.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', prepareDownload);
if (token) prepareDownload();
else { status.textContent = 'Request your plan from the home page to get download access.'; }



