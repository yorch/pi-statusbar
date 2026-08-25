import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasGitHubRemote, isGitHubHost, parsePrView } from '../extensions/pr.ts';

const OPEN = {
	number: 12,
	url: 'https://github.com/yorch/pi-statusbar/pull/12',
	title: 'Add PR segment',
	state: 'OPEN',
	isDraft: false,
};

test('parsePrView parses an open PR', () => {
	assert.deepEqual(parsePrView(JSON.stringify(OPEN)), OPEN);
});

test('parsePrView keeps draft flag on open PRs', () => {
	const pr = parsePrView(JSON.stringify({ ...OPEN, isDraft: true }));
	assert.equal(pr?.isDraft, true);
	assert.equal(pr?.state, 'OPEN');
});

test('parsePrView maps merged and closed states', () => {
	const merged = parsePrView(JSON.stringify({ ...OPEN, state: 'MERGED' }));
	assert.equal(merged?.state, 'MERGED');
	const closed = parsePrView(JSON.stringify({ ...OPEN, state: 'CLOSED' }));
	assert.equal(closed?.state, 'CLOSED');
});

test('parsePrView returns null on empty output (no PR for branch)', () => {
	assert.equal(parsePrView(''), null);
	assert.equal(parsePrView('   \n  '), null);
});

test('parsePrView returns null on garbage or malformed payloads', () => {
	assert.equal(parsePrView('not json'), null);
	assert.equal(parsePrView(JSON.stringify({ url: 'https://example.com' })), null);
	assert.equal(parsePrView(JSON.stringify({ number: '12', url: 'https://example.com' })), null);
});

test('isGitHubHost allows github.com and enterprise hosts', () => {
	assert.equal(isGitHubHost('github.com'), true);
	assert.equal(isGitHubHost('ghe.github.com'), true);
	assert.equal(isGitHubHost('github.enterprise.example.com'), true);
});

test('isGitHubHost rejects other forges and empties', () => {
	assert.equal(isGitHubHost('gitlab.com'), false);
	assert.equal(isGitHubHost('bitbucket.org'), false);
	assert.equal(isGitHubHost('codeberg.org'), false);
	assert.equal(isGitHubHost(''), false);
});

test('hasGitHubRemote finds a github remote among several', () => {
	const fork = [
		'remote.origin.url git@gitlab.com:me/pi-statusbar.git',
		'remote.upstream.url git@github.com:yorch/pi-statusbar.git',
	].join('\n');
	assert.equal(hasGitHubRemote(fork), true);
	assert.equal(hasGitHubRemote('remote.origin.url git@github.com:yorch/pi-statusbar.git'), true);
});

test('hasGitHubRemote rejects non-github and empty output', () => {
	assert.equal(hasGitHubRemote('remote.origin.url git@gitlab.com:group/repo.git'), false);
	assert.equal(hasGitHubRemote('remote.origin.url https://bitbucket.org/a/b.git'), false);
	assert.equal(hasGitHubRemote(''), false);
});

test('hasGitHubRemote ignores malformed lines without a url', () => {
	assert.equal(hasGitHubRemote('remote.origin.url'), false);
	assert.equal(hasGitHubRemote('# a comment\nremote.origin.url git@github.com:yorch/x.git'), true);
});
