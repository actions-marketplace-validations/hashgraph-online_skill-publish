import assert from 'node:assert/strict';

import { computeHcs28TrustPreview } from '../bin/lib/hcs-28.mjs';

const basePackage = {
  skillName: 'weather-skill',
  skillVersion: '1.2.3',
  skillDescription:
    'Get deterministic weather summaries, forecast windows, and current-condition snapshots.',
  repoUrl: 'https://github.com/hashgraph-online/weather-skill',
  commitSha: 'abc123def456abc123def456abc123def456abcd',
  homepage: 'https://weather.example.com',
  tags: ['weather', 'forecast', 'data'],
  languages: ['typescript'],
  category: 'utility',
  files: [
    { name: 'SKILL.md', sizeBytes: 320, mimeType: 'text/markdown', role: 'skill-md' },
    { name: 'skill.json', sizeBytes: 240, mimeType: 'application/json', role: 'skill-json' },
  ],
};

const validatePreview = await computeHcs28TrustPreview({
  mode: 'validate',
  packageState: basePackage,
  publishedSkill: null,
  includeExternal: false,
});

assert.equal(validatePreview.profile.id, 'hcs-28/baseline');
assert.equal(validatePreview.profile.version, '0.1');
assert.equal(validatePreview.execution.includeExternal, false);
assert.equal(validatePreview.trustScores['verification.review-status.score'], 0);
assert.equal(validatePreview.trustScores['verification.publisher-bound.score'], 0);
assert.equal(validatePreview.trustScores['verification.repo-commit-integrity.score'], 100);
assert.equal(validatePreview.trustScores['verification.manifest-integrity.score'], 100);
assert.equal(validatePreview.trustScores['metadata.links.score'], 100);
assert.equal(validatePreview.trustScores['metadata.description.score'], 85);
assert.equal(validatePreview.trustScores['metadata.taxonomy.score'], 100);
assert.equal(validatePreview.trustScores['metadata.provenance.score'], 100);
assert.equal(validatePreview.trustScores['upvotes.score'], 0);
assert.equal(validatePreview.trustScores['safety.cisco-scan.score'], 0);
assert.equal(validatePreview.trustScores['verification.domain-proof.score'], 0);
assert.ok(
  typeof validatePreview.trustScores.total === 'number' &&
    validatePreview.trustScores.total > 0 &&
    validatePreview.trustScores.total < 100,
);

const monitorPreview = await computeHcs28TrustPreview({
  mode: 'monitor',
  packageState: basePackage,
  publishedSkill: {
    verified: true,
    upvotes: 23,
    safety: { score: 94 },
    verificationSignals: {
      publisherBound: { ok: true },
      repoCommitIntegrity: { ok: true },
      manifestIntegrity: { ok: true },
      domainProof: { ok: true },
    },
  },
  includeExternal: true,
  fetchGitHubRepoHealth: async () => ({
    score: 72.34,
  }),
});

assert.equal(monitorPreview.execution.includeExternal, true);
assert.equal(monitorPreview.trustScores['verification.review-status.score'], 100);
assert.equal(monitorPreview.trustScores['verification.publisher-bound.score'], 100);
assert.equal(monitorPreview.trustScores['verification.repo-commit-integrity.score'], 100);
assert.equal(monitorPreview.trustScores['verification.manifest-integrity.score'], 100);
assert.equal(monitorPreview.trustScores['verification.domain-proof.score'], 100);
assert.equal(monitorPreview.trustScores['metadata.links.score'], 100);
assert.equal(monitorPreview.trustScores['metadata.description.score'], 85);
assert.equal(monitorPreview.trustScores['metadata.taxonomy.score'], 100);
assert.equal(monitorPreview.trustScores['metadata.provenance.score'], 100);
assert.ok(monitorPreview.trustScores['upvotes.score'] > 0);
assert.equal(monitorPreview.trustScores['safety.cisco-scan.score'], 94);
assert.equal(monitorPreview.trustScores['repository.health.score'], 72.34);
assert.ok(
  typeof monitorPreview.trustScores.total === 'number' &&
    monitorPreview.trustScores.total > validatePreview.trustScores.total,
);

process.stdout.write('hcs-28 trust preview test passed\n');
