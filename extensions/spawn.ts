/**
 * Shared spawn helper for `git` / `gh` calls.
 * Single impl: stdout capture, 5s timeout + kill, error → ''.
 */

import { spawn } from 'node:child_process';

export interface CmdResult {
  /** exit code; null when the process failed to spawn or timed out */
  code: number | null;
  out: string;
  err: string;
  /** why `code` is null */
  failure?: 'spawn' | 'timeout';
}

export function runCmdEx(cmd: string, args: string[], cwd: string, timeoutMs = 5000): Promise<CmdResult> {
  return new Promise(resolve => {
    let settled = false;
    let out = '';
    let err = '';
    const finish = (r: CmdResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('close', code => finish({ code, out: out.trim(), err: err.trim() }));
    proc.on('error', () => finish({ code: null, out: '', err: '', failure: 'spawn' }));
    setTimeout(() => {
      if (settled) return;
      try {
        proc.kill();
      } catch {
        // noop
      }
      finish({ code: null, out: '', err: '', failure: 'timeout' });
    }, timeoutMs).unref?.();
  });
}

export async function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 5000): Promise<string> {
  const r = await runCmdEx(cmd, args, cwd, timeoutMs);
  return r.code === 0 ? r.out : '';
}
