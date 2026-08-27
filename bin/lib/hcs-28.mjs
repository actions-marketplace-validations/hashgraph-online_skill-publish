import { resolveRepositoryHealthScore } from './hcs-28-github-health.mjs';

const HCS_28_PROFILE = Object.freeze({
  id: 'hcs-28/baseline',
  version: '0.1',
});

const VERIFICATION_WEIGHTS = Object.freeze({
  'verification.review-status.score': 0.5,
  'verification.publisher-bound.score': 0.2,
  'verification.repo-commit-integrity.score': 0.4,
  'verification.manifest-integrity.score': 0.3,
  'verification.domain-proof.score': 0.1,
});

const METADATA_WEIGHTS = Object.freeze({
  'metadata.links.score': 0.3,
  'metadata.description.score': 0.25,
  'metadata.taxonomy.score': 0.2,
  'metadata.provenance.score': 0.25,
});

const BASELINE_WEIGHTS = Object.freeze({
  ...VERIFICATION_WEIGHTS,
  ...METADATA_WEIGHTS,
  'upvotes.score': 1,
  'safety.cisco-scan.score': 1,
  'repository.health.score': 1,
});

const clampScore = (value) => Math.min(100, Math.max(0, value));
const roundScore = (value) => Math.round(clampScore(value) * 100) / 100;

