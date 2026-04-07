const DEFAULT_MARKER_PREFIX = 'skill-publish-managed';
const DEFAULT_SUBMIT_URL = 'https://hol.org/registry/skills/submit';

export function buildManagedCommentMarker(groupKey) {
  const normalizedGroupKey = String(groupKey ?? '').trim() || 'default';
  return `<!-- ${DEFAULT_MARKER_PREFIX}:${normalizedGroupKey} -->`;
}

export function buildManagedCommentStateSignature(params) {
  return JSON.stringify({
    mode: params.mode ?? '',
    trustTier: params.trustTier ?? '',
    publishReadiness: params.publishReadiness ?? '',
    missingRequirements: Array.isArray(params.missingRequirements)
      ? [...params.missingRequirements].sort()
      : [],
    estimatedCreditsRange: params.estimatedCreditsRange ?? '',
    statusUrl: params.statusUrl ?? '',
    hcs28Total:
      params.hcs28 &&
      typeof params.hcs28 === 'object' &&
      params.hcs28.trustScores &&
      typeof params.hcs28.trustScores.total === 'number'
        ? params.hcs28.trustScores.total
        : '',
  });
}

export function extractManagedCommentState(body) {
  const text = String(body ?? '');
  const match = text.match(/<!-- skill-publish-state:(.+?) -->/u);
  return match?.[1]?.trim() ?? null;
}

export function shouldPublishManagedComment(params) {
  const commentMode = String(params.commentMode ?? 'off').trim().toLowerCase();
  if (commentMode === 'off') {
    return false;
  }
  if (commentMode === 'always') {
    return true;
  }
  const hasFailures = params.publishReadiness !== 'ready';
  if (commentMode === 'failures-only') {
    return hasFailures;
  }
  if (commentMode === 'state-changes') {
    if (hasFailures) {
      return true;
    }
    return params.commentOnSuccess === true;
  }
  return false;
}

const readScore = (hcs28, key) => {
  const value = hcs28?.trustScores?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const formatScore = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const formatSignalStatus = (params) => {
  const { key, score } = params;
  if (score === null) {
    return 'Pending';
  }
  if (key === 'verification.domain-proof.score') {
    return score >= 100 ? 'Verified' : 'Link domain on HOL';
  }
  if (key === 'verification.manifest-integrity.score') {
    return score >= 100 ? 'Pinned' : 'Republish package';
  }
  if (key === 'verification.repo-commit-integrity.score') {
    return score >= 100 ? 'Bound to repo' : 'Align repo commit';
  }
  if (key === 'safety.cisco-scan.score') {
    if (score >= 90) {
      return 'Strong';
    }
    if (score >= 70) {
      return 'Review findings';
    }
    return 'Needs hardening';
  }
  if (key === 'repository.health.score') {
    if (score >= 80) {
      return 'Healthy';
    }
    if (score >= 60) {
      return 'Watchlist';
    }
    return 'Needs cleanup';
  }
  return score >= 100 ? 'Passed' : 'In progress';
};

const buildImprovementTips = (params) => {
  const tips = [];
  const domainProofScore = readScore(params.hcs28, 'verification.domain-proof.score');
  const repoIntegrityScore = readScore(params.hcs28, 'verification.repo-commit-integrity.score');
  const manifestIntegrityScore = readScore(params.hcs28, 'verification.manifest-integrity.score');
  const ciscoScore = readScore(params.hcs28, 'safety.cisco-scan.score');
  const submitUrl = String(params.submitUrl || params.purchaseUrl || DEFAULT_SUBMIT_URL).trim();
  const publishGuideUrl = String(params.publishUrl || DEFAULT_SUBMIT_URL).trim();
  const securityUrl = String(
    params.statusUrl ? `${params.statusUrl}${params.statusUrl.includes('?') ? '&' : '?'}tab=security-breakdown` : '',
  ).trim();

  if (domainProofScore !== null && domainProofScore < 100) {
    tips.push(
      `- Domain proof: open ${formatLink('HOL Skills submit', submitUrl)}, submit or manage this skill there, and link your domain so HOL can verify the TXT record.`,
    );
  }
  if (repoIntegrityScore !== null && repoIntegrityScore < 100) {
    tips.push(
      `- Repo + commit integrity: use ${formatLink('the official publish workflow', publishGuideUrl)} so the release is stamped to the exact repo commit that produced it.`,
    );
  }
  if (manifestIntegrityScore !== null && manifestIntegrityScore < 100) {
    tips.push(
      `- Manifest integrity: republish from the packaged skill directory so HOL can pin a manifest that matches the shipped files.`,
    );
  }
  if (ciscoScore !== null && ciscoScore < 100) {
    const securityTarget = securityUrl || params.statusUrl || publishGuideUrl;
    tips.push(
      `- Cisco safety scan: review ${formatLink('the security breakdown', securityTarget)} and harden the flagged files before the next publish.`,
    );
  }

  return tips;
};

const buildSignalRows = (hcs28) => {
  const signals = [
    ['Domain proof', 'verification.domain-proof.score'],
    ['Manifest integrity', 'verification.manifest-integrity.score'],
    ['Repo + commit integrity', 'verification.repo-commit-integrity.score'],
    ['Cisco safety scan', 'safety.cisco-scan.score'],
    ['Repository health', 'repository.health.score'],
  ];
  return signals.map(([label, key]) => {
    const score = readScore(hcs28, key);
    return `| ${label} | ${formatScore(score)} | ${formatSignalStatus({ key, score })} |`;
  });
};

const formatLink = (label, href) => {
  const normalizedHref = String(href ?? '').trim();
  return normalizedHref ? `[${label}](${normalizedHref})` : label;
};

const normalizeNextAction = (action) => {
  if (typeof action === 'string') {
    const trimmed = action.trim();
    return trimmed
      ? {
          label: trimmed,
          description: '',
          href: '',
        }
      : null;
  }
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    const label = String(action.label ?? '').trim();
    if (!label) {
      return null;
    }
    return {
      label,
      description: String(action.description ?? '').trim(),
      href: String(action.href ?? action.url ?? '').trim(),
    };
  }
  return null;
};

