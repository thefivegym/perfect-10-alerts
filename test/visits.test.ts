import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('the visitor counter stores only a total and increments on demand', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0004_visitors.sql', 'utf8'));
  const read = () => (db.prepare('SELECT total FROM visitor_counter WHERE id = 1').get() as { total: number }).total;
  assert.equal(read(), 0);
  const bump = db.prepare('UPDATE visitor_counter SET total = total + 1 WHERE id = 1 RETURNING total');
  assert.equal((bump.get() as { total: number }).total, 1);
  assert.equal((bump.get() as { total: number }).total, 2);
  assert.equal(read(), 2);
  const sql = readFileSync('migrations/0004_visitors.sql', 'utf8').toLowerCase();
  assert.equal(sql.includes('ip'), false);
  assert.equal(sql.includes('user'), false);
});
