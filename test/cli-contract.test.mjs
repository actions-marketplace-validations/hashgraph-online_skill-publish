import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '..', 'bin', 'cli.mjs');

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
}

const validateModeResult = runCli(['--mode', 'validate', '--skill-dir', '.']);
assert.notEqual(validateModeResult.status, 0);
assert.equal(
  validateModeResult.stderr.includes('Missing API key'),
  false,
  `expected --mode validate to avoid API key gating, got: ${validateModeResult.stderr}`,
);

const quoteModeResult = runCli(['--mode', 'quote', '--skill-dir', '.']);
assert.notEqual(quoteModeResult.status, 0);
assert.equal(
  quoteModeResult.stderr.includes('Missing API key'),
  true,
  `expected --mode quote to require API key, got: ${quoteModeResult.stderr}`,
);

const helpResult = runCli(['--help']);
assert.equal(helpResult.status, 0);
assert.equal(
  helpResult.stdout.includes('--mode <mode>'),
  true,
  `expected global help to document --mode, got: ${helpResult.stdout}`,
);

process.stdout.write('cli-contract test passed\n');
