import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countStash, parseLogLine, parsePorcelain, parseRemoteHost, parseStatusV2 } from '../extensions/git-status.ts';

test('empty porcelain', () => {
	assert.deepEqual(parsePorcelain(''), { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
});

test('unstaged modification', () => {
	assert.deepEqual(parsePorcelain(' M package.json'), { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 });
});

test('staged addition', () => {
	assert.deepEqual(parsePorcelain('A  README.md'), { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 });
});

test('staged + unstaged (MM)', () => {
	assert.deepEqual(parsePorcelain('MM src/index.ts'), { staged: 1, unstaged: 1, untracked: 0, conflicted: 0 });
});

test('untracked file', () => {
	assert.deepEqual(parsePorcelain('?? notes.txt'), { staged: 0, unstaged: 0, untracked: 1, conflicted: 0 });
});

test('renames count as staged', () => {
	assert.deepEqual(parsePorcelain('R  old.ts -> new.ts'), { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 });
});

test('mixed batch', () => {
	const out = [' M a.ts', 'MM b.ts', '?? c.txt', 'A  d.ts'].join('\n');
	assert.deepEqual(parsePorcelain(out), { staged: 2, unstaged: 2, untracked: 1, conflicted: 0 });
});

test('parseStatusV2 reads branch headers', () => {
	const out = [
		'# branch.oid c921a07f335e993f5c4fe09be7cd94dd3898a3dc',
		'# branch.head feature/foo',
		'# branch.upstream origin/feature/foo',
		'# branch.ab +2 -5',
	].join('\n');
	const s = parseStatusV2(out);
	assert.equal(s.branch, 'feature/foo');
	assert.equal(s.upstream, 'origin/feature/foo');
	assert.equal(s.ahead, 2);
	assert.equal(s.behind, 5);
	assert.deepEqual([s.staged, s.unstaged, s.untracked, s.conflicted], [0, 0, 0, 0]);
});

test('parseStatusV2 counts v2 file lines', () => {
	const out = [
		'# branch.head main',
		'# branch.ab +0 -0',
		'1 .M N... 100644 100644 100644 abc1234 abc1234 package.json',
		'1 M. N... 100644 100644 100644 abc1234 abc1234 README.md',
		'2 R. N... 100644 100644 100644 abc1234 abc1234 R100 old.ts new.ts',
		'u UU N... 100644 100644 100644 abc1234 abc1234 conflict.ts',
		'? notes.txt',
	].join('\n');
	const s = parseStatusV2(out);
	assert.equal(s.branch, 'main');
	// staged: M. + R. + one side of UU; unstaged: .M + other side of UU; conflicted: UU
	assert.deepEqual([s.staged, s.unstaged, s.untracked, s.conflicted], [3, 2, 1, 1]);
});

test('parseStatusV2 tolerates v1 file lines', () => {
	const out = [' M package.json', 'A  README.md', '?? notes.txt'].join('\n');
	const s = parseStatusV2(out);
	assert.equal(s.branch, null);
	assert.deepEqual([s.staged, s.unstaged, s.untracked, s.conflicted], [1, 1, 1, 0]);
});

test('parseStatusV2 handles detached HEAD and no upstream', () => {
	const s = parseStatusV2('# branch.head (detached)\n# branch.ab +0 -0\n');
	assert.equal(s.branch, null);
	assert.equal(s.upstream, null);
	assert.deepEqual([s.ahead, s.behind], [0, 0]);
});

test('parseStatusV2 normalizes HEAD detached variant', () => {
	const s = parseStatusV2('# branch.head (HEAD detached at abc1234)\n# branch.ab +0 -0\n');
	assert.equal(s.branch, null);
});

test('parseRemoteHost strips trailing slash before .git', () => {
	assert.equal(parseRemoteHost('https://github.com/yorch/pi-statusbar.git/'), 'github.com/yorch/pi-statusbar');
	assert.equal(parseRemoteHost('https://github.com/yorch/pi-statusbar.GIT'), 'github.com/yorch/pi-statusbar');
});

test('countStash counts entries', () => {
	assert.equal(countStash(''), 0);
	assert.equal(countStash('stash@{0}: WIP on main: abc1234 thing'), 1);
	assert.equal(countStash('stash@{0}: WIP on main: abc1234 thing\nstash@{1}: WIP on main: def5678 other'), 2);
});

test('parseLogLine extracts sha + subject', () => {
	assert.equal(parseLogLine(''), null);
	assert.equal(parseLogLine('abc1234\tFix the thing'), 'abc1234 Fix the thing');
	assert.equal(parseLogLine('abc1234\t'), 'abc1234');
});

test('parseRemoteHost handles scp-style and URL remotes', () => {
	assert.equal(parseRemoteHost('git@github.com:yorch/pi-statusbar.git'), 'github.com/yorch/pi-statusbar');
	assert.equal(parseRemoteHost('https://github.com/yorch/pi-statusbar.git'), 'github.com/yorch/pi-statusbar');
	assert.equal(parseRemoteHost('ssh://git@gitlab.com/group/sub/repo.git'), 'gitlab.com/group/sub/repo');
	assert.equal(parseRemoteHost('git@gitlab.com:group/repo'), 'gitlab.com/group/repo');
});

test('parseRemoteHost rejects local paths and empties', () => {
	assert.equal(parseRemoteHost(''), null);
	assert.equal(parseRemoteHost('/Users/yorch/code/repo'), null);
	assert.equal(parseRemoteHost('./repo'), null);
});