export function buildManagedCommentBody(params) {
  const nextActions = Array.isArray(params.nextActions)
    ? params.nextActions.map(normalizeNextAction).filter(Boolean)
    : [];
  const totalScore = readScore(params.hcs28, 'total');
  const submitUrl = String(params.submitUrl || params.purchaseUrl || DEFAULT_SUBMIT_URL).trim();
  const lines = [];
  lines.push(params.marker);
  lines.push(`<!-- skill-publish-state:${params.stateSignature} -->`);
  lines.push('## HOL skill scorecard');
  lines.push('');
  lines.push(
    `> \`${params.skillName}@${params.skillVersion}\` checked in \`${params.mode}\` mode.`,
  );
  lines.push('');
  lines.push('| HCS-28 total | Trust tier | Publish readiness |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| ${formatScore(totalScore)} | \`${params.trustTier}\` | \`${params.publishReadiness}\` |`,
  );
  if (Array.isArray(params.missingRequirements) && params.missingRequirements.length > 0) {
    lines.push('');
    lines.push(`**Missing requirements:** \`${params.missingRequirements.join(', ')}\``);
  }
  if (params.estimatedCreditsRange) {
    lines.push(`**Estimated credits:** \`${params.estimatedCreditsRange}\``);
  }
  lines.push('');
  lines.push('### Signal breakdown');
  lines.push('');
  lines.push('| Signal | Score | Status |');
  lines.push('| --- | --- | --- |');
  lines.push(...buildSignalRows(params.hcs28));
  lines.push('');
  const linkLines = [];
  if (params.statusUrl) {
    linkLines.push(`- Status page: ${formatLink('Open on HOL', params.statusUrl)}`);
  }
  if (params.purchaseUrl) {
    linkLines.push(`- Purchase credits: ${formatLink('Top up credits', params.purchaseUrl)}`);
  }
  if (params.publishUrl) {
    linkLines.push(`- Publish guide: ${formatLink('Review publish flow', params.publishUrl)}`);
  }
  if (params.verificationUrl) {
    linkLines.push(
      `- Verification flow: ${formatLink('Set up verification', params.verificationUrl)}`,
    );
  }
  if (!params.purchaseUrl && submitUrl) {
    linkLines.push(`- Manage on HOL: ${formatLink('Open submit flow', submitUrl)}`);
  }
  if (linkLines.length > 0) {
    lines.push('### Links');
    lines.push('');
    lines.push(...linkLines);
  }
  const improvementTips = buildImprovementTips(params);
  if (improvementTips.length > 0) {
    lines.push('');
    lines.push('### How to improve this score');
    lines.push('');
    lines.push(...improvementTips);
  }
  if (nextActions.length > 0) {
    lines.push('');
    lines.push('### Recommended next step');
    lines.push('');
    lines.push(
      `**Recommended next step:** ${formatLink(nextActions[0].label, nextActions[0].href)}`,
    );
    if (nextActions[0].description) {
      lines.push('');
      lines.push(nextActions[0].description);
    }
  }
  return lines.join('\n');
}
