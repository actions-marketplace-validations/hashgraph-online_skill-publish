import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures');

function parseGithubOutput(text) {
  const lines = text.split('\n');
  const output = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf('<<');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex);
    const delimiter = line.slice(separatorIndex + 2);
    const valueLines = [];
    index += 1;
    while (index < lines.length && lines[index] !== delimiter) {
      valueLines.push(lines[index]);
      index += 1;
    }
    output.set(key, valueLines.join('\n'));
  }
  return output;
}

async function listenServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function runActionMode(fixtureName, mode, options = {}) {
  const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
  const githubOutputPath = path.join(runtimeRoot, 'github-output.txt');
  const githubSummaryPath = path.join(runtimeRoot, 'github-summary.md');
  const githubEventPath = path.join(runtimeRoot, 'github-event.json');
  await mkdir(runtimeRoot, { recursive: true });
  const skillDir = path.join(fixtureRoot, fixtureName);
  if (options.eventPayload) {
    await writeFile(
      githubEventPath,
      JSON.stringify(options.eventPayload, null, 2),
      'utf8',
    );
  }

  try {
    const result = await execFileAsync('node', ['entrypoint.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INPUT_MODE: mode,
        INPUT_API_BASE_URL: options.apiBaseUrl ?? 'https://hol.org/registry/api/v1',
        INPUT_SKILL_DIR: skillDir,
        INPUT_ANNOTATE: 'false',
        INPUT_PREVIEW_UPLOAD: options.previewUpload ?? 'true',
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_STEP_SUMMARY: githubSummaryPath,
        GITHUB_REPOSITORY: 'hashgraph-online/valid-skill',
        GITHUB_SERVER_URL: 'https://github.com',
        ...(options.githubApiUrl ? { GITHUB_API_URL: options.githubApiUrl } : {}),
        GITHUB_SHA: 'abc123def456abc123def456abc123def456abcd',
        GITHUB_REF: 'refs/pull/5/merge',
        GITHUB_EVENT_NAME: 'pull_request',
        ...(options.eventPayload ? { GITHUB_EVENT_PATH: githubEventPath } : {}),
        ...options.extraEnv,
      },
    });

    return {
      ...result,
      githubOutputPath,
      runtimeRoot,
    };
  } catch (error) {
    return {
      error,
      githubOutputPath,
      runtimeRoot,
    };
  }
}

const validRun = await runActionMode('valid-skill', 'validate');
assert.equal(validRun.error, undefined, validRun.error?.stderr ?? validRun.error?.message);
const githubOutput = parseGithubOutput(await readFile(validRun.githubOutputPath, 'utf8'));
assert.equal(githubOutput.get('skill-name'), 'valid-skill');
assert.equal(githubOutput.get('skill-version'), '1.0.0');
assert.ok(githubOutput.has('preview-json'));
assert.ok(githubOutput.has('preview-json-path'));
assert.ok(githubOutput.has('next-actions'));
assert.equal(githubOutput.get('trust-tier'), 'validated');
assert.equal(githubOutput.get('publish-readiness'), 'ready');
assert.equal(githubOutput.get('missing-requirements'), '[]');
assert.equal(githubOutput.get('estimated-credits-range'), '');
assert.equal(githubOutput.get('managed-comment-url'), '');
const previewJson = JSON.parse(githubOutput.get('preview-json'));
const previewJsonPath = githubOutput.get('preview-json-path');
assert.ok(previewJsonPath);
const previewJsonOnDisk = JSON.parse(await readFile(previewJsonPath, 'utf8'));
assert.equal(previewJson.schema_version, 'skill-preview.v1');
assert.match(previewJson.preview_id, /^preview_[a-f0-9]{32}$/u);
assert.equal(
  previewJson.workflow_run_url,
  'https://github.com/hashgraph-online/valid-skill/actions',
);
assert.equal(previewJson.name, 'valid-skill');
assert.equal(previewJson.validation_status, 'passed');
assert.deepEqual(previewJsonOnDisk, previewJson);
assert.equal(githubOutput.get('status-url'), '');

