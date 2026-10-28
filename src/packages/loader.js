// Alan paketleri: packages/<ad>/paket.json. Paket uzmanlar (agents/), çalışma alanı türleri ve isteğe bağlı bir
// JS modülü getirir. Güvenlik: JS modülü yalnız paketle gelen klasörden yüklenir; çalışma alanındaki paketler
// yalnız bildirimseldir (uzman dosyaları), kod çalıştırmaz.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUNDLED_PACKAGES = join(import.meta.dirname, '..', '..', 'packages');

/**
 * @typedef {{name: string, description?: string, kinds: string[], agentsDir: string|null, dir: string, bundled: boolean,
 *   module: string|null, perf?: object, blocked?: string[]}} Package
 * @param {{bundled?: string, workspace?: string|null}} [o]
 * @returns {Package[]}
 */
export function loadPackages({ bundled = BUNDLED_PACKAGES, workspace = null } = {}) {
  const out = new Map();
  for (const [root, isBundled] of [[bundled, true], [workspace, false]]) {
    if (!root || !existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      const file = join(dir, 'paket.json');
      if (!existsSync(file)) continue;
      const m = JSON.parse(readFileSync(file, 'utf8'));
      if (!m.name || !/^[a-z0-9-]+$/.test(m.name)) throw new Error(`geçersiz paket adı: ${file}`);
      // Çalışma alanı paketi paketle gelen aynı adlı paketi ezemez (modülü ele geçirmesin).
      if (!isBundled && out.has(m.name)) continue;
      out.set(m.name, {
        name: m.name, description: m.description ?? '', kinds: m.kinds ?? [], dir, bundled: isBundled,
        agentsDir: m.agents && existsSync(join(dir, m.agents)) ? join(dir, m.agents) : null,
        module: isBundled && m.module ? join(dir, m.module) : null, perf: m.perf, blocked: m.blocked ?? [],
      });
    }
  }
  return [...out.values()];
}

/** @param {Package[]} pkgs @param {string} kind */
export const packageForKind = (pkgs, kind) => pkgs.find((p) => p.kinds.includes(kind)) ?? null;

/** Paketin JS modülü (yalnız paketle gelenler). @param {Package|null} pkg */
export async function packageModule(pkg) {
  if (!pkg?.module) return null;
  return import(pathToFileURL(pkg.module).href);
}
