import { Database } from "bun:sqlite";

const db = new Database("/workspace/links.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    short_code TEXT PRIMARY KEY,
    long_url TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export interface Link {
  short_code: string;
  long_url: string;
  clicks: number;
  created_at: string;
}

export function getAllLinks(): Link[] {
  return db.query<Link, []>("SELECT * FROM links ORDER BY created_at DESC;").all();
}

export function getLinkByShortCode(shortCode: string): Link | null {
  return db.query<Link, [string]>("SELECT * FROM links WHERE short_code = ?1;").get(shortCode) ?? null;
}

export function createLink(shortCode: string, longUrl: string): void {
  db.query<void, [string, string]>(
    "INSERT INTO links (short_code, long_url) VALUES (?1, ?2);"
  ).run(shortCode, longUrl);
}

export function incrementClicks(shortCode: string): void {
  db.query<void, [string]>("UPDATE links SET clicks = clicks + 1 WHERE short_code = ?1;").run(shortCode);
}

export function deleteLink(shortCode: string): void {
  db.query<void, [string]>("DELETE FROM links WHERE short_code = ?1;").run(shortCode);
}

export default db;