const previewUploadRequests = [];
const quotePreviewRequests = [];
const managedCommentRequests = [];
const oidcServer = await listenServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let chunks = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      chunks += chunk;
    });
    request.on('end', () => resolve(chunks));
  });

  if (request.url?.startsWith('/oidc')) {
    assert.equal(request.headers.authorization, 'Bearer broker-test-token');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value: 'github-oidc-token' }));
    return;
  }

  if (request.url === '/api/v1/skills/preview/github-oidc') {
    previewUploadRequests.push({
      authorization: request.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'preview-record-1',
        previewId: 'preview_demo',
        source: 'github-oidc',
        generatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-11T10:00:00.000Z',
        statusUrl: 'https://hol.org/registry/skills/valid-skill',
        authoritative: false,
        report: JSON.parse(body),
      }),
    );
    return;
  }

  if (request.url === '/api/v1/skills/quote-preview') {
    quotePreviewRequests.push(body ? JSON.parse(body) : null);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        estimatedCredits: {
          min: 64,
          max: 76,
        },
        estimatedHbar: {
          min: 0.64,
          max: 0.76,
        },
        pricingVersion: 'heuristic-v1',
        assumptions: [
          'Estimate derived from package file count and total bytes.',
        ],
        purchaseUrl: 'https://hol.org/registry/skills/submit',
        publishUrl: 'https://hol.org/registry/skills/submit',
        verificationUrl: 'https://hol.org/registry/skills/submit',
      }),
    );
    return;
  }

  if (
    request.url?.startsWith(
      '/repos/hashgraph-online/valid-skill/issues/5/comments',
    )
  ) {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([]));
      return;
    }
    if (request.method === 'POST') {
      managedCommentRequests.push(body ? JSON.parse(body) : null);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 501,
          html_url:
            'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
        }),
      );
      return;
    }
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

