const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const MIN_BELL_CURVE_SAMPLE_SIZE = 4;
const SCORE_EPSILON = 1e-9;

const clampScore = (value) => Math.min(100, Math.max(0, value));
const roundScore = (value) => Math.round(clampScore(value) * 100) / 100;
const log1pSafe = (value) =>
  Math.log1p(Number.isFinite(value) ? Math.max(0, value) : 0);

const mean = (values) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

const computeStdDev = (values, average) => {
  if (values.length <= 1) {
    return 0;
  }
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(Math.max(variance, 0));
};

const computeCohortStats = (values) => {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return null;
  }
  const average = mean(finiteValues);
  const stdDev = computeStdDev(finiteValues, average);
  return {
    average,
    stdDev,
    min: Math.min(...finiteValues),
    max: Math.max(...finiteValues),
    count: finiteValues.length,
  };
};

const bellCurveScore = (value, stats, options = {}) => {
  if (!Number.isFinite(value)) {
    return roundScore(options.neutralScore ?? 50);
  }
  if (!stats || stats.count === 0) {
    return roundScore(options.neutralScore ?? 50);
  }
  if (!Number.isFinite(stats.stdDev) || stats.stdDev <= 0) {
    if (stats.max <= stats.min) {
      return roundScore(options.neutralScore ?? 50);
    }
    const normalized = (value - stats.min) / (stats.max - stats.min);
    const directed = options.higherIsBetter === false ? 1 - normalized : normalized;
    return roundScore(directed * 100);
  }
  const zScore = (value - stats.average) / stats.stdDev;
  const logistic = 1 / (1 + Math.exp(-zScore));
  const directed = options.higherIsBetter === false ? 1 - logistic : logistic;
  return roundScore(directed * 100);
};

const percentileRankScore = ({ value, values, higherIsBetter }) => {
  const finiteValues = values.filter((entry) => Number.isFinite(entry));
  if (!Number.isFinite(value) || finiteValues.length === 0) {
    return 50;
  }
  if (finiteValues.length === 1) {
    return 100;
  }
  const lessCount = finiteValues.filter((entry) => entry < value - SCORE_EPSILON).length;
  const equalCount = finiteValues.filter(
    (entry) => Math.abs(entry - value) <= SCORE_EPSILON,
  ).length;
  const percentile = (lessCount + Math.max(0, equalCount - 1) / 2) / (finiteValues.length - 1);
  const normalized = higherIsBetter ? percentile : 1 - percentile;
  return roundScore(normalized * 100);
};

const scoreFromDistribution = ({ value, values, higherIsBetter }) => {
  const stats = computeCohortStats(values);
  if (values.length >= MIN_BELL_CURVE_SAMPLE_SIZE && stats) {
    return bellCurveScore(value, stats, { higherIsBetter, neutralScore: 50 });
  }
  return percentileRankScore({ value, values, higherIsBetter });
};

const parseString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseGitHubRepo = (value) => {
  const trimmed = parseString(value);
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    const [owner = '', repoWithSuffix = ''] = url.pathname.split('/').filter(Boolean);
    const repo = repoWithSuffix.replace(/\.git$/u, '');
    if (!owner || !repo) {
      return null;
    }
    return {
      owner,
      repo,
      key: `${owner}/${repo}`,
    };
  } catch {
    return null;
  }
};

const parseWholeNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const parseOptionalWholeNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;

const parseOptionalDateString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const toDaysSince = (value, fallbackDays) => {
  if (!value) {
    return fallbackDays;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return fallbackDays;
  }
  return Math.max(0, (Date.now() - parsed) / 86_400_000);
};

const toGitHubRawMetrics = (payload) => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  const stars = parseWholeNumber(record?.stargazers_count);
  const watchers = parseWholeNumber(record?.subscribers_count);
  const openIssues = parseOptionalWholeNumber(record?.open_issues_count);
  const issueRatio = (openIssues ?? Math.max(1, Math.floor(stars / 2))) / Math.max(1, stars);
  const engagementRatio = watchers / Math.max(1, stars);
  return {
    isArchived: record?.archived === true,
    stars,
    watchers,
    issueRatio: Number.isFinite(issueRatio) ? Math.max(0, issueRatio) : 1,
    engagementRatio: Number.isFinite(engagementRatio) ? Math.max(0, engagementRatio) : 0,
    ageDays: toDaysSince(parseOptionalDateString(record?.created_at), 0),
    recencyDays: toDaysSince(parseOptionalDateString(record?.pushed_at), 3650),
  };
};

const applyRelativePenalty = (scores) => {
  let penalty = 0;
  if (scores.repository >= 85 && scores.community <= 20) {
    penalty += 8;
  }
  if (scores.repository >= 75 && scores.maintenance <= 20) {
    penalty += 7;
  }
  if (scores.repository >= 75 && scores.resilience <= 15) {
    penalty += 6;
  }
  return roundScore(penalty);
};

