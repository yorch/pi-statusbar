import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasNerdFonts } from '../extensions/icons.ts';

test('env force overrides detection', () => {
	const prev = process.env.STATUSBAR_NERD_FONTS;
	try {
		process.env.STATUSBAR_NERD_FONTS = '1';
		assert.equal(hasNerdFonts(), true);
		process.env.STATUSBAR_NERD_FONTS = '0';
		assert.equal(hasNerdFonts(), false);
	} finally {
		if (prev === undefined) delete process.env.STATUSBAR_NERD_FONTS;
		else process.env.STATUSBAR_NERD_FONTS = prev;
	}
});

test('ghostty inside tmux is detected', () => {
	const prev = process.env.GHOSTTY_RESOURCES_DIR;
	try {
		process.env.GHOSTTY_RESOURCES_DIR = '/tmp/ghostty';
		assert.equal(hasNerdFonts(), true);
	} finally {
		if (prev === undefined) delete process.env.GHOSTTY_RESOURCES_DIR;
		else process.env.GHOSTTY_RESOURCES_DIR = prev;
	}
});
