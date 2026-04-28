import { describe, it, expect, beforeEach } from 'bun:test';
import app from '../src/index';

describe('URL Shortener', () => {
  beforeEach(async () => {
    // Clean DB for isolation: remove rows from links table
    const { database } = await import('../src/db');
    database.exec('DELETE FROM links');
  });

  it('shows the home page', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Shorten a link');
  });

  it('shows the dashboard', async () => {
    const res = await app.request('/dashboard');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Link Dashboard');
  });

  it('creates a short link via API', async () => {
    const res = await app.request('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/very-long-path' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.shortCode).toBeDefined();
    expect(json.shortUrl).toContain(json.shortCode);
    expect(json.longUrl).toBe('https://example.com/very-long-path');
  });

  it('rejects invalid URLs via API', async () => {
    const res = await app.request('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid URL');
  });

  it('rejects javascript: URLs via API', async () => {
    const res = await app.request('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid URL');
  });

  it('redirects and increments click count', async () => {
    // Create
    const createRes = await app.request('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/target' }),
    });
    const { shortCode } = await createRes.json();

    // Redirect
    const redirectRes = await app.request('/' + shortCode);
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('location')).toBe('https://example.com/target');

    // Dashboard shows 1 click
    const dashRes = await app.request('/dashboard');
    const text = await dashRes.text();
    expect(text).toContain('https://example.com/target');
    expect(text).toContain('>1<'); // one click cell
  });

  it('returns 404 for unknown short codes', async () => {
    const res = await app.request('/unknownzzz');
    expect(res.status).toBe(404);
  });

  it('rejects open-redirect-like URLs', async () => {
    const res = await app.request('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://evil.com\@google.com' }),
    });
    expect(res.status).toBe(400);
  });
});
