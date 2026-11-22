// The Release workflow rolls CHANGELOG.md with .github/scripts/changelog-release.mjs
// and pushes the result straight to the default branch: it must work on the
// real file and stay Prettier-clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));

test('the Unreleased section moves under the new version, links follow', async () => {
  const text = await readFile(changelogPath, 'utf8');
  const rolled = rollChangelog(text, '1.0.1', '2026-11-30');
  assert.match(rolled, /^## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-11-30\n/m);
  assert.match(rolled, /^\[Unreleased\]: \S+\/compare\/v1\.0\.1\.\.\.HEAD$/m);
  assert.match(rolled, /^\[1\.0\.1\]: \S+\/releases\/tag\/v1\.0\.1$/m);
  const options = { ...(await prettier.resolveConfig(changelogPath)), filepath: changelogPath };
  assert.equal(await prettier.format(rolled, options), rolled);
});

test('a version already in the changelog is not rolled twice', async () => {
  const once = rollChangelog(await readFile(changelogPath, 'utf8'), '1.0.1', '2026-11-30');
  assert.equal(rollChangelog(once, '1.0.1', '2026-12-01'), once);
});
