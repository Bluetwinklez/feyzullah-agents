// Süreç ağacını öldürme: Windows'ta taskkill /T /F, diğerlerinde süreç grubu (süreç detached başlatılmış olmalı).
import { spawnSync } from 'node:child_process';

export const WIN = process.platform === 'win32';

/** @param {import('node:child_process').ChildProcess} child */
export function killTree(child) {
  if (!child.pid) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}

/** PATH'in önüne dizin ekler (Windows'ta anahtar adı "Path" olabilir). */
export function withExtraPath(env, extraPath) {
  if (!extraPath) return env;
  const k = Object.keys(env).find((x) => x.toLowerCase() === 'path') ?? 'PATH';
  return { ...env, [k]: `${extraPath}${WIN ? ';' : ':'}${env[k] ?? ''}` };
}
