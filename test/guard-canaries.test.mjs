import assert from 'node:assert/strict';

import { computeHcs28TrustPreview } from '../bin/lib/hcs-28.mjs';
import { buildManagedCommentBody, buildManagedCommentMarker } from '../bin/lib/managed-comments.mjs';

const basePackage = {
  skillName: 'registry-broker-skill-canary',
  skillVersion: '1.0.0',
  skillDescription:
    'First-party Guard canary that verifies skill provenance, domain proof, and maintainer remediation guidance.',
  repoUrl: 'https://github.com/hashgraph-online/registry-broker-skills',
  commitSha: 'abc123def456abc123def456abc123def456abcd',
  homepage: 'https://skills.example.com',
  tags: ['guard', 'registry', 'skill'],
  languages: ['typescript'],
  files: [
    { name: 'SKILL.md', sizeBytes: 480, mimeType: 'text/markdown', role: 'skill-md' },
    { name: 'skill.json', sizeBytes: 320, mimeType: 'application/json', role: 'skill-json' },
  ],
};

const nonAttestedPreview = await computeHcs28TrustPreview({
  mode: 'monitor',
  packageState: basePackage,
  publishedSkill: {
    verified: false,
    upvotes: 3,
    safety: { score: 82 },
    verificationSignals: {
      publisherBound: { ok: false },
      repoCommitIntegrity: { ok: true },
      manifestIntegrity: { ok: true },
      domainProof: { ok: false },
    },
  },
  includeExternal: false,
});

const attestedPreview = await computeHcs28TrustPreview({
  mode: 'monitor',
  packageState: basePackage,
  publishedSkill: {
    verified: true,
    upvotes: 18,
    safety: { score: 97 },
    verificationSignals: {
      publisherBound: { ok: true },
      repoCommitIntegrity: { ok: true },
      manifestIntegrity: { ok: true },
      domainProof: { ok: true },
    },
  },
  includeExternal: false,
});

assert.equal(nonAttestedPreview.trustScores['verification.publisher-bound.score'], 0);
assert.equal(nonAttestedPreview.trustScores['verification.domain-proof.score'], 0);
assert.equal(attestedPreview.trustScores['verification.publisher-bound.score'], 100);
assert.equal(attestedPreview.trustScores['verification.domain-proof.score'], 100);
assert.ok(attestedPreview.trustScores.total > nonAttestedPreview.trustScores.total);

const remediationBody = buildManagedCommentBody({
  marker: buildManagedCommentMarker('guard-canary-remediation'),
  stateSignature: 'guard-canary-signature',
  mode: 'monitor',
  skillName: basePackage.skillName,
  skillVersion: basePackage.skillVersion,
  trustTier: 'validated',
  publishReadiness: 'ready',
  missingRequirements: ['repo_url'],
  estimatedCreditsRange: '',
  statusUrl: 'https://hol.org/registry/skills/registry-broker-skill-canary',
  purchaseUrl: 'https://hol.org/registry/skills/submit',
  publishUrl: 'https://hol.org/registry/skills/publish',
  verificationUrl: 'https://hol.org/registry/skills/verify',
  nextActions: [
    {
      label: 'Verify domain proof',
      description: 'Link the canary domain and republish with stronger provenance.',
      href: 'https://hol.org/registry/skills/verify',
    },
  ],
  hcs28: nonAttestedPreview,
});

assert.match(remediationBody, /Repository provenance missing/u);
assert.match(remediationBody, /link your domain so HOL can verify the TXT record/u);
assert.match(remediationBody, /\*\*Recommended next step:\*\* \[Verify domain proof\]/u);

process.stdout.write('guard canary proof tests passed\n');
