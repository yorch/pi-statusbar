import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens, PRESETS, renderBar, SEGMENTS } from '../extensions/segments.ts';

test('formatTokens scales', () => {
	assert.equal(formatTokens(0), '0');
	assert.equal(formatTokens(999), '999');
	assert.equal(formatTokens(1234), '1.2k');
	assert.equal(formatTokens(45000), '45k');
	assert.equal(formatTokens(1_200_000), '1.2M');
	assert.equal(formatTokens(45_000_000), '45M');
});

test('renderBar gradient stays within width', () => {
	assert.deepEqual(renderBar(0, 10), { filled: '', partial: '', empty: '░░░░░░░░░░' });
	assert.deepEqual(renderBar(100, 10), { filled: '██████████', partial: '', empty: '' });
	for (const p of [1, 5, 25, 42, 66, 88]) {
		const b = renderBar(p, 10);
		assert.equal((b.filled + b.partial + b.empty).length, 10, `width invariant at ${p}%`);
	}
});

test('renderBar handles out-of-range percent', () => {
	assert.equal((renderBar(-10, 10).filled + renderBar(-10, 10).partial).length, 0);
	assert.equal(renderBar(150, 10).filled.length, 10);
});

test('every preset segment id resolves to a segment', () => {
	for (const [name, def] of Object.entries(PRESETS)) {
		for (const row of def.rows) {
			for (const id of [...row.left, ...(row.right ?? [])]) {
				assert.ok(SEGMENTS[id], `preset "${name}" references unknown segment "${id}"`);
			}
		}
	}
});

test('default and full presets have expected rows', () => {
	const def = PRESETS.default;
	assert.equal(def.rows.length, 1);
	assert.ok(def.rows[0].left.includes('context'));
	assert.ok(def.rows[0].right?.includes('session'));

	const full = PRESETS.full;
	assert.equal(full.rows.length, 2);
	assert.ok(full.rows[1].right?.includes('model'));
	assert.equal(full.opts?.pathMode, 'abbreviated');
});

test('full preset carries repo identity and new info segments', () => {
	const full = PRESETS.full;
	assert.ok(full.rows[0].left.includes('pr'));
	assert.ok(full.rows[0].left.includes('remote'));
	assert.ok(full.rows[1].left.includes('stash'));
	assert.ok(full.rows[1].right?.includes('commit'));
});