const computeRepositoryHealthFromMetrics = (subjectMetrics, cohortMetrics) => {
  if (subjectMetrics.isArchived) {
    return 0;
  }
  if (cohortMetrics.length <= 1) {
    return 100;
  }
  const starsValues = cohortMetrics.map((metric) => log1pSafe(metric.stars));
  const watchersValues = cohortMetrics.map((metric) => log1pSafe(metric.watchers));
  const engagementValues = cohortMetrics.map((metric) => log1pSafe(metric.engagementRatio));
  const ageValues = cohortMetrics.map((metric) => log1pSafe(metric.ageDays));
  const recencyValues = cohortMetrics.map((metric) => log1pSafe(metric.recencyDays));
  const issueValues = cohortMetrics.map((metric) => log1pSafe(metric.issueRatio));
  const repository = roundScore(
    scoreFromDistribution({
      value: log1pSafe(subjectMetrics.stars),
      values: starsValues,
      higherIsBetter: true,
    }) *
      0.75 +
      scoreFromDistribution({
        value: log1pSafe(subjectMetrics.ageDays),
        values: ageValues,
        higherIsBetter: true,
      }) *
        0.25,
  );
  const community = roundScore(
    scoreFromDistribution({
      value: log1pSafe(subjectMetrics.watchers),
      values: watchersValues,
      higherIsBetter: true,
    }) *
      0.6 +
      scoreFromDistribution({
        value: log1pSafe(subjectMetrics.engagementRatio),
        values: engagementValues,
        higherIsBetter: true,
      }) *
        0.4,
  );
  const maintenance = scoreFromDistribution({
    value: log1pSafe(subjectMetrics.recencyDays),
    values: recencyValues,
    higherIsBetter: false,
  });
  const resilience = scoreFromDistribution({
    value: log1pSafe(subjectMetrics.issueRatio),
    values: issueValues,
    higherIsBetter: false,
  });
  const penalty = applyRelativePenalty({
    repository,
    community,
    maintenance,
    resilience,
  });
  return roundScore(
    repository * 0.33 +
      community * 0.27 +
      maintenance * 0.2 +
      resilience * 0.2 -
      penalty,
  );
};

async function fetchGitHubRepoHealthInternal(params) {
  const parsedSubject = parseGitHubRepo(params.repoUrl);
  if (!parsedSubject) {
    return null;
  }
  const githubApiBaseUrl =
    parseString(params.githubApiBaseUrl).replace(/\/+$/u, '') || DEFAULT_GITHUB_API_BASE_URL;
  const fetchImplementation = params.fetchImplementation ?? fetch;
  const githubToken = parseString(params.githubToken);
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'hashgraph-online-skill-publish',
    ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
  };
  const requestRepo = async (repoKey) => {
    const [owner = '', repo = ''] = repoKey.split('/', 2);
    if (!owner || !repo) {
      return null;
    }
    const url = `${githubApiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await fetchImplementation(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    return toGitHubRawMetrics(await response.json());
  };
  const subjectMetrics = await requestRepo(parsedSubject.key);
  if (!subjectMetrics) {
    return null;
  }
  const candidateRepos = Array.isArray(params.repoCandidates)
    ? [...new Set(params.repoCandidates.map((value) => parseGitHubRepo(value)?.key).filter(Boolean))]
    : [];
  const normalizedCandidates = candidateRepos.includes(parsedSubject.key)
    ? candidateRepos
    : [parsedSubject.key, ...candidateRepos];
  const cohortMetrics = (
    await Promise.all(
      normalizedCandidates.slice(0, 25).map(async (repoKey) => {
        try {
          return repoKey === parsedSubject.key ? subjectMetrics : await requestRepo(repoKey);
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);
  if (cohortMetrics.length <= 1) {
    return null;
  }
  return {
    score: computeRepositoryHealthFromMetrics(subjectMetrics, cohortMetrics),
    evidence: {
      source: 'github',
      repo: parsedSubject.key,
      cohortSize: cohortMetrics.length,
      includeExternal: true,
      computedAt: params.computedAt,
    },
  };
}

export async function resolveRepositoryHealthScore(params) {
  const persistedScore = Number(params.publishedSkill?.trustScores?.['repository.health.score']);
  if (!params.includeExternal) {
    return Number.isFinite(persistedScore)
      ? {
          score: roundScore(persistedScore),
          evidence: { source: 'persisted', includeExternal: false },
        }
      : null;
  }
  if (typeof params.fetchGitHubRepoHealth === 'function') {
    const result = await params.fetchGitHubRepoHealth({
      repoUrl: params.packageState.repoUrl,
      repoCandidates: params.repoCandidates,
      computedAt: params.computedAt,
    });
    if (result && Number.isFinite(result.score)) {
      return {
        score: roundScore(result.score),
        evidence: result.evidence ?? null,
      };
    }
    return null;
  }
  return fetchGitHubRepoHealthInternal({
    repoUrl: params.packageState.repoUrl,
    repoCandidates: params.repoCandidates,
    fetchImplementation: params.fetchImplementation,
    githubApiBaseUrl: params.githubApiBaseUrl,
    githubToken: params.githubToken,
    computedAt: params.computedAt,
  });
}
