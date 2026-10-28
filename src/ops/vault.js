// Sır kasası: değerler Windows DPAPI (CurrentUser) ile şifrelenip veritabanında durur, yalnız izin verilen
// uzmanın sürecine ortam değişkeni olarak verilir. Değer hiçbir zaman olaya, loga ya da çıktıya yazılmaz.
import { spawnSync } from 'node:child_process';
import { now, tx } from '../core/db.js';
import { append } from '../core/events.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */
/** @typedef {{protect: (plain: string) => string, unprotect: (cipher: string) => string}} Crypto */

const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

// Değer stdin'den base64 olarak geçer: komut satırında ve konsol kod sayfasında görünmez/bozulmaz.
const PS_PROTECT = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); "
  + "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const PS_UNPROTECT = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); "
  + "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";

function ps(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`DPAPI başarısız: ${(r.error?.message ?? r.stderr ?? '').trim().split('\n')[0]}`);
  return r.stdout.trim();
}

/** @type {Crypto} */
export const dpapi = {
  protect: (plain) => ps(PS_PROTECT, Buffer.from(plain, 'utf8').toString('base64')),
  unprotect: (cipher) => Buffer.from(ps(PS_UNPROTECT, cipher), 'base64').toString('utf8'),
};

/**
 * @param {Db} db @param {{crypto?: Crypto}} [o]
 */
export function createVault(db, { crypto = dpapi } = {}) {
  const cache = new Map();
  const row = (name) => db.prepare('SELECT * FROM vault WHERE name = ?').get(name);
  return {
    /** @param {string} name @param {string} value @param {{agents?: string[]}} [o] */
    set(name, value, { agents } = {}) {
      if (!NAME_RE.test(name)) throw new Error(`sır adı BÜYÜK_HARF_ALT_ÇİZGİ olmalı: ${name}`);
      if (!value) throw new Error('boş değer');
      const cipher = crypto.protect(value);
      const at = now();
      tx(db, () => {
        db.prepare(`INSERT INTO vault(name, cipher, agents, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET cipher = excluded.cipher, agents = COALESCE(?, vault.agents), updated_at = excluded.updated_at`)
          .run(name, cipher, JSON.stringify(agents ?? []), at, at, agents ? JSON.stringify(agents) : null);
        append(db, { actor: 'vault', type: 'vault.set', entity: 'secret', entityId: name, data: { agents: agents ?? null } });
      });
      cache.delete(name);
    },
    /** @param {string} name @param {string} agentId */
    grant(name, agentId) {
      const r = row(name);
      if (!r) throw new Error(`sır yok: ${name}`);
      const list = [...new Set([...JSON.parse(r.agents), agentId])];
      db.prepare('UPDATE vault SET agents = ?, updated_at = ? WHERE name = ?').run(JSON.stringify(list), now(), name);
      append(db, { actor: 'vault', type: 'vault.granted', entity: 'secret', entityId: name, data: { agentId } });
    },
    /** @param {string} name */
    remove(name) {
      db.prepare('DELETE FROM vault WHERE name = ?').run(name);
      cache.delete(name);
      append(db, { actor: 'vault', type: 'vault.removed', entity: 'secret', entityId: name });
    },
    /** Yalnız adlar ve izinler; değer dönmez. */
    list: () => db.prepare('SELECT name, agents, updated_at FROM vault ORDER BY name').all().map((r) => ({ ...r, agents: JSON.parse(r.agents) })),
    /** Uzmana izinli sırlar → ortam değişkenleri. "*" izni herkese açar. @param {string|null} agentId */
    envFor(agentId) {
      const out = {};
      for (const r of db.prepare('SELECT * FROM vault').all()) {
        const agents = JSON.parse(r.agents);
        if (!agents.includes('*') && !(agentId && agents.includes(agentId))) continue;
        if (!cache.has(r.name)) cache.set(r.name, crypto.unprotect(r.cipher));
        out[r.name] = cache.get(r.name);
      }
      return out;
    },
  };
}

/** Metindeki sır değerlerini adla değiştirir (çıktı özetleri ve hatalar için). @param {string|null} text @param {Record<string,string>} env */
export function maskValues(text, env) {
  if (text == null) return text;
  let s = String(text);
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 6) s = s.split(v).join(`[gizli:${k}]`);
  return s;
}