const parseString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseStringArray = (value) =>
  Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const normalizeVerificationSignal = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ok === 'boolean') {
    return value.ok;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const hasRole = (files, role) =>
  Array.isArray(files) && files.some((file) => file && file.role === role);

const resolveDomainApplicability = (packageState, publishedSkill) =>
  Boolean(
    parseString(packageState.homepage) ||
      parseString(packageState.domain) ||
      parseString(publishedSkill?.homepage) ||
      parseString(publishedSkill?.domain) ||
      normalizeVerificationSignal(publishedSkill?.verificationSignals?.domainProof) !== null,
  );

const computeMetadataLinks = (packageState, publishedSkill) => {
  const homepage = parseString(packageState.homepage) || parseString(publishedSkill?.homepage);
  const repoUrl = parseString(packageState.repoUrl) || parseString(publishedSkill?.repo);
  if (homepage && repoUrl) {
    return 100;
  }
  if (homepage || repoUrl) {
    return 60;
  }
  return 0;
};

const computeMetadataDescription = (packageState, publishedSkill) => {
  const description =
    parseString(packageState.skillDescription) || parseString(publishedSkill?.description);
  const length = description.length;
  if (length >= 160) {
    return 100;
  }
  if (length >= 80) {
    return 85;
  }
  if (length >= 30) {
    return 65;
  }
  if (length >= 10) {
    return 40;
  }
  return 0;
};

const computeMetadataTaxonomy = (packageState, publishedSkill) => {
  const tags = parseStringArray(packageState.tags?.length ? packageState.tags : publishedSkill?.tags);
  const languages = parseStringArray(
    packageState.languages?.length ? packageState.languages : publishedSkill?.languages,
  );
  const tagCount = tags.length;
  const languageCount = languages.length;
  if (tagCount >= 3 && languageCount >= 1) {
    return 100;
  }
  if (tagCount >= 1 && languageCount >= 1) {
    return 85;
  }
  if (tagCount >= 3) {
    return 70;
  }
  if (tagCount >= 1) {
    return 55;
  }
  if (languageCount >= 1) {
    return 35;
  }
  return 0;
};

const computeMetadataProvenance = (packageState, publishedSkill) => {
  const repoUrl = parseString(packageState.repoUrl) || parseString(publishedSkill?.repo);
  const commitSha = parseString(packageState.commitSha) || parseString(publishedSkill?.commit);
  if (repoUrl && commitSha) {
    return 100;
  }
  if (repoUrl) {
    return 70;
  }
  if (commitSha) {
    return 40;
  }
  return 0;
};

const computeUpvotesScore = (publishedSkill) => {
  const upvotes = Number(publishedSkill?.upvotes ?? 0);
  if (!Number.isFinite(upvotes) || upvotes <= 0) {
    return 0;
  }
  return roundScore(100 * (1 - Math.exp(-Math.max(0, upvotes) / 20)));
};

const computeSafetyScore = (publishedSkill) => {
  const safetyScore = Number(
    publishedSkill?.safety?.score ??
      publishedSkill?.safetyScore ??
      publishedSkill?.trustScores?.['safety.cisco-scan.score'] ??
      0,
  );
  return Number.isFinite(safetyScore) ? roundScore(safetyScore) : 0;
};

const computeVerificationScores = (params) => {
  const signalSource = params.publishedSkill?.verificationSignals ?? {};
  const compatibilityRepoIntegrity =
    parseString(params.packageState.repoUrl) && parseString(params.packageState.commitSha)
      ? 100
      : 0;
  const compatibilityManifestIntegrity = hasRole(params.packageState.files, 'skill-md') ? 100 : 0;
  const domainApplicable = resolveDomainApplicability(params.packageState, params.publishedSkill);
  const publisherBound = normalizeVerificationSignal(signalSource.publisherBound);
  const repoCommitIntegrity = normalizeVerificationSignal(signalSource.repoCommitIntegrity);
  const manifestIntegrity = normalizeVerificationSignal(signalSource.manifestIntegrity);
  const domainProof = normalizeVerificationSignal(signalSource.domainProof);
  const scores = {
    'verification.review-status.score': params.publishedSkill?.verified === true ? 100 : 0,
    'verification.publisher-bound.score': publisherBound === true ? 100 : 0,
    'verification.repo-commit-integrity.score':
      repoCommitIntegrity === true
        ? 100
        : repoCommitIntegrity === false
          ? 0
          : compatibilityRepoIntegrity,
    'verification.manifest-integrity.score':
      manifestIntegrity === true
        ? 100
        : manifestIntegrity === false
          ? 0
          : compatibilityManifestIntegrity,
  };
  if (domainApplicable) {
    scores['verification.domain-proof.score'] = domainProof === true ? 100 : 0;
  }
  return scores;
};

const computeMetadataScores = (packageState, publishedSkill) => ({
  'metadata.links.score': computeMetadataLinks(packageState, publishedSkill),
  'metadata.description.score': computeMetadataDescription(packageState, publishedSkill),
  'metadata.taxonomy.score': computeMetadataTaxonomy(packageState, publishedSkill),
  'metadata.provenance.score': computeMetadataProvenance(packageState, publishedSkill),
});

const aggregateWeightedScores = (scores, weights) => {
  const applicableEntries = Object.entries(weights).filter(([key]) =>
    Number.isFinite(scores[key]),
  );
  if (applicableEntries.length === 0) {
    return 0;
  }
  const denominator = applicableEntries.reduce((total, [, weight]) => total + weight, 0);
  const numerator = applicableEntries.reduce(
    (total, [key, weight]) => total + scores[key] * weight,
    0,
  );
  return denominator > 0 ? roundScore(numerator / denominator) : 0;
};

export function buildHcs28Fallback(params) {
  const computedAt = parseString(params.computedAt) || new Date().toISOString();
  return {
    subject: {
      network: parseString(params.publishedSkill?.network) || 'preview',
      discovery_topic_id: parseString(params.publishedSkill?.directoryTopicId),
      skill_uid: String(
        params.publishedSkill?.skillUid ??
          params.publishedSkill?.directorySequenceNumber ??
          '',
      ).trim(),
      version: parseString(params.packageState.skillVersion),
    },
    profile: {
      ...HCS_28_PROFILE,
    },
    execution: {
      includeExternal: params.includeExternal === true,
      computedAt,
      mode: parseString(params.mode),
      compatibilityMode: 'preview-local-integrity-v1',
    },
    trustScores: {
      total: 0,
    },
    evidence: {
      repositoryHealth: null,
      fallback: true,
      ...(params.errorMessage ? { error: params.errorMessage } : {}),
    },
  };
}

export async function computeHcs28TrustPreview(params) {
  const computedAt = parseString(params.computedAt) || new Date().toISOString();
  const verificationScores = computeVerificationScores(params);
  const metadataScores = computeMetadataScores(params.packageState, params.publishedSkill);
  const scores = {
    ...verificationScores,
    ...metadataScores,
    'upvotes.score': computeUpvotesScore(params.publishedSkill),
    'safety.cisco-scan.score': computeSafetyScore(params.publishedSkill),
  };
  const repositoryHealth = await resolveRepositoryHealthScore({
    includeExternal: params.includeExternal === true,
    packageState: params.packageState,
    publishedSkill: params.publishedSkill,
    repoCandidates: params.repoCandidates,
    fetchGitHubRepoHealth: params.fetchGitHubRepoHealth,
    fetchImplementation: params.fetchImplementation,
    githubApiBaseUrl: params.githubApiBaseUrl,
    githubToken: params.githubToken,
    computedAt,
  });
  if (repositoryHealth && Number.isFinite(repositoryHealth.score)) {
    scores['repository.health.score'] = repositoryHealth.score;
  }
  const preview = buildHcs28Fallback({
    ...params,
    computedAt,
  });
  preview.trustScores = {
    ...scores,
    'verification.score': aggregateWeightedScores(scores, VERIFICATION_WEIGHTS),
    'metadata.score': aggregateWeightedScores(scores, METADATA_WEIGHTS),
    total: aggregateWeightedScores(scores, BASELINE_WEIGHTS),
  };
  preview.evidence = {
    repositoryHealth: repositoryHealth?.evidence ?? null,
  };
  return preview;
}
