#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

const HELP = `skill-publish CLI

Usage:
  npx skill-publish --api-key <key> --skill-dir <dir> [options]

Required:
  --api-key <key>         Registry Broker API key (or use RB_API_KEY env var)
  --skill-dir <dir>       Skill package directory containing SKILL.md + skill.json

Options:
  --api-base-url <url>    Broker API base URL (default: https://hol.org/registry/api/v1)
  --account-id <id>       Optional Hedera account ID
  --name <name>           Optional skill name override
  --version <version>     Optional skill version override
  --annotate <bool>       Enable GitHub annotation behavior (default: false for CLI)
  --no-annotate           Disable GitHub annotations
  --github-token <token>  GitHub token for annotations
  --stamp-repo-commit <bool>  Stamp repo/commit fields (default: true)
  --no-stamp-repo-commit  Disable repo/commit stamping
  --poll-timeout-ms <ms>  Publish poll timeout (default: 720000)
  --poll-interval-ms <ms> Publish poll interval (default: 4000)
  --help                  Show this help
  -v                      Show CLI version

Examples:
  RB_API_KEY=rbk_xxx npx skill-publish --skill-dir ./skills/my-skill
  npx skill-publish --api-key rbk_xxx --skill-dir ./skills/my-skill --version 1.2.3
`;

const FLAG_ENV_MAP = new Map([
  ['--api-base-url', 'INPUT_API_BASE_URL'],
  ['--api-key', 'INPUT_API_KEY'],
  ['--account-id', 'INPUT_ACCOUNT_ID'],
  ['--skill-dir', 'INPUT_SKILL_DIR'],
  ['--name', 'INPUT_NAME'],
  ['--version', 'INPUT_VERSION'],
  ['--stamp-repo-commit', 'INPUT_STAMP_REPO_COMMIT'],
  ['--poll-timeout-ms', 'INPUT_POLL_TIMEOUT_MS'],
  ['--poll-interval-ms', 'INPUT_POLL_INTERVAL_MS'],
  ['--annotate', 'INPUT_ANNOTATE'],
  ['--github-token', 'INPUT_GITHUB_TOKEN'],
]);

const BOOLEAN_FLAGS = new Set(['--annotate', '--stamp-repo-commit']);

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.stderr.write('Run `npx skill-publish --help` for usage.\n');
  process.exit(1);
}

function parseArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${HELP}\n`);
      process.exit(0);
    }

    if (arg === '-v') {
      process.stdout.write(`${String(packageJson.version)}\n`);
      process.exit(0);
    }

    if (arg === '--version') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        process.stdout.write(`${String(packageJson.version)}\n`);
        process.exit(0);
      }
    }

    if (arg.startsWith('--no-')) {
      const positive = `--${arg.slice(5)}`;
      if (!BOOLEAN_FLAGS.has(positive)) {
        fail(`Unknown flag: ${arg}`);
      }
      process.env[FLAG_ENV_MAP.get(positive)] = 'false';
      continue;
    }

    let key = arg;
    let value = '';
    if (arg.startsWith('--') && arg.includes('=')) {
      const splitIndex = arg.indexOf('=');
      key = arg.slice(0, splitIndex);
      value = arg.slice(splitIndex + 1);
    }

    if (!FLAG_ENV_MAP.has(key)) {
      fail(`Unknown flag: ${key}`);
    }

    if (arg.includes('=')) {
      process.env[FLAG_ENV_MAP.get(key)] = value;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      process.env[FLAG_ENV_MAP.get(key)] = next;
      index += 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(key)) {
      process.env[FLAG_ENV_MAP.get(key)] = 'true';
      continue;
    }

    fail(`Missing value for ${key}`);
  }
}

function applyDefaults() {
  if (!process.env.INPUT_API_KEY && process.env.RB_API_KEY) {
    process.env.INPUT_API_KEY = process.env.RB_API_KEY;
  }
  if (!process.env.INPUT_SKILL_DIR) {
    process.env.INPUT_SKILL_DIR = '.';
  }
  if (!process.env.INPUT_ANNOTATE) {
    process.env.INPUT_ANNOTATE = 'false';
  }
  if (!process.env.INPUT_STAMP_REPO_COMMIT) {
    process.env.INPUT_STAMP_REPO_COMMIT = 'true';
  }
  if (!process.env.INPUT_POLL_TIMEOUT_MS) {
    process.env.INPUT_POLL_TIMEOUT_MS = '720000';
  }
  if (!process.env.INPUT_POLL_INTERVAL_MS) {
    process.env.INPUT_POLL_INTERVAL_MS = '4000';
  }
}

async function run() {
  parseArgs(process.argv.slice(2));
  applyDefaults();

  if (!process.env.INPUT_API_KEY) {
    fail('Missing API key. Pass --api-key or set RB_API_KEY.');
  }

  const entrypointUrl = pathToFileURL(
    path.resolve(__dirname, '..', 'entrypoint.mjs'),
  ).href;
  await import(entrypointUrl);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
