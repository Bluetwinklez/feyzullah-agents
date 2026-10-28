import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/core/db.js';
import { append, since, redact } from '../../src/core/events.js';

test('append artan seq döner, since sıralı okur', () => {
  const db = openDb();
  const a = append(db, { actor: 'test', type: 'x.one', entity: 'task', entityId: 't1', data: { n: 1 } });
  const b = append(db, { actor: 'test', type: 'x.two', data: { n: 2 } });
  assert.ok(b > a);
  const all = since(db, 0);
  assert.deepEqual(all.map((e) => e.type), ['x.one', 'x.two']);
  assert.deepEqual(all[0].data, { n: 1 });
  assert.equal(all[0].entityId, 't1');
  assert.deepEqual(since(db, a).map((e) => e.seq), [b]);
  db.close();
});

test('iç içe ve dizideki gizli anahtarlar maskelenir', () => {
  assert.deepEqual(redact({ a: [{ apiKey: 'x', ok: 1 }], Authorization: 'y', n: { refresh_token: 'z' } }),
    { a: [{ apiKey: '[gizli]', ok: 1 }], Authorization: '[gizli]', n: { refresh_token: '[gizli]' } });
  const db = openDb();
  append(db, { type: 's', data: { password: 'p' } });
  assert.equal(since(db, 0)[0].data.password, '[gizli]');
  db.close();
});

test('DELETE ve UPDATE append-only hatası verir', () => {
  const db = openDb();
  append(db, { type: 'x' });
  assert.throws(() => db.prepare('DELETE FROM events').run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE events SET type='y'").run(), /append-only/);
  db.close();
});
