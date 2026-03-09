import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverSkillPackageFiles } from '../bin/lib/package-files.mjs';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skill-publish-test-'));

try {
  await writeFile(path.join(tempRoot, 'SKILL.md'), '# Test skill\n');
  await writeFile(path.join(tempRoot, 'skill.json'), '{"name":"test-skill","version":"1.0.0"}\n');
  await mkdir(path.join(tempRoot, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(tempRoot, '.github', 'workflows', 'publish.yml'), 'name: publish\n');
  await mkdir(path.join(tempRoot, '.hidden-cache'), { recursive: true });
  await writeFile(path.join(tempRoot, '.hidden-cache', 'artifact.txt'), 'secret-ish\n');
  await mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await writeFile(path.join(tempRoot, 'docs', 'guide.md'), 'Guide\n');
  await writeFile(path.join(tempRoot, '.env.local'), 'RB_API_KEY=should-not-ship\n');

  const result = await discoverSkillPackageFiles(tempRoot);
  const included = result.includedFiles.map((file) => file.relativePath).sort();
  const excluded = result.excludedFiles.map((file) => `${file.relativePath}:${file.reason}`).sort();

  assert.deepEqual(included, ['SKILL.md', 'docs/guide.md', 'skill.json']);
  assert.ok(excluded.includes('.github/:blocked-directory'));
  assert.ok(excluded.includes('.hidden-cache/:hidden-path'));
  assert.ok(excluded.includes('.env.local:hidden-path'));

  process.stdout.write('package-files discovery test passed\n');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
