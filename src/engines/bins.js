// claude / codex / agy çalıştırılabilirlerini bulur. Konumlar Ofis `src/agents/cli.js` findBins ile aynı.
// .cmd/.bat sarmalayıcılar alınmaz: Node bunları shell olmadan başlatamaz (CVE-2024-27980).
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const WIN = process.platform === 'win32';

/** Sürüm klasörlerinde (en yeni önce, bir alt seviye dahil) dosyayı arar. */
async function newest(dir, name) {
  try {
    for (const v of (await readdir(dir)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const sub of [v, ...(await readdir(join(dir, v)).catch(() => []))]) {
        const p = sub === v ? join(dir, v, name) : join(dir, v, sub, name);
        if (existsSync(p)) return p;
      }
    }
  } catch {}
  return null;
}

/** PATH'teki ilk çalıştırılabilir; Windows'ta yalnız .exe. */
function onPath(name, env) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  for (const dir of String(env[key] ?? '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, WIN ? `${name}.exe` : name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Promise<{claude?: string, codex?: string, antigravity?: string}>}
 */
export async function findBins(env = process.env) {
  const local = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  const roaming = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  let claude = await newest(join(roaming, 'Claude', 'claude-code'), 'claude.exe');
  // Yeni masaüstü sürümleri: %LOCALAPPDATA%\Claude-Data\<paket>\claude-code\<sürüm>\<hash>\claude.exe
  if (!claude) {
    for (const p of await readdir(join(local, 'Claude-Data')).catch(() => [])) {
      claude = await newest(join(local, 'Claude-Data', p, 'claude-code'), 'claude.exe');
      if (claude) break;
    }
  }
  // MSIX paketi
  if (!claude) {
    for (const p of await readdir(join(local, 'Packages')).catch(() => [])) {
      if (!/^Claude_/i.test(p)) continue;
      claude = await newest(join(local, 'Packages', p, 'LocalCache', 'Roaming', 'Claude', 'claude-code'), 'claude.exe');
      if (claude) break;
    }
  }
  const agy = join(local, 'agy', 'bin', 'agy.exe');
  const out = {
    claude: claude ?? onPath('claude', env),
    codex: (await newest(join(local, 'OpenAI', 'Codex', 'bin'), 'codex.exe')) ?? onPath('codex', env),
    antigravity: existsSync(agy) ? agy : onPath('agy', env),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
