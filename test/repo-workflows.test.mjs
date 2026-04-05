import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
const existingRepoDir = path.join(runtimeRoot, 'existing-skill-repo');
const scaffoldRepoDir = path.join(runtimeRoot, 'scaffolded-skill-repo');

try {
  await mkdir(path.join(existingRepoDir, 'skills', 'weather-skill'), {
    recursive: true,
  });
  await writeFile(
    path.join(existingRepoDir, 'skills', 'weather-skill', 'SKILL.md'),
    '# Weather Skill\n',
    'utf8',
  );
  await writeFile(
    path.join(existingRepoDir, 'skills', 'weather-skill', 'skill.json'),
    `${JSON.stringify(
      {
        name: 'weather-skill',
        version: '1.0.0',
        description: 'Weather lookup skill',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const setupActionResult = runCli(
    ['setup-action', existingRepoDir, '--with-validate'],
    repoRoot,
  );
  assert.equal(setupActionResult.status, 0, setupActionResult.stderr);

  const validateWorkflow = await readFile(
    path.join(existingRepoDir, '.github', 'workflows', 'validate-skill.yml'),
    'utf8',
  );
  assert.equal(
    validateWorkflow.includes('id-token: write'),
    false,
    'Validate workflow must stay fork-safe by default and avoid OIDC on pull_request.',
  );
  assert.equal(
    validateWorkflow.includes('mode: validate'),
    true,
    'Validate workflow must call skill-publish in validate mode.',
  );
  assert.equal(
    validateWorkflow.includes('preview-upload: "false"'),
    true,
    'Validate workflow must disable preview upload by default.',
  );
  assert.equal(
    validateWorkflow.includes(
      'hashgraph-online/skill-publish@be25745bc45fe05617c033e840661a7f0576be81',
    ),
    true,
    'Validate workflow must pin the skill-publish action to an immutable commit SHA.',
  );
  assert.equal(
    validateWorkflow.includes('api-key:'),
    false,
    'Validate workflow must remain secretless.',
  );

  const scaffoldResult = runCli(
    ['scaffold-repo', scaffoldRepoDir, '--name', 'catalog-skill'],
    repoRoot,
  );
  assert.equal(scaffoldResult.status, 0, scaffoldResult.stderr);

  const scaffoldedValidateWorkflow = await readFile(
    path.join(scaffoldRepoDir, '.github', 'workflows', 'validate-skill.yml'),
    'utf8',
  );
  const scaffoldedReadme = await readFile(
    path.join(scaffoldRepoDir, 'README.md'),
    'utf8',
  );
  const releaseWorkflow = await readFile(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('id-token: write'),
    false,
    'Scaffolded validate workflow must stay fork-safe by default.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('preview-upload: "false"'),
    true,
    'Scaffolded validate workflow must disable preview upload by default.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes(
      'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    ),
    true,
    'Scaffolded validate workflow must pin checkout to an immutable commit SHA.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes(
      'hashgraph-online/skill-publish@be25745bc45fe05617c033e840661a7f0576be81',
    ),
    true,
    'Scaffolded validate workflow must pin skill-publish to an immutable commit SHA.',
  );
  assert.equal(
    scaffoldedReadme.includes('Open a pull request to run fork-safe validate-only CI first.'),
    true,
    'Scaffolded repo README must direct maintainers through validate-first setup.',
  );
  assert.equal(
    scaffoldedReadme.includes(
      'Keep preview upload disabled until maintainers explicitly opt in to a trusted repo-owned workflow.',
    ),
    true,
    'Scaffolded repo README must keep preview uploads opt-in instead of enabling OIDC by default.',
  );
  assert.equal(
    scaffoldedReadme.includes('Add `RB_API_KEY` only when you are ready to quote and publish immutable releases.'),
    true,
    'Scaffolded repo README must keep publish credit/auth setup separate from validate-first setup.',
  );
  assert.equal(
    releaseWorkflow.includes("tags:\n      - 'v*.*.*'"),
    true,
    'Release workflow must only react to semver tags.',
  );
  assert.equal(
    releaseWorkflow.includes('Publish package from main release workflow'),
    true,
    'Release workflow must publish npm from the main release path instead of relying on a workflow-triggered tag push.',
  );
} finally {
  await rm(runtimeRoot, { recursive: true, force: true });
}

process.stdout.write('repo-workflows test passed\n');
