const API_BASE = '';

const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const resultDiv = document.getElementById('result');
const shortLinkInput = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const errorP = document.getElementById('error');
const linksTbody = document.getElementById('links-tbody');

// Load dashboard on page load
loadDashboard();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorP.classList.add('hidden');
  resultDiv.classList.add('hidden');

  const url = urlInput.value.trim();
  if (!url) return;

  try {
    const res = await fetch(`${API_BASE}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to shorten URL');
    }

    shortLinkInput.value = data.shortUrl;
    resultDiv.classList.remove('hidden');
    urlInput.value = '';
    loadDashboard();
  } catch (err) {
    errorP.textContent = err.message;
    errorP.classList.remove('hidden');
  }
});

copyBtn.addEventListener('click', () => {
  shortLinkInput.select();
  document.execCommand('copy');
  copyBtn.textContent = 'Copied!';
  setTimeout(() => copyBtn.textContent = 'Copy', 2000);
});

async function loadDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/links`);
    const links = await res.json();
    renderLinks(links);
  } catch (err) {
    console.error('Failed to load links:', err);
  }
}

function renderLinks(links) {
  if (links.length === 0) {
    linksTbody.innerHTML = `<tr class="empty-row"><td colspan="4">No links created yet</td></tr>`;
    return;
  }

  linksTbody.innerHTML = links.map(link => {
    const shortUrl = `${window.location.origin}/${link.id}`;
    const date = new Date(link.created_at).toLocaleDateString();
    return `
      <tr>
        <td class="short-link-cell"><a href="${shortUrl}" target="_blank">${link.id}</a></td>
        <td class="url-cell" title="${link.url}">${link.url}</td>
        <td class="clicks-cell">${link.clicks}</td>
        <td>${date}</td>
      </tr>
    `;
  }).join('');
}
