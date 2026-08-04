import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

describe('workspace smoke', () => {
  it('sqlite in-memory works', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    db.prepare('INSERT INTO t (x) VALUES (?)').run(42);
    const row = db.prepare('SELECT x FROM t').get() as { x: number };
    expect(row.x).toBe(42);
    db.close();
  });
});