const uploadedRun = await runActionMode('valid-skill', 'validate', {
  apiBaseUrl: `${oidcServer.baseUrl}/api/v1`,
  extraEnv: {
    ACTIONS_ID_TOKEN_REQUEST_URL: `${oidcServer.baseUrl}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'broker-test-token',
  },
});
assert.equal(uploadedRun.error, undefined, uploadedRun.error?.stderr ?? uploadedRun.error?.message);
const uploadedOutput = parseGithubOutput(await readFile(uploadedRun.githubOutputPath, 'utf8'));
assert.equal(uploadedOutput.get('status-url'), 'https://hol.org/registry/skills/valid-skill');
assert.equal(previewUploadRequests.length, 1);
assert.equal(previewUploadRequests[0].authorization, 'Bearer github-oidc-token');
assert.equal(previewUploadRequests[0].body.name, 'valid-skill');

const monitorRun = await runActionMode('valid-skill', 'monitor', {
  previewUpload: 'false',
});
assert.equal(monitorRun.error, undefined, monitorRun.error?.stderr ?? monitorRun.error?.message);
const monitorOutput = parseGithubOutput(await readFile(monitorRun.githubOutputPath, 'utf8'));
assert.equal(monitorOutput.get('trust-tier'), 'validated');
assert.equal(monitorOutput.get('publish-readiness'), 'ready');
assert.equal(monitorOutput.get('missing-requirements'), '[]');
assert.ok(monitorOutput.has('next-actions'));

const quotePreviewRun = await runActionMode('valid-skill', 'validate', {
  apiBaseUrl: `${oidcServer.baseUrl}/api/v1`,
  previewUpload: 'false',
  extraEnv: {
    INPUT_QUOTE_PREVIEW: 'true',
  },
});
assert.equal(
  quotePreviewRun.error,
  undefined,
  quotePreviewRun.error?.stderr ?? quotePreviewRun.error?.message,
);
const quotePreviewOutput = parseGithubOutput(
  await readFile(quotePreviewRun.githubOutputPath, 'utf8'),
);
assert.equal(quotePreviewOutput.get('estimated-credits-range'), '64-76');
assert.equal(
  quotePreviewOutput.get('purchase-url'),
  'https://hol.org/registry/skills/submit',
);
assert.equal(quotePreviewRequests.length, 1);
assert.equal(quotePreviewRequests[0]?.name, 'valid-skill');
assert.equal(quotePreviewRequests[0]?.version, '1.0.0');

const managedCommentRun = await runActionMode('valid-skill', 'monitor', {
  apiBaseUrl: `${oidcServer.baseUrl}/api/v1`,
  previewUpload: 'false',
  githubApiUrl: oidcServer.baseUrl,
  eventPayload: {
    pull_request: {
      number: 5,
    },
  },
  extraEnv: {
    INPUT_COMMENT_MODE: 'always',
    INPUT_GITHUB_TOKEN: 'ghs_test_token',
  },
});
assert.equal(
  managedCommentRun.error,
  undefined,
  managedCommentRun.error?.stderr ?? managedCommentRun.error?.message,
);
const managedCommentOutput = parseGithubOutput(
  await readFile(managedCommentRun.githubOutputPath, 'utf8'),
);
assert.equal(
  managedCommentOutput.get('managed-comment-url'),
  'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
);
assert.equal(managedCommentRequests.length, 1);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /HOL skill lifecycle/u,
);

const missingSkillMdRun = await runActionMode('missing-skill-md', 'validate');
assert.ok(missingSkillMdRun.error);
assert.match(
  `${missingSkillMdRun.error.stderr ?? ''}${missingSkillMdRun.error.message ?? ''}`,
  /Missing required file: .*SKILL\.md/u,
);

const missingSkillJsonRun = await runActionMode('missing-skill-json', 'validate');
assert.equal(
  missingSkillJsonRun.error,
  undefined,
  missingSkillJsonRun.error?.stderr ?? missingSkillJsonRun.error?.message,
);
const missingSkillJsonOutput = parseGithubOutput(
  await readFile(missingSkillJsonRun.githubOutputPath, 'utf8'),
);
assert.equal(missingSkillJsonOutput.get('skill-name'), 'missing-skill-json');
assert.equal(missingSkillJsonOutput.get('skill-version'), '1.0.0');
assert.ok(missingSkillJsonOutput.has('preview-json'));
assert.equal(missingSkillJsonOutput.get('trust-tier'), 'validated');
assert.equal(missingSkillJsonOutput.get('publish-readiness'), 'ready');

const invalidJsonRun = await runActionMode('invalid-skill-json', 'validate');
assert.ok(invalidJsonRun.error);
assert.match(
  `${invalidJsonRun.error.stderr ?? ''}${invalidJsonRun.error.message ?? ''}`,
  /skill\.json is not valid JSON/u,
);

await rm(validRun.runtimeRoot, { recursive: true, force: true });
await oidcServer.close();
await rm(uploadedRun.runtimeRoot, { recursive: true, force: true });
await rm(monitorRun.runtimeRoot, { recursive: true, force: true });
await rm(quotePreviewRun.runtimeRoot, { recursive: true, force: true });
await rm(managedCommentRun.runtimeRoot, { recursive: true, force: true });
if (missingSkillMdRun.runtimeRoot) {
  await rm(missingSkillMdRun.runtimeRoot, { recursive: true, force: true });
}
if (missingSkillJsonRun.runtimeRoot) {
  await rm(missingSkillJsonRun.runtimeRoot, { recursive: true, force: true });
}
if (invalidJsonRun.runtimeRoot) {
  await rm(invalidJsonRun.runtimeRoot, { recursive: true, force: true });
}

process.stdout.write('validate preview integration test passed\n');
