import { serve } from "bun";
import { getAllLinks, getLinkByShortCode, createLink, incrementClicks } from "./db";
import { generateShortCode, isValidUrl, normalizeUrl } from "./shortener";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --text: #1e293b;
  --muted: #64748b;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --border: #e2e8f0;
  --radius: 12px;
  --shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
.container { max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }
header { text-align: center; margin-bottom: 2.5rem; }
header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
header p { color: var(--muted); }
.card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}
input[type="url"] {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 1rem;
  outline: none;
}
input[type="url"]:focus { border-color: var(--accent); }
.btn {
  display: inline-block;
  background: var(--accent);
  color: white;
  border: none;
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius);
  font-size: 1rem;
  cursor: pointer;
  margin-top: 0.75rem;
  text-decoration: none;
}
.btn:hover { background: var(--accent-hover); }
.result { margin-top: 1rem; padding: 1rem; background: #eff6ff; border-radius: var(--radius); word-break: break-all; }
.result a { color: var(--accent); font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; }
.short-cell a { color: var(--accent); text-decoration: none; }
.short-cell a:hover { text-decoration: underline; }
.long-cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { text-align: center; color: var(--muted); padding: 2rem; }
.error { color: #dc2626; margin-top: 0.5rem; }
.actions { display: flex; gap: 0.5rem; align-items: center; }
.copy-btn {
  background: transparent;
  border: 1px solid var(--border);
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  color: var(--muted);
  font-size: 0.875rem;
}
.copy-btn:hover { border-color: var(--accent); color: var(--accent); }
@media (max-width: 600px) {
  .long-cell { max-width: 120px; }
}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🔗 URL Shortener</h1>
    <p>Shorten long links and track clicks</p>
  </header>
  ${body}
</div>
</body>
</html>`;
}

function homePage(error?: string, shortUrl?: string, longUrl?: string): Response {
  const body = `
    <div class="card">
      <form method="POST" action="/shorten">
        <input type="url" name="url" placeholder="Paste your long URL here (https://...)" required value="${longUrl ? escapeHtml(longUrl) : ''}">
        <button type="submit" class="btn">Shorten</button>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      </form>
      ${shortUrl ? `
        <div class="result">
          <p>Your short link:</p>
          <div class="actions">
            <a href="${escapeHtml(shortUrl)}" target="_blank">${escapeHtml(shortUrl)}</a>
            <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeHtml(shortUrl)}')">Copy</button>
          </div>
        </div>
      ` : ''}
    </div>
    <div style="text-align:center;">
      <a href="/dashboard" class="btn">View Dashboard</a>
    </div>
  `;
  return new Response(htmlPage("URL Shortener", body), { headers: { "Content-Type": "text/html" } });
}

function dashboardPage(): Response {
  const links = getAllLinks();
  let rows = '';
  for (const link of links) {
    const shortUrl = `${BASE_URL}/${link.short_code}`;
    rows += `
      <tr>
        <td class="short-cell"><a href="${escapeHtml(shortUrl)}" target="_blank">${escapeHtml(link.short_code)}</a></td>
        <td class="long-cell" title="${escapeHtml(link.long_url)}">${escapeHtml(link.long_url)}</td>
        <td>${link.clicks}</td>
        <td>${escapeHtml(link.created_at)}</td>
      </tr>
    `;
  }

  const body = `
    <div class="card">
      <h2 style="margin-bottom:1rem;">Dashboard</h2>
      ${links.length === 0
        ? `<p class="empty">No links yet. <a href="/">Create one</a>.</p>`
        : `<table>
            <thead>
              <tr><th>Short Code</th><th>Original URL</th><th>Clicks</th><th>Created</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
      }
    </div>
    <div style="text-align:center;">
      <a href="/" class="btn">Shorten another link</a>
    </div>
  `;
  return new Response(htmlPage("Dashboard — URL Shortener", body), { headers: { "Content-Type": "text/html" } });
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/" && req.method === "GET") {
    return homePage();
  }

  if (path === "/shorten" && req.method === "POST") {
    const formData = await req.formData();
    let rawUrl = formData.get("url")?.toString()?.trim() || "";
    if (!rawUrl) {
      return homePage("Please enter a URL.");
    }
    rawUrl = normalizeUrl(rawUrl);
    if (!isValidUrl(rawUrl)) {
      return homePage("That doesn't look like a valid URL.", undefined, rawUrl);
    }
    let shortCode = generateShortCode();
    while (getLinkByShortCode(shortCode)) {
      shortCode = generateShortCode();
    }
    createLink(shortCode, rawUrl);
    const shortUrl = `${BASE_URL}/${shortCode}`;
    return homePage(undefined, shortUrl);
  }

  if (path === "/dashboard" && req.method === "GET") {
    return dashboardPage();
  }

  // Redirect short links
  const match = path.match(/^\/([a-zA-Z0-9]{1,32})$/);
  if (match && req.method === "GET") {
    const shortCode = match[1];
    const link = getLinkByShortCode(shortCode);
    if (link) {
      incrementClicks(shortCode);
      return Response.redirect(link.long_url, 302);
    }
    return new Response(htmlPage("Not Found", `<div class="card"><p class="empty">That short link doesn't exist.</p><a href="/" class="btn">Go home</a></div>`), { status: 404, headers: { "Content-Type": "text/html" } });
  }

  return new Response(htmlPage("Not Found", `<div class="card"><p class="empty">Page not found.</p><a href="/" class="btn">Go home</a></div>`), { status: 404, headers: { "Content-Type": "text/html" } });
}

serve({ port: PORT, fetch: handler });
console.log(`URL Shortener running at ${BASE_URL}`);
