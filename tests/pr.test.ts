import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrView } from "../extensions/pr.ts";

const OPEN = {
	number: 12,
	url: "https://github.com/yorch/pi-statusbar/pull/12",
	title: "Add PR segment",
	state: "OPEN",
	isDraft: false,
};

test("parsePrView parses an open PR", () => {
	assert.deepEqual(parsePrView(JSON.stringify(OPEN)), OPEN);
});

test("parsePrView keeps draft flag on open PRs", () => {
	const pr = parsePrView(JSON.stringify({ ...OPEN, isDraft: true }));
	assert.equal(pr?.isDraft, true);
	assert.equal(pr?.state, "OPEN");
});

test("parsePrView maps merged and closed states", () => {
	const merged = parsePrView(JSON.stringify({ ...OPEN, state: "MERGED" }));
	assert.equal(merged?.state, "MERGED");
	const closed = parsePrView(JSON.stringify({ ...OPEN, state: "CLOSED" }));
	assert.equal(closed?.state, "CLOSED");
});

test("parsePrView returns null on empty output (no PR for branch)", () => {
	assert.equal(parsePrView(""), null);
	assert.equal(parsePrView("   \n  "), null);
});

test("parsePrView returns null on garbage or malformed payloads", () => {
	assert.equal(parsePrView("not json"), null);
	assert.equal(
		parsePrView(JSON.stringify({ url: "https://example.com" })),
		null,
	);
	assert.equal(
		parsePrView(JSON.stringify({ number: "12", url: "https://example.com" })),
		null,
	);
});
