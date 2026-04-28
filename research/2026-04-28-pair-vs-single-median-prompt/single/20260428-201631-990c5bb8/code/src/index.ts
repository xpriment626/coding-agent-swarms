import { serve } from 'bun';
import { createLink, getLinkByShortCode, incrementClickCount, getAllLinks } from './db';
import { generateUniqueShortCode, isValidUrl } from './utils';
import { homePage, dashboardPage } from './html';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

function getBaseUrl(req: Request): string {
  const host = req.headers.get('host') || `localhost:${PORT}`;
  const protocol = req.headers.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}`;
}

const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const baseUrl = getBaseUrl(req);

    // Static files
    if (path === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    // Home page
    if (path === '/' && req.method === 'GET') {
      return new Response(homePage(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Shorten URL
    if (path === '/shorten' && req.method === 'POST') {
      const formData = await req.formData();
      const originalUrl = formData.get('url')?.toString().trim() || '';

      if (!originalUrl || !isValidUrl(originalUrl)) {
        return new Response(homePage(undefined, 'Please enter a valid URL starting with http:// or https://'), {
          headers: { 'Content-Type': 'text/html' }
        });
      }

      const shortCode = generateUniqueShortCode();
      createLink(shortCode, originalUrl);
      const shortUrl = `${baseUrl}/${shortCode}`;

      return new Response(homePage(shortUrl), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // API: Shorten URL (JSON)
    if (path === '/api/shorten' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const originalUrl = body.url?.toString().trim() || '';

      if (!originalUrl || !isValidUrl(originalUrl)) {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const shortCode = generateUniqueShortCode();
      createLink(shortCode, originalUrl);

      return new Response(JSON.stringify({
        shortCode,
        shortUrl: `${baseUrl}/${shortCode}`,
        originalUrl
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Dashboard
    if (path === '/dashboard' && req.method === 'GET') {
      const links = getAllLinks();
      return new Response(dashboardPage(links, baseUrl), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Redirect short URL
    if (path.startsWith('/') && path.length > 1 && req.method === 'GET') {
      const shortCode = path.slice(1);
      const link = getLinkByShortCode(shortCode);

      if (link) {
        incrementClickCount(shortCode);
        return Response.redirect(link.original_url, 302);
      }
    }

    return new Response('Not Found', { status: 404 });
  }
});

console.log(`🚀 URL Shortener running at http://localhost:${PORT}`);
