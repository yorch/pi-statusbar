import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePorcelain } from "../extensions/git-status.ts";

test("empty porcelain", () => {
	assert.deepEqual(parsePorcelain(""), { staged: 0, unstaged: 0, untracked: 0 });
});

test("unstaged modification", () => {
	assert.deepEqual(parsePorcelain(" M package.json"), { staged: 0, unstaged: 1, untracked: 0 });
});

test("staged addition", () => {
	assert.deepEqual(parsePorcelain("A  README.md"), { staged: 1, unstaged: 0, untracked: 0 });
});

test("staged + unstaged (MM)", () => {
	assert.deepEqual(parsePorcelain("MM src/index.ts"), { staged: 1, unstaged: 1, untracked: 0 });
});

test("untracked file", () => {
	assert.deepEqual(parsePorcelain("?? notes.txt"), { staged: 0, unstaged: 0, untracked: 1 });
});

test("renames count as staged", () => {
	assert.deepEqual(parsePorcelain("R  old.ts -> new.ts"), { staged: 1, unstaged: 0, untracked: 0 });
});

test("mixed batch", () => {
	const out = [" M a.ts", "MM b.ts", "?? c.txt", "A  d.ts"].join("\n");
	assert.deepEqual(parsePorcelain(out), { staged: 2, unstaged: 2, untracked: 1 });
});
