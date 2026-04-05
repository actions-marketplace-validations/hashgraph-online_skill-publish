const DEFAULT_MARKER_PREFIX = 'skill-publish-managed';

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

export function buildManagedCommentBody(params) {
  const lines = [];
  lines.push(params.marker);
  lines.push(`<!-- skill-publish-state:${params.stateSignature} -->`);
  lines.push('### HOL skill lifecycle');
  lines.push('');
  lines.push(`- Mode: \`${params.mode}\``);
  lines.push(`- Skill: \`${params.skillName}@${params.skillVersion}\``);
  lines.push(`- Trust tier: \`${params.trustTier}\``);
  lines.push(`- Publish readiness: \`${params.publishReadiness}\``);
  if (Array.isArray(params.missingRequirements) && params.missingRequirements.length > 0) {
    lines.push(`- Missing requirements: \`${params.missingRequirements.join(', ')}\``);
  }
  if (params.estimatedCreditsRange) {
    lines.push(`- Estimated credits: \`${params.estimatedCreditsRange}\``);
  }
  lines.push('');
  if (params.statusUrl) {
    lines.push(`- Status page: ${params.statusUrl}`);
  }
  if (params.purchaseUrl) {
    lines.push(`- Purchase credits: ${params.purchaseUrl}`);
  }
  if (params.publishUrl) {
    lines.push(`- Publish guide: ${params.publishUrl}`);
  }
  if (params.verificationUrl) {
    lines.push(`- Verification flow: ${params.verificationUrl}`);
  }
  if (Array.isArray(params.nextActions) && params.nextActions.length > 0) {
    lines.push('');
    lines.push('#### Next step');
    lines.push('');
    lines.push(params.nextActions[0]);
  }
  return lines.join('\n');
}
