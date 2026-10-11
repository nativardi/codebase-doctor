#!/usr/bin/env node
// Scores a UCOF report.json against a planted-issue answer key.
// Usage: node scripts/score-eval.js <report.json> <key.json>
// Prints precision/recall/F1 over planted issues, decoys tripped, and the misses.
const fs = require('fs');

const [reportPath, keyPath] = process.argv.slice(2);
if (!reportPath || !keyPath) {
  console.error('usage: score-eval.js <report.json> <key.json>');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const findings = report.findings || [];

function tokens(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean));
}

function matches(finding, entry) {
  // Primary site only: a finding whose supporting evidence merely touches a decoy's file is not a decoy hit.
  const primary = String((finding.evidence || [])[0]?.file || (finding.fileTargets || [])[0] || '').replace(/^\.\//, '');
  const files = entry.files || [entry.file];
  if (!files.some((file) => primary === file || primary.endsWith(`/${file}`))) return false;
  const bag = tokens(`${finding.category} ${finding.title} ${(finding.tags || []).join(' ')}`);
  return entry.categories.some((slug) => slug.split('-').every((word) => bag.has(word) || bag.has(`${word}s`)));
}

const hits = [];
const misses = [];
for (const entry of key.planted) {
  const hit = findings.find((finding) => matches(finding, entry));
  (hit ? hits : misses).push({ key: entry.key, severity: entry.severity, by: hit ? `${hit.id} ${hit.title}` : null });
}

const tripped = [];
for (const decoy of key.decoys || []) {
  if (!decoy.categories) continue;
  const hit = findings.find((finding) => matches(finding, decoy));
  if (hit) tripped.push({ key: decoy.key, by: `${hit.id} ${hit.title}` });
}

const matchedIds = new Set(hits.map((hit) => hit.by.split(' ')[0]));
const unmatched = findings.filter((finding) => !matchedIds.has(finding.id)).length;
const precision = findings.length ? hits.length / findings.length : 0;
const recall = key.planted.length ? hits.length / key.planted.length : 0;
const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

const refutedDecoys = (report.refutedFindings || []).filter((finding) => (key.decoys || []).some((decoy) => decoy.categories && matches(finding, decoy))).length;

console.log(
  JSON.stringify(
    {
      findings: findings.length,
      planted: key.planted.length,
      hits: hits.length,
      misses: misses.map((miss) => miss.key),
      decoysTripped: tripped,
      decoysRefutedByVerifier: refutedDecoys,
      unmatchedFindings: unmatched,
      precision: Number(precision.toFixed(2)),
      recall: Number(recall.toFixed(2)),
      f1: Number(f1.toFixed(2)),
      healthScore: report.scores?.overall ?? null,
      verification: report.verification || null,
    },
    null,
    2,
  ),
);
