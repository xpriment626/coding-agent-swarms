export const layout = (title: string, content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #333;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    header {
      text-align: center;
      margin-bottom: 40px;
    }
    header h1 {
      color: white;
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    header p {
      color: rgba(255,255,255,0.9);
      font-size: 1.1rem;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      margin-bottom: 30px;
    }
    .form-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    input[type="url"] {
      flex: 1;
      min-width: 200px;
      padding: 14px 18px;
      border: 2px solid #e0e0e0;
      border-radius: 10px;
      font-size: 1rem;
      transition: border-color 0.2s;
    }
    input[type="url"]:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      padding: 14px 28px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
    }
    button:hover {
      background: #5a6fd6;
    }
    button:active {
      transform: scale(0.98);
    }
    .result {
      margin-top: 20px;
      padding: 20px;
      background: #f0f4ff;
      border-radius: 10px;
      border: 2px solid #667eea;
      display: none;
    }
    .result.visible {
      display: block;
    }
    .result label {
      display: block;
      font-size: 0.85rem;
      color: #667eea;
      font-weight: 600;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .result input {
      width: 100%;
      padding: 12px;
      border: 1px solid #c7d2fe;
      border-radius: 8px;
      font-size: 1rem;
      font-family: monospace;
      background: white;
    }
    .nav {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-bottom: 30px;
    }
    .nav a {
      color: white;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 8px;
      background: rgba(255,255,255,0.15);
      transition: background 0.2s;
    }
    .nav a:hover {
      background: rgba(255,255,255,0.25);
    }
    .nav a.active {
      background: rgba(255,255,255,0.3);
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 14px;
      text-align: left;
    }
    th {
      font-weight: 600;
      color: #667eea;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid #e0e0e0;
    }
    td {
      border-bottom: 1px solid #f0f0f0;
      font-size: 0.95rem;
    }
    tr:hover td {
      background: #f8f9ff;
    }
    .url-cell {
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .short-url {
      font-family: monospace;
      background: #f0f0f0;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    .clicks {
      font-weight: 600;
      color: #667eea;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #999;
    }
    .error {
      color: #e74c3c;
      margin-top: 12px;
      font-size: 0.95rem;
    }
    .copy-btn {
      padding: 8px 16px;
      font-size: 0.85rem;
      margin-top: 10px;
    }
    @media (max-width: 600px) {
      header h1 { font-size: 1.8rem; }
      .form-group { flex-direction: column; }
      .url-cell { max-width: 150px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔗 ShortLink</h1>
      <p>Shorten your links and track their performance</p>
    </header>
    <nav class="nav">
      <a href="/" class="${title === 'ShortLink' ? 'active' : ''}">Create Link</a>
      <a href="/dashboard" class="${title === 'Dashboard' ? 'active' : ''}">Dashboard</a>
    </nav>
    ${content}
  </div>
</body>
</html>`;

export const homePage = (shortUrl?: string, error?: string) => layout('ShortLink', `
  <div class="card">
    <form method="POST" action="/shorten" class="form-group">
      <input type="url" name="url" placeholder="Paste your long URL here..." required 
        autofocus value="">
      <button type="submit">Shorten URL</button>
    </form>
    ${error ? `<div class="error">${error}</div>` : ''}
    <div class="result ${shortUrl ? 'visible' : ''}">
      <label>Your short link</label>
      <input type="text" id="shortUrl" value="${shortUrl || ''}" readonly onclick="this.select()">
      <button class="copy-btn" onclick="copyUrl()">Copy to Clipboard</button>
    </div>
  </div>
  <script>
    function copyUrl() {
      const input = document.getElementById('shortUrl');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy to Clipboard', 1500);
      });
    }
  </script>
`);

export const dashboardPage = (links: Array<{
  short_code: string;
  original_url: string;
  created_at: number;
  click_count: number;
}>, baseUrl: string) => layout('Dashboard', `
  <div class="card">
    <h2 style="margin-bottom: 20px;">Your Links</h2>
    ${links.length === 0 ? `
      <div class="empty-state">
        <p>No links created yet. <a href="/">Create your first link!</a></p>
      </div>
    ` : `
      <table>
        <thead>
          <tr>
            <th>Short URL</th>
            <th>Original URL</th>
            <th>Clicks</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${links.map(link => `
            <tr>
              <td><span class="short-url">${baseUrl}/${link.short_code}</span></td>
              <td class="url-cell" title="${link.original_url}">${link.original_url}</td>
              <td class="clicks">${link.click_count}</td>
              <td>${new Date(link.created_at * 1000).toLocaleDateString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>
`);
