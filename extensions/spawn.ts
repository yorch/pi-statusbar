/**
 * Shared spawn helper for `git` / `gh` calls.
 * Single impl: stdout capture, 5s timeout + kill, error → ''.
 */

import { spawn } from 'node:child_process';

export function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 5000): Promise<string> {
	return new Promise(resolve => {
		let settled = false;
		const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
		let out = '';
		proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
		proc.on('close', code => {
			if (settled) return;
			settled = true;
			resolve(code === 0 ? out.trim() : '');
		});
		proc.on('error', () => {
			if (settled) return;
			settled = true;
			resolve('');
		});
		setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				proc.kill();
			} catch {
				// noop
			}
			resolve('');
		}, timeoutMs).unref?.();
	});
}
