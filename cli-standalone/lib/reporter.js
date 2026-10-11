const fs = require('fs');
const path = require('path');

const { hashContent, writeJson } = require('./cache');

const DOMAIN_PREFIXES = {
  security: 'SEC',
  external: 'EXT',
  data: 'DATA',
  backend: 'API',
  frontend: 'FE',
  infrastructure: 'INFRA',
  performance: 'PERF',
  quality: 'QA',
};

// Stable across runs while the defect stays in the same file and symbol, so trend diffs mean something.
function fingerprintFinding(finding, domain, evidence) {
  const primaryFile = evidence[0]?.file || '';
  const symbol = (finding.symbol || '').toLowerCase();
  const category = (finding.category || finding.title || '').toLowerCase();
  const prefix = DOMAIN_PREFIXES[domain] || domain.toUpperCase().slice(0, 3);
  // The domain is NOT part of the hash: two lenses reporting the same category at the same site collapse into one finding.
  return `${prefix}-${hashContent(`${category}|${primaryFile}|${symbol}`).slice(0, 6)}`;
}

const SEVERITY_WEIGHTS = { critical: 20, high: 10, medium: 3, low: 1 };
const EFFORT_WEIGHTS = { low: 1, medium: 2, high: 3 };
const CONFIDENCE_WEIGHTS = { low: 1, medium: 1.2, high: 1.4 };

