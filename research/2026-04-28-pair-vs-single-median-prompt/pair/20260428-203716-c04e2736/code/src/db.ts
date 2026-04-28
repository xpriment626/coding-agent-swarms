import Database from "bun:sqlite";
import { randomBytes } from "crypto";

const db = new Database("/workspace/links.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export function createShortUrl(url: string): string {
  // Generate a 6-char random ID
  const id = randomBytes(4).toString("hex").slice(0, 6);
  const stmt = db.prepare("INSERT INTO links (id, url) VALUES (?, ?)");
  try {
    stmt.run(id, url);
    return id;
  } catch (e: any) {
    if (e.message.includes("UNIQUE constraint failed")) {
      // Retry on collision
      return createShortUrl(url);
    }
    throw e;
  }
}

export function getUrl(id: string): { url: string; clicks: number } | null {
  const row = db.query("SELECT url, clicks FROM links WHERE id = ?").get(id) as any;
  return row || null;
}

export function incrementClicks(id: string): void {
  db.prepare("UPDATE links SET clicks = clicks + 1 WHERE id = ?").run(id);
}

export function getAllLinks(): Array<{ id: string; url: string; clicks: number; created_at: string }> {
  return db.query("SELECT id, url, clicks, created_at FROM links ORDER BY created_at DESC").all() as any;
}

export function deleteLink(id: string): boolean {
  const result = db.prepare("DELETE FROM links WHERE id = ?").run(id);
  return result.changes > 0;
}