function countBySeverity(findings) {
  return findings.reduce(
    (accumulator, finding) => {
      accumulator[finding.severity] = (accumulator[finding.severity] || 0) + 1;
      return accumulator;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

function calculateHealthScore(findings) {
  const totalPenalty = findings.reduce((sum, finding) => sum + (SEVERITY_WEIGHTS[finding.severity] || 0), 0);
  return Math.max(0, 100 - totalPenalty);
}

function normalizeEvidence(evidence) {
  const list = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  return list.map((item) => ({
    file: item.file || 'N/A',
    lineRange: item.lineRange || item.lines || 'N/A',
    codeSnippet: item.codeSnippet || item.code_snippet || '',
  }));
}

function normalizeFinding(finding, domain) {
  const evidence = normalizeEvidence(
    finding.evidence ||
      (finding.file || finding.lines || finding.code_snippet
        ? {
            file: finding.file,
            lines: finding.lines,
            code_snippet: finding.code_snippet,
          }
        : null),
  );

  const recommendation =
    typeof finding.recommendation === 'string'
      ? { action: finding.recommendation, effort: finding.effort || 'medium', code_example: '' }
      : {
          action: finding.recommendation?.action || 'Investigate and remediate this issue.',
          effort: finding.recommendation?.effort || finding.effort || 'medium',
          code_example: finding.recommendation?.code_example || '',
        };

  const verification = finding.verification || null;
  const severity =
    verification?.verdict === 'downgraded' && verification.severity ? verification.severity : finding.severity || 'medium';

  return {
    id: fingerprintFinding(finding, domain, evidence),
    domain,
    category: finding.category || null,
    symbol: finding.symbol || null,
    title: finding.title || 'Untitled finding',
    severity,
    reportedSeverity: finding.severity || 'medium',
    verification,
    confidence: finding.confidence || 'medium',
    rationale: finding.rationale || finding.issue || finding.impact || 'See supporting evidence.',
    evidence,
    impact: finding.impact || finding.issue || 'Impact not provided.',
    recommendation,
    effort: recommendation.effort,
    fileTargets: [...new Set(evidence.map((item) => item.file).filter(Boolean))],
    relatedFindings: finding.relatedFindings || finding.cross_references || [],
    tags: finding.tags || [],
  };
}

function deduplicateFindings(findings) {
  const seen = new Map();

  for (const finding of findings) {
    const key = finding.id.split('-').pop();
    if (!seen.has(key)) {
      seen.set(key, finding);
      continue;
    }

    const existing = seen.get(key);
    const existingWeight = SEVERITY_WEIGHTS[existing.severity] || 0;
    const nextWeight = SEVERITY_WEIGHTS[finding.severity] || 0;
    const [winner, loser] = nextWeight > existingWeight ? [finding, existing] : [existing, finding];
    winner.relatedFindings = [...new Set([...(winner.relatedFindings || []), `${loser.domain}: ${loser.title}`])];
    winner.reportedBy = [...new Set([...(winner.reportedBy || [winner.domain]), loser.domain])];
    seen.set(key, winner);
  }

  return [...seen.values()];
}

function rankFinding(finding) {
  const severityWeight = SEVERITY_WEIGHTS[finding.severity] || 0;
  const effortWeight = EFFORT_WEIGHTS[finding.effort] || 2;
  const confidenceWeight = CONFIDENCE_WEIGHTS[finding.confidence] || 1.2;
  return severityWeight * confidenceWeight / effortWeight;
}

function buildExecutionPlan(findings) {
  const ranked = [...findings].sort((left, right) => rankFinding(right) - rankFinding(left));
  const buckets = {
    immediate: [],
    short_term: [],
    medium_term: [],
    backlog: [],
  };

  for (const finding of ranked) {
    if (finding.severity === 'critical') {
      buckets.immediate.push(finding);
    } else if (finding.severity === 'high') {
      buckets.short_term.push(finding);
    } else if (finding.severity === 'medium') {
      buckets.medium_term.push(finding);
    } else {
      buckets.backlog.push(finding);
    }
  }

  return {
    immediate: buckets.immediate.map(toExecutionItem('Immediate')),
    shortTerm: buckets.short_term.map(toExecutionItem('Short-term')),
    mediumTerm: buckets.medium_term.map(toExecutionItem('Medium-term')),
    backlog: buckets.backlog.map(toExecutionItem('Backlog')),
  };
}

function toExecutionItem(phaseName) {
  return function mapFinding(finding, index) {
    return {
      id: finding.id,
      title: finding.title,
      rationale: `${phaseName} priority because this is a ${finding.severity} issue with ${finding.confidence} confidence.`,
      effort: effortLabel(finding.effort),
      fileTargets: finding.fileTargets,
      dependencyOrder: index + 1,
    };
  };
}

function effortLabel(effort) {
  const mapping = { low: 'S', medium: 'M', high: 'L' };
  return mapping[effort] || 'M';
}

function buildSystemicPatterns(findings, synthesisPatterns = []) {
  const patterns = [...(synthesisPatterns || [])];
  const hasQuality = findings.some((finding) => finding.domain === 'quality');
  const hasInfrastructure = findings.some((finding) => finding.domain === 'infrastructure');
  const hasSecurity = findings.some((finding) => finding.domain === 'security');

  if (hasQuality && hasInfrastructure) {
    patterns.push({
      id: 'SYS-NO-SAFETY-NET',
      name: 'No Safety Net',
      description: 'Quality and infrastructure findings together suggest weak guardrails before production.',
      severity: 'high',
      recommendation: 'Prioritize tests, CI, and monitoring before broader optimization work.',
    });
  }

  if (hasSecurity && findings.some((finding) => finding.domain === 'backend')) {
    patterns.push({
      id: 'SYS-SECURE-BOUNDARIES',
      name: 'Untrusted Boundaries',
      description: 'Security and backend findings indicate weak validation or access controls at system boundaries.',
      severity: 'high',
      recommendation: 'Tighten authentication, authorization, and request validation across backend entrypoints.',
    });
  }

  return deduplicatePatterns(patterns);
}

function deduplicatePatterns(patterns) {
  const seen = new Set();
  return patterns.filter((pattern) => {
    const key = pattern.id || pattern.name;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildUsageStats(runContext) {
  const models = runContext.config?.models || {};
  const pricing = runContext.config?.pricing || {};
  const fallbackRate = pricing[models.sonnet] || { input: 2, output: 10 };
  const buckets = [
    { usage: runContext.discoveryUsage, model: models.haiku },
    { usage: runContext.synthesisUsage, model: models.opus },
    ...runContext.domainResults.map((result) => ({ usage: result.usage, model: models[result.model] || result.model })),
  ];
  const totals = buckets.reduce(
    (accumulator, { usage, model }) => {
      const inputTokens = usage?.input_tokens || 0;
      const outputTokens = usage?.output_tokens || 0;
      const rate = pricing[model] || fallbackRate;
      accumulator.inputTokens += inputTokens;
      accumulator.outputTokens += outputTokens;
      accumulator.costUsd += (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
      return accumulator;
    },
    { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    estimatedCostUsd: Number(totals.costUsd.toFixed(4)),
    elapsedMs: runContext.durationMs,
  };
}

function compareReports(previousReport, currentReport) {
  if (!previousReport) {
    return {
      scoreChange: 0,
      newFindings: [],
      resolvedFindings: [],
    };
  }

  // Key on the hash part only: the prefix changes when a different lens wins the merge between runs.
  const fingerprint = (finding) => finding.id.split('-').pop();
  const previousById = new Map(previousReport.findings.map((finding) => [fingerprint(finding), finding]));
  const currentById = new Map(currentReport.findings.map((finding) => [fingerprint(finding), finding]));

  return {
    scoreChange: currentReport.scores.overall - previousReport.scores.overall,
    newFindings: currentReport.findings.filter((finding) => !previousById.has(fingerprint(finding))).map((finding) => finding.id),
    resolvedFindings: previousReport.findings
      .filter((finding) => !currentById.has(fingerprint(finding)))
      .map((finding) => finding.id),
  };
}

function isCounted(finding) {
  return !finding.verification || finding.verification.verdict !== 'refuted';
}

function buildCanonicalReport(runContext) {
  const refutedFindings = [];
  const normalizedDomainResults = runContext.domainResults.map((result) => {
    const allFindings = (result.findings || []).map((finding) => normalizeFinding(finding, result.domain));
    refutedFindings.push(...allFindings.filter((finding) => !isCounted(finding)));
    const findings = allFindings.filter(isCounted);
    const score = result.status === 'completed' ? calculateHealthScore(findings) : null;
    return {
      domain: result.domain,
      status: result.status,
      model: result.model || null,
      fallbackUsed: Boolean(result.fallbackUsed),
      warnings: result.warnings || [],
      usage: result.usage || {},
      error: result.error || null,
      score,
      findings,
    };
  });

  const deduplicatedFindings = deduplicateFindings(
    normalizedDomainResults.flatMap((result) => result.findings),
  ).sort((left, right) => rankFinding(right) - rankFinding(left));

  const severityCounts = countBySeverity(deduplicatedFindings);
  const healthScore = calculateHealthScore(deduplicatedFindings);
  const systemicPatterns = buildSystemicPatterns(deduplicatedFindings, runContext.synthesisResult.systemic_patterns);
  const executionPlan = buildExecutionPlan(deduplicatedFindings);
  const topFixes = deduplicatedFindings.slice(0, 3).map((finding) => ({
    id: finding.id,
    title: finding.title,
    rationale: finding.rationale,
    effort: effortLabel(finding.effort),
    fileTargets: finding.fileTargets,
  }));

  const report = {
    metadata: {
      version: '3.0.0',
      generatedAt: new Date().toISOString(),
      projectPath: runContext.projectPath,
      projectName: runContext.discoveryData.project_name,
      coverage: runContext.coverage,
      degraded: runContext.coverage.completed !== runContext.coverage.total,
      fallbackWarnings: runContext.fallbackWarnings || [],
    },
    config: {
      outputDir: runContext.config.outputDir,
      concurrency: runContext.concurrency,
      fileSizeLimitBytes: runContext.config.fileSizeLimitBytes,
      models: runContext.config.models,
      severityThresholds: runContext.config.severityThresholds,
      outputFormats: runContext.config.outputFormats,
    },
    discovery: runContext.discoveryData,
    domainResults: normalizedDomainResults,
    scores: {
      overall: healthScore,
      byDomain: Object.fromEntries(normalizedDomainResults.map((result) => [result.domain, result.score])),
    },
    severityCounts,
    findings: deduplicatedFindings,
    refutedFindings,
    verification: {
      verified: deduplicatedFindings.filter((finding) => finding.verification).length,
      unverified: deduplicatedFindings.filter((finding) => !finding.verification).length,
      refuted: refutedFindings.length,
    },
    systemicPatterns,
    topFixes,
    executionPlan,
    skippedFiles: runContext.scanResult.manifest.skippedFiles,
    usage: buildUsageStats(runContext),
  };

  report.trend = compareReports(runContext.previousReport, report);
  return report;
}

function formatFinding(finding) {
  const primaryEvidence = finding.evidence[0] || { file: 'N/A', lineRange: 'N/A', codeSnippet: '' };
  return `### ${finding.id}: ${finding.title}
- **Domain**: ${finding.domain}
- **Severity**: ${finding.severity}
- **Confidence**: ${finding.confidence}
- **Verification**: ${finding.verification ? `${finding.verification.verdict} — ${finding.verification.reasoning}` : 'not verified'}
- **Rationale**: ${finding.rationale}
- **File**: ${primaryEvidence.file}
- **Lines**: ${primaryEvidence.lineRange}
- **Impact**: ${finding.impact}
- **Recommendation**: ${finding.recommendation.action}
- **Effort**: ${effortLabel(finding.effort)}
`;
}

function generateMarkdownFromReport(report) {
  const groupedBySeverity = {
    critical: report.findings.filter((finding) => finding.severity === 'critical'),
    high: report.findings.filter((finding) => finding.severity === 'high'),
    medium: report.findings.filter((finding) => finding.severity === 'medium'),
    low: report.findings.filter((finding) => finding.severity === 'low'),
  };

  const coverageSuffix = report.metadata.degraded
    ? ` (${report.metadata.coverage.completed}/${report.metadata.coverage.total} domains analyzed)`
    : '';

  return `# UCOF Report

## Summary Dashboard
- **Project**: ${report.metadata.projectName}
- **Health Score**: ${report.scores.overall}/100${coverageSuffix}
- **Critical**: ${report.severityCounts.critical}
- **High**: ${report.severityCounts.high}
- **Medium**: ${report.severityCounts.medium}
- **Low**: ${report.severityCounts.low}

## Domain Scores
${Object.entries(report.scores.byDomain)
  .map(([domain, score]) => `- **${domain}**: ${score === null ? 'analysis unavailable' : `${score}/100`}`)
  .join('\n')}

## Highest-Leverage Fixes
${report.topFixes.map((fix, index) => `${index + 1}. **${fix.id}** ${fix.title} (${fix.effort})`).join('\n') || 'No leverage fixes identified.'}

## Trend
- **Score Change**: ${report.trend.scoreChange >= 0 ? '+' : ''}${report.trend.scoreChange}
- **New Findings**: ${report.trend.newFindings.join(', ') || 'None'}
- **Resolved Findings**: ${report.trend.resolvedFindings.join(', ') || 'None'}

## Systemic Patterns
${report.systemicPatterns.map((pattern) => `- **${pattern.name}**: ${pattern.description}`).join('\n') || 'No systemic patterns identified.'}

## Model Fallbacks
${report.metadata.fallbackWarnings.length ? report.metadata.fallbackWarnings.map((warning) => `- ${warning}`).join('\n') : 'No model fallbacks were required.'}

## Analysis Unavailable
${report.domainResults.filter((result) => result.status !== 'completed').length
  ? report.domainResults
      .filter((result) => result.status !== 'completed')
      .map((result) => `- **${result.domain}**: ${result.error || 'analysis unavailable'}`)
      .join('\n')
  : 'All requested domains completed successfully.'}

## Findings By Severity

### Critical
${groupedBySeverity.critical.map(formatFinding).join('\n') || 'No critical findings.'}

### High
${groupedBySeverity.high.map(formatFinding).join('\n') || 'No high findings.'}

### Medium
${groupedBySeverity.medium.map(formatFinding).join('\n') || 'No medium findings.'}

### Low
${groupedBySeverity.low.map(formatFinding).join('\n') || 'No low findings.'}

## Execution Plan
${generateExecutionPlanMarkdown(report)}
`;
}

function generateExecutionPlanMarkdown(report) {
  return `### Immediate
${formatExecutionItems(report.executionPlan.immediate)}

### Short-term
${formatExecutionItems(report.executionPlan.shortTerm)}

### Medium-term
${formatExecutionItems(report.executionPlan.mediumTerm)}

### Backlog
${formatExecutionItems(report.executionPlan.backlog)}
`;
}

function formatExecutionItems(items) {
  if (!items.length) {
    return 'No items in this phase.';
  }

  return items
    .map(
      (item) =>
        `- **${item.id}** ${item.title} [${item.effort}] — ${item.rationale} — Files: ${item.fileTargets.join(', ') || 'N/A'} — Order: ${item.dependencyOrder}`,
    )
    .join('\n');
}

function writeCompatibilityArtifacts(outputPath, report) {
  writeJson(path.join(outputPath, 'discovery.json'), report.discovery);
  writeJson(path.join(outputPath, 'all-findings.json'), report.findings);
  writeJson(path.join(outputPath, 'synthesis.json'), {
    summary: {
      total_findings: report.findings.length,
      by_severity: report.severityCounts,
      health_score: report.scores.overall,
      coverage: report.metadata.coverage,
    },
    systemic_patterns: report.systemicPatterns,
    deduplicated_findings: report.findings,
    execution_plan: report.executionPlan,
    top_fixes: report.topFixes,
  });

  for (const domainResult of report.domainResults) {
    writeJson(path.join(outputPath, `${domainResult.domain}-findings.json`), domainResult.findings);
  }
}

function writeCanonicalArtifacts(outputPath, report) {
  writeJson(path.join(outputPath, 'report.json'), report);
  fs.writeFileSync(path.join(outputPath, 'report.md'), generateMarkdownFromReport(report));
  fs.writeFileSync(path.join(outputPath, 'execution-plan.md'), generateExecutionPlanMarkdown(report));
  fs.writeFileSync(path.join(outputPath, 'report.html'), generateHtmlFromReport(report));
  writeCompatibilityArtifacts(outputPath, report);
}

// Generated with the frontend-design skill. When editing the HTML template,
// re-invoke the frontend-design skill to maintain the aesthetic intent.
function generateHtmlFromReport(report) {
  const reportPayload = JSON.stringify(report).replace(/</g, '\\u003c');
  const projectName = (report.metadata && report.metadata.projectName) || 'Untitled Project';
  const safeProjectName = String(projectName).replace(/[<>&]/g, (char) =>
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;',
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UCOF · ${safeProjectName}</title>
  <style>
    :root {
      --bg: #0b0b0d;
      --bg-panel: #131418;
      --bg-panel-hover: #181a1f;
      --bg-inset: #0f1013;
      --border: #26282f;
      --border-subtle: #1b1d22;
      --text: #ecebe7;
      --text-dim: #948f86;
      --text-faint: #5a564f;
      --accent: #e9a33a;
      --accent-dim: #8a5f18;
      --accent-glow: rgba(233, 163, 58, 0.18);
      --critical: #ef4444;
      --critical-soft: rgba(239, 68, 68, 0.12);
      --high: #f97316;
      --high-soft: rgba(249, 115, 22, 0.12);
      --medium: #eab308;
      --medium-soft: rgba(234, 179, 8, 0.12);
      --low: #3b82f6;
      --low-soft: rgba(59, 130, 246, 0.12);
      --success: #10b981;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'Cascadia Code', 'Roboto Mono', 'Consolas', 'Liberation Mono', 'Courier New', monospace;
      --font-serif: 'Instrument Serif', 'IBM Plex Serif', 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
      --shadow-soft: 0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 0 0 1px rgba(255, 255, 255, 0.02);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.55;
      font-feature-settings: 'ss01', 'cv11', 'tnum';
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: radial-gradient(ellipse at top, rgba(0,0,0,0.8), transparent 70%);
      z-index: 0;
    }

    body::after {
      content: '';
      position: fixed;
      top: -200px;
      left: 50%;
      transform: translateX(-50%);
      width: 900px;
      height: 600px;
      background: radial-gradient(circle at center, var(--accent-glow), transparent 60%);
      pointer-events: none;
      z-index: 0;
    }

    main {
      position: relative;
      max-width: 1200px;
      margin: 0 auto;
      padding: 64px 32px 96px;
      z-index: 1;
    }

    /* Top ribbon */
    .ribbon {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 48px;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 48px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--text-faint);
    }

    .ribbon .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ribbon .brand-mark {
      width: 8px;
      height: 8px;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
    }

    .ribbon .meta {
      display: flex;
      gap: 24px;
    }

    .ribbon .meta span em {
      font-style: normal;
      color: var(--text-dim);
      margin-left: 8px;
    }

    /* Hero */
    .hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 48px;
      align-items: end;
      padding: 24px 0 64px;
      animation: fadeRise 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .hero-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.24em;
      color: var(--text-faint);
      margin-bottom: 16px;
    }

    .hero-project {
      font-family: var(--font-serif);
      font-size: clamp(32px, 5vw, 56px);
      line-height: 1.05;
      letter-spacing: -0.01em;
      font-style: italic;
      color: var(--text);
      margin: 0 0 24px;
      font-weight: 400;
    }

    .hero-project::before {
      content: '';
      display: inline-block;
      width: 32px;
      height: 2px;
      background: var(--accent);
      vertical-align: middle;
      margin-right: 16px;
      transform: translateY(-6px);
    }

    .hero-sub {
      display: flex;
      gap: 32px;
      flex-wrap: wrap;
      color: var(--text-dim);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .hero-sub span em {
      font-style: normal;
      color: var(--text);
      margin-left: 8px;
    }

    .hero-score {
      text-align: right;
      font-family: var(--font-mono);
    }

    .hero-score-number {
      font-size: clamp(96px, 12vw, 168px);
      line-height: 0.9;
      font-weight: 300;
      letter-spacing: -0.04em;
      font-variant-numeric: tabular-nums;
      color: var(--text);
      animation: fadeRise 900ms cubic-bezier(0.16, 1, 0.3, 1) 100ms both;
    }

    .hero-score-number[data-grade='critical'] { color: var(--critical); }
    .hero-score-number[data-grade='warn'] { color: var(--high); }
    .hero-score-number[data-grade='ok'] { color: var(--accent); }
    .hero-score-number[data-grade='good'] { color: var(--success); }

    .hero-score-denom {
      font-size: 24px;
      color: var(--text-faint);
      margin-left: 4px;
    }

    .hero-score-label {
      text-align: right;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.22em;
      color: var(--text-faint);
      margin-top: 12px;
    }

    .hero-score-label.degraded { color: var(--high); }

    /* Section heading (architect style) */
    .section {
      margin-top: 72px;
      opacity: 0;
      transform: translateY(12px);
      animation: fadeRise 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .section:nth-of-type(1) { animation-delay: 200ms; }
    .section:nth-of-type(2) { animation-delay: 280ms; }
    .section:nth-of-type(3) { animation-delay: 360ms; }
    .section:nth-of-type(4) { animation-delay: 440ms; }
    .section:nth-of-type(5) { animation-delay: 520ms; }
    .section:nth-of-type(6) { animation-delay: 600ms; }
    .section:nth-of-type(7) { animation-delay: 680ms; }

    .section-head {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }

    .section-index {
      font-size: 11px;
      font-weight: 500;
      color: var(--accent);
      letter-spacing: 0.1em;
      padding: 2px 8px;
      border: 1px solid var(--accent-dim);
      border-radius: 2px;
    }

    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.28em;
      color: var(--text);
      margin: 0;
      font-weight: 500;
    }

    .section-rule {
      flex: 1;
      height: 1px;
      background: linear-gradient(to right, var(--border), transparent);
    }

    /* Severity matrix */
    .severity-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--border-subtle);
      border: 1px solid var(--border-subtle);
    }

    @media (max-width: 720px) {
      .severity-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .severity-cell {
      background: var(--bg-panel);
      padding: 24px;
      position: relative;
      transition: background 150ms ease;
    }

    .severity-cell:hover { background: var(--bg-panel-hover); }

    .severity-cell::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 3px;
      height: 100%;
    }

    .severity-cell[data-severity='critical']::before { background: var(--critical); }
    .severity-cell[data-severity='high']::before { background: var(--high); }
    .severity-cell[data-severity='medium']::before { background: var(--medium); }
    .severity-cell[data-severity='low']::before { background: var(--low); }

    .severity-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .severity-count {
      font-family: var(--font-mono);
      font-size: 40px;
      font-weight: 300;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }

    .severity-cell[data-severity='critical'] .severity-count { color: var(--critical); }
    .severity-cell[data-severity='high'] .severity-count { color: var(--high); }
    .severity-cell[data-severity='medium'] .severity-count { color: var(--medium); }
    .severity-cell[data-severity='low'] .severity-count { color: var(--low); }

    /* Domain rows */
    .domain-list {
      border: 1px solid var(--border-subtle);
      background: var(--bg-panel);
    }

    .domain-row {
      display: grid;
      grid-template-columns: 180px 1fr 80px 100px;
      gap: 24px;
      align-items: center;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border-subtle);
      transition: background 120ms ease;
    }

    .domain-row:last-child { border-bottom: none; }
    .domain-row:hover { background: var(--bg-panel-hover); }

    @media (max-width: 720px) {
      .domain-row { grid-template-columns: 120px 1fr 60px; }
      .domain-row .domain-findings { display: none; }
    }

    .domain-name {
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-size: 12px;
      color: var(--text);
    }

    .domain-bar {
      height: 3px;
      background: var(--border-subtle);
      position: relative;
      overflow: hidden;
    }

    .domain-bar-fill {
      height: 100%;
      background: var(--accent);
      transition: width 800ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .domain-bar-fill[data-grade='critical'] { background: var(--critical); }
    .domain-bar-fill[data-grade='warn'] { background: var(--high); }
    .domain-bar-fill[data-grade='ok'] { background: var(--accent); }
    .domain-bar-fill[data-grade='good'] { background: var(--success); }

    .domain-score {
      font-variant-numeric: tabular-nums;
      text-align: right;
      color: var(--text);
    }

    .domain-score.unavailable { color: var(--text-faint); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }

    .domain-findings {
      font-size: 11px;
      color: var(--text-dim);
      text-align: right;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    /* Trend strip */
    .trend {
      display: grid;
      grid-template-columns: auto 1fr 1fr;
      gap: 32px;
      align-items: start;
      padding: 28px;
      background: var(--bg-panel);
      border: 1px solid var(--border-subtle);
    }

    @media (max-width: 720px) {
      .trend { grid-template-columns: 1fr; }
    }

    .trend-delta-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.22em;
      color: var(--text-faint);
      margin-bottom: 8px;
    }

    .trend-delta-value {
      font-family: var(--font-mono);
      font-size: 48px;
      font-weight: 300;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .trend-delta-value.up { color: var(--success); }
    .trend-delta-value.down { color: var(--critical); }
    .trend-delta-value.flat { color: var(--text-dim); }

    .trend-column h4 {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.22em;
      color: var(--text-faint);
      margin: 0 0 12px;
      font-weight: 500;
    }

    .trend-column ul {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 12px;
      color: var(--text-dim);
      max-height: 120px;
      overflow-y: auto;
    }

    .trend-column li::before {
      content: '›';
      margin-right: 8px;
      color: var(--text-faint);
    }

    .trend-empty { color: var(--text-faint); font-size: 12px; font-style: italic; }

    /* Leverage fixes */
    .fixes-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--border-subtle);
      border: 1px solid var(--border-subtle);
    }

    @media (max-width: 960px) {
      .fixes-grid { grid-template-columns: 1fr; }
    }

    .fix-card {
      background: var(--bg-panel);
      padding: 24px;
      position: relative;
      transition: background 150ms ease;
    }

    .fix-card:hover { background: var(--bg-panel-hover); }

    .fix-index {
      font-family: var(--font-serif);
      font-style: italic;
      font-size: 32px;
      color: var(--accent);
      line-height: 1;
      margin-bottom: 16px;
    }

    .fix-id {
      font-size: 10px;
      color: var(--text-faint);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 8px;
    }

    .fix-title {
      font-size: 15px;
      color: var(--text);
      margin: 0 0 16px;
      font-weight: 400;
      line-height: 1.35;
    }

    .fix-effort {
      display: inline-block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      padding: 4px 10px;
      border: 1px solid var(--border);
      color: var(--text-dim);
    }

    /* Pattern blocks */
    .patterns {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--border-subtle);
      border: 1px solid var(--border-subtle);
    }

    .pattern {
      background: var(--bg-panel);
      padding: 20px 24px;
    }

    .pattern-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .pattern-name {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text);
    }

    .pattern-desc {
      font-size: 12px;
      color: var(--text-dim);
      margin: 0;
    }

    /* Filter + findings */
    .filter-wrap {
      position: relative;
      margin-bottom: 16px;
    }

    .filter-input {
      width: 100%;
      padding: 14px 16px 14px 40px;
      background: var(--bg-panel);
      border: 1px solid var(--border);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 13px;
      outline: none;
      transition: border-color 150ms ease;
    }

    .filter-input:focus { border-color: var(--accent); }

    .filter-wrap::before {
      content: '/';
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-faint);
      font-size: 16px;
    }

    .filter-hint {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 10px;
      color: var(--text-faint);
      border: 1px solid var(--border);
      padding: 2px 6px;
      letter-spacing: 0.1em;
    }

    .findings-count {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--text-faint);
      margin-bottom: 8px;
    }

    .finding {
      border: 1px solid var(--border-subtle);
      background: var(--bg-panel);
      margin-bottom: -1px;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .finding:hover { background: var(--bg-panel-hover); border-color: var(--border); }

    .finding-head {
      display: grid;
      grid-template-columns: 72px 96px 1fr 120px 20px;
      gap: 16px;
      align-items: center;
      padding: 14px 20px;
      cursor: pointer;
      user-select: none;
    }

    @media (max-width: 720px) {
      .finding-head { grid-template-columns: 72px 1fr 20px; }
      .finding-head .f-domain, .finding-head .f-confidence { display: none; }
    }

    .f-severity-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 8px;
    }

    .f-severity-dot.critical { background: var(--critical); box-shadow: 0 0 8px var(--critical); }
    .f-severity-dot.high { background: var(--high); box-shadow: 0 0 8px var(--high); }
    .f-severity-dot.medium { background: var(--medium); }
    .f-severity-dot.low { background: var(--low); }

    .f-id {
      font-size: 11px;
      color: var(--text-faint);
      letter-spacing: 0.06em;
    }

    .f-domain {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--text-dim);
    }

    .f-title {
      font-size: 13px;
      color: var(--text);
      line-height: 1.4;
    }

    .f-confidence {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--text-faint);
      text-align: right;
    }

    .f-toggle {
      color: var(--text-faint);
      transition: transform 200ms ease;
    }

    .finding.open .f-toggle { transform: rotate(90deg); color: var(--accent); }

    .finding-body {
      display: none;
      padding: 0 20px 20px;
      border-top: 1px solid var(--border-subtle);
      animation: fadeRise 300ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .finding.open .finding-body { display: block; }

    .finding-section {
      margin-top: 20px;
    }

    .finding-section h4 {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.22em;
      color: var(--text-faint);
      margin: 0 0 8px;
      font-weight: 500;
    }

    .finding-section p {
      margin: 0;
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.65;
    }

    .evidence {
      background: var(--bg-inset);
      border-left: 2px solid var(--accent);
      padding: 12px 16px;
      margin-top: 8px;
    }

    .evidence-path {
      font-size: 11px;
      color: var(--accent);
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
    }

    .evidence pre {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text);
      white-space: pre-wrap;
      overflow-x: auto;
      line-height: 1.6;
    }

    /* Execution timeline */
    .timeline {
      position: relative;
    }

    .timeline-phase {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 32px;
      padding: 24px 0;
      border-top: 1px solid var(--border-subtle);
      position: relative;
    }

    @media (max-width: 720px) {
      .timeline-phase { grid-template-columns: 1fr; gap: 16px; }
    }

    .timeline-phase:first-child { border-top: none; }

    .phase-marker {
      font-family: var(--font-serif);
      font-style: italic;
      font-size: 24px;
      color: var(--text);
      line-height: 1;
    }

    .phase-marker.immediate { color: var(--critical); }
    .phase-marker.short-term { color: var(--high); }
    .phase-marker.medium-term { color: var(--accent); }
    .phase-marker.backlog { color: var(--text-dim); }

    .phase-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-faint);
      margin-top: 8px;
    }

    .phase-item {
      padding: 8px 0;
      font-size: 13px;
      color: var(--text-dim);
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 16px;
      align-items: center;
    }

    .phase-item-title { color: var(--text); }
    .phase-item-id { font-size: 11px; color: var(--text-faint); letter-spacing: 0.06em; }
    .phase-item-effort {
      display: inline-block;
      font-size: 10px;
      padding: 2px 8px;
      border: 1px solid var(--border);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .phase-empty {
      color: var(--text-faint);
      font-style: italic;
      font-size: 12px;
    }

    /* Warnings */
    .warnings {
      padding: 16px 20px;
      border: 1px solid var(--high);
      background: var(--high-soft);
      color: var(--text);
      font-size: 12px;
      margin-bottom: 16px;
    }

    .warnings ul { margin: 8px 0 0; padding-left: 20px; }

    /* Footer */
    footer {
      margin-top: 96px;
      padding-top: 32px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-faint);
    }

    @keyframes fadeRise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <main>
    <div class="ribbon">
      <div class="brand"><span class="brand-mark"></span>UCOF · Universal Codebase Optimization Framework</div>
      <div class="meta">
        <span>Version<em id="r-version"></em></span>
        <span>Generated<em id="r-generated"></em></span>
      </div>
    </div>

    <section class="hero">
      <div>
        <div class="hero-label">Codebase Audit</div>
        <h1 class="hero-project" id="h-project"></h1>
        <div class="hero-sub">
          <span>Findings<em id="h-findings"></em></span>
          <span>Domains<em id="h-domains"></em></span>
          <span>Duration<em id="h-duration"></em></span>
          <span>Tokens<em id="h-tokens"></em></span>
        </div>
      </div>
      <div>
        <div class="hero-score">
          <div class="hero-score-number" id="h-score">–<span class="hero-score-denom">/100</span></div>
          <div class="hero-score-label" id="h-score-label">HEALTH INDEX</div>
        </div>
      </div>
    </section>

    <div id="warnings-slot"></div>

    <section class="section">
      <div class="section-head">
        <span class="section-index">01</span>
        <h2 class="section-title">Severity Matrix</h2>
        <span class="section-rule"></span>
      </div>
      <div class="severity-grid" id="severity-grid"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="section-index">02</span>
        <h2 class="section-title">Domain Scores</h2>
        <span class="section-rule"></span>
      </div>
      <div class="domain-list" id="domain-list"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="section-index">03</span>
        <h2 class="section-title">Trend vs Previous Run</h2>
        <span class="section-rule"></span>
      </div>
      <div class="trend" id="trend"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="section-index">04</span>
        <h2 class="section-title">Highest-Leverage Fixes</h2>
        <span class="section-rule"></span>
      </div>
      <div class="fixes-grid" id="fixes-grid"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="section-index">05</span>
        <h2 class="section-title">Systemic Patterns</h2>
        <span class="section-rule"></span>
      </div>
      <div class="patterns" id="patterns"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="section-index">06</span>
        <h2 class="section-title">Findings</h2>
        <span class="section-rule"></span>
      </div>
      <div class="filter-wrap">
        <input class="filter-input" id="filter" placeholder="Filter by id, domain, severity, or title…" autocomplete="off" />
        <span class="filter-hint">/ FOCUS</span>
      </div>
      <div class="findings-count" id="findings-count"></div>
      <div id="findings-list"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="section-index">07</span>
        <h2 class="section-title">Execution Plan</h2>
        <span class="section-rule"></span>
      </div>
      <div class="timeline" id="timeline"></div>
    </section>

    <footer>
      <span>UCOF v2.1 · Generated Report</span>
      <span id="f-coverage"></span>
    </footer>
  </main>

  <script>
    const report = ${reportPayload};

    function escapeHtml(value) {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function gradeFromScore(score) {
      if (score === null || score === undefined) return 'unknown';
      if (score < 40) return 'critical';
      if (score < 60) return 'warn';
      if (score < 85) return 'ok';
      return 'good';
    }

    function formatDuration(ms) {
      if (!ms && ms !== 0) return '—';
      if (ms < 1000) return ms + 'MS';
      return (ms / 1000).toFixed(1) + 'S';
    }

    function formatTokens(usage) {
      const total = (usage && usage.inputTokens || 0) + (usage && usage.outputTokens || 0);
      if (!total) return '—';
      if (total < 1000) return total.toString();
      return (total / 1000).toFixed(1) + 'K';
    }

    function renderRibbon() {
      document.getElementById('r-version').textContent = report.metadata.version || '2.0.0';
      const ts = new Date(report.metadata.generatedAt || Date.now());
      document.getElementById('r-generated').textContent = ts.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }

    function renderHero() {
      document.getElementById('h-project').textContent = report.metadata.projectName || 'Untitled';
      document.getElementById('h-findings').textContent = report.findings.length;
      document.getElementById('h-domains').textContent = report.metadata.coverage.completed + '/' + report.metadata.coverage.total;
      document.getElementById('h-duration').textContent = formatDuration(report.usage && report.usage.elapsedMs);
      document.getElementById('h-tokens').textContent = formatTokens(report.usage);

      const scoreEl = document.getElementById('h-score');
      const grade = gradeFromScore(report.scores.overall);
      scoreEl.setAttribute('data-grade', grade);
      scoreEl.innerHTML = report.scores.overall + '<span class="hero-score-denom">/100</span>';

      const labelEl = document.getElementById('h-score-label');
      if (report.metadata.degraded) {
        labelEl.classList.add('degraded');
        labelEl.textContent = 'PARTIAL · ' + report.metadata.coverage.completed + '/' + report.metadata.coverage.total + ' DOMAINS';
      } else {
        labelEl.textContent = 'HEALTH INDEX';
      }

      document.getElementById('f-coverage').textContent = report.metadata.coverage.completed + ' of ' + report.metadata.coverage.total + ' domains analyzed';
    }

    function renderWarnings() {
      const slot = document.getElementById('warnings-slot');
      const warnings = report.metadata.fallbackWarnings || [];
      if (!warnings.length) { slot.innerHTML = ''; return; }
      slot.innerHTML = '<div class="warnings"><strong>Model Fallbacks Used</strong><ul>' +
        warnings.map((w) => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul></div>';
    }

    function renderSeverity() {
      const levels = ['critical', 'high', 'medium', 'low'];
      const counts = report.severityCounts || {};
      document.getElementById('severity-grid').innerHTML = levels.map((level) =>
        '<div class="severity-cell" data-severity="' + level + '">' +
          '<div class="severity-label">' + level + '</div>' +
          '<div class="severity-count">' + (counts[level] || 0) + '</div>' +
        '</div>'
      ).join('');
    }

    function renderDomains() {
      const rows = (report.domainResults || []).map((result) => {
        const score = result.score;
        const grade = gradeFromScore(score);
        const barWidth = score === null ? 0 : score;
        const findings = (result.findings && result.findings.length) || 0;
        return '<div class="domain-row">' +
          '<div class="domain-name">' + escapeHtml(result.domain) + '</div>' +
          '<div class="domain-bar"><div class="domain-bar-fill" data-grade="' + grade + '" style="width:' + barWidth + '%"></div></div>' +
          (score === null
            ? '<div class="domain-score unavailable">Unavailable</div>'
            : '<div class="domain-score">' + score + '/100</div>') +
          '<div class="domain-findings">' + findings + ' ' + (findings === 1 ? 'Finding' : 'Findings') + '</div>' +
        '</div>';
      }).join('');
      document.getElementById('domain-list').innerHTML = rows || '<div class="domain-row"><div class="domain-name">No domain data</div></div>';
    }

    function renderTrend() {
      const trend = report.trend || { scoreChange: 0, newFindings: [], resolvedFindings: [] };
      const delta = trend.scoreChange;
      const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      const sign = delta > 0 ? '+' : '';
      const newList = (trend.newFindings || []).map((id) => '<li>' + escapeHtml(id) + '</li>').join('');
      const resolvedList = (trend.resolvedFindings || []).map((id) => '<li>' + escapeHtml(id) + '</li>').join('');
      document.getElementById('trend').innerHTML =
        '<div><div class="trend-delta-label">Score Delta</div><div class="trend-delta-value ' + cls + '">' + sign + delta + '</div></div>' +
        '<div class="trend-column"><h4>New Findings (' + (trend.newFindings || []).length + ')</h4>' +
          (newList ? '<ul>' + newList + '</ul>' : '<div class="trend-empty">None</div>') + '</div>' +
        '<div class="trend-column"><h4>Resolved Findings (' + (trend.resolvedFindings || []).length + ')</h4>' +
          (resolvedList ? '<ul>' + resolvedList + '</ul>' : '<div class="trend-empty">None</div>') + '</div>';
    }

    function renderFixes() {
      const fixes = report.topFixes || [];
      if (!fixes.length) {
        document.getElementById('fixes-grid').innerHTML = '<div class="fix-card"><div class="fix-title" style="color:var(--text-dim);font-style:italic">No leverage fixes identified.</div></div>';
        return;
      }
      document.getElementById('fixes-grid').innerHTML = fixes.map((fix, index) =>
        '<div class="fix-card">' +
          '<div class="fix-index">0' + (index + 1) + '</div>' +
          '<div class="fix-id">' + escapeHtml(fix.id) + '</div>' +
          '<h3 class="fix-title">' + escapeHtml(fix.title) + '</h3>' +
          '<span class="fix-effort">Effort · ' + escapeHtml(fix.effort || 'M') + '</span>' +
        '</div>'
      ).join('');
    }

    function renderPatterns() {
      const patterns = report.systemicPatterns || [];
      if (!patterns.length) {
        document.getElementById('patterns').innerHTML = '<div class="pattern"><p class="pattern-desc" style="font-style:italic">No systemic patterns detected.</p></div>';
        return;
      }
      document.getElementById('patterns').innerHTML = patterns.map((pattern) =>
        '<div class="pattern">' +
          '<div class="pattern-head"><span class="f-severity-dot ' + (pattern.severity || 'medium') + '"></span><span class="pattern-name">' + escapeHtml(pattern.name) + '</span></div>' +
          '<p class="pattern-desc">' + escapeHtml(pattern.description) + '</p>' +
        '</div>'
      ).join('');
    }

    function renderFindings(filter) {
      const query = (filter || '').toLowerCase();
      const list = (report.findings || []).filter((finding) => {
        if (!query) return true;
        return [finding.id, finding.domain, finding.severity, finding.title, finding.rationale]
          .filter(Boolean).join(' ').toLowerCase().includes(query);
      });

      document.getElementById('findings-count').textContent = 'Showing ' + list.length + ' of ' + (report.findings || []).length;

      document.getElementById('findings-list').innerHTML = list.map((finding) => {
        const evidence = (finding.evidence || []).map((ev) =>
          '<div class="evidence">' +
            '<div class="evidence-path"><span>' + escapeHtml(ev.file) + '</span><span>' + escapeHtml(ev.lineRange || '') + '</span></div>' +
            (ev.codeSnippet ? '<pre>' + escapeHtml(ev.codeSnippet) + '</pre>' : '') +
          '</div>'
        ).join('');

        return '<div class="finding" data-id="' + escapeHtml(finding.id) + '">' +
          '<div class="finding-head" onclick="this.parentElement.classList.toggle(\\'open\\')">' +
            '<div class="f-id"><span class="f-severity-dot ' + escapeHtml(finding.severity) + '"></span>' + escapeHtml(finding.id) + '</div>' +
            '<div class="f-domain">' + escapeHtml(finding.domain) + '</div>' +
            '<div class="f-title">' + escapeHtml(finding.title) + '</div>' +
            '<div class="f-confidence">' + escapeHtml(finding.confidence || '—') + '</div>' +
            '<div class="f-toggle">›</div>' +
          '</div>' +
          '<div class="finding-body">' +
            '<div class="finding-section"><h4>Rationale</h4><p>' + escapeHtml(finding.rationale || '—') + '</p></div>' +
            (evidence ? '<div class="finding-section"><h4>Evidence</h4>' + evidence + '</div>' : '') +
            '<div class="finding-section"><h4>Impact</h4><p>' + escapeHtml(finding.impact || '—') + '</p></div>' +
            '<div class="finding-section"><h4>Recommendation</h4><p>' + escapeHtml((finding.recommendation && finding.recommendation.action) || '—') +
              ' <span style="color:var(--text-faint);margin-left:8px;">Effort: ' + escapeHtml((finding.recommendation && finding.recommendation.effort) || 'medium') + '</span></p></div>' +
          '</div>' +
        '</div>';
      }).join('') || '<div class="finding"><div class="finding-head"><div></div><div></div><div class="f-title" style="color:var(--text-faint);font-style:italic">No findings match this filter.</div><div></div><div></div></div></div>';
    }

    function renderTimeline() {
      const plan = report.executionPlan || {};
      const phases = [
        { key: 'immediate', label: 'Immediate', items: plan.immediate || [] },
        { key: 'short-term', label: 'Short-term', items: plan.shortTerm || [] },
        { key: 'medium-term', label: 'Medium-term', items: plan.mediumTerm || [] },
        { key: 'backlog', label: 'Backlog', items: plan.backlog || [] },
      ];

      document.getElementById('timeline').innerHTML = phases.map((phase) =>
        '<div class="timeline-phase">' +
          '<div>' +
            '<div class="phase-marker ' + phase.key + '">' + phase.items.length + '</div>' +
            '<div class="phase-label">' + phase.label + '</div>' +
          '</div>' +
          '<div>' +
            (phase.items.length
              ? phase.items.map((item) =>
                  '<div class="phase-item">' +
                    '<span class="phase-item-title">' + escapeHtml(item.title) + '</span>' +
                    '<span class="phase-item-id">' + escapeHtml(item.id) + '</span>' +
                    '<span class="phase-item-effort">' + escapeHtml(item.effort || 'M') + '</span>' +
                  '</div>'
                ).join('')
              : '<div class="phase-empty">No items scheduled for this phase.</div>') +
          '</div>' +
        '</div>'
      ).join('');
    }

    function mount() {
      renderRibbon();
      renderHero();
      renderWarnings();
      renderSeverity();
      renderDomains();
      renderTrend();
      renderFixes();
      renderPatterns();
      renderFindings('');
      renderTimeline();

      const filter = document.getElementById('filter');
      filter.addEventListener('input', (event) => renderFindings(event.target.value));

      document.addEventListener('keydown', (event) => {
        if (event.key === '/' && document.activeElement !== filter) {
          event.preventDefault();
          filter.focus();
        }
      });
    }

    mount();
  </script>
</body>
</html>`;
}

function generatePRDescriptions(outputPath, report) {
  const phases = [
    ['IMMEDIATE', report.executionPlan.immediate],
    ['SHORT TERM', report.executionPlan.shortTerm],
    ['MEDIUM TERM', report.executionPlan.mediumTerm],
    ['BACKLOG', report.executionPlan.backlog],
  ];

  let prDoc = '# Pull Request Descriptions\n\n';
  for (const [phaseName, items] of phases) {
    if (!items.length) {
      continue;
    }

    prDoc += `## ${phaseName}\n\n`;
    for (const item of items) {
      prDoc += `### ${item.id} - ${item.title}\n\n`;
      prDoc += `- Effort: ${item.effort}\n`;
      prDoc += `- Files: ${item.fileTargets.join(', ') || 'N/A'}\n`;
      prDoc += `- Rationale: ${item.rationale}\n\n`;
    }
  }

  const outputFile = path.join(outputPath, 'pr-descriptions.md');
  fs.writeFileSync(outputFile, prDoc);
  return outputFile;
}

module.exports = {
  buildCanonicalReport,
  fingerprintFinding,
  compareReports,
  buildExecutionPlan,
  calculateHealthScore,
  countBySeverity,
  generateExecutionPlanMarkdown,
  generateHtmlFromReport,
  generateMarkdownFromReport,
  generatePRDescriptions,
  normalizeFinding,
  writeCanonicalArtifacts,
};
