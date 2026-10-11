const fs = require('fs');
const path = require('path');

const { DOMAIN_ORDER } = require('../config');

const DOMAIN_REGISTRY = {
  security: {
    model: 'opus',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('security', discoveryData),
  },
  external: {
    model: 'opus',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('external', discoveryData),
  },
  data: {
    model: 'sonnet',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('data', discoveryData),
  },
  backend: {
    model: 'sonnet',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('backend', discoveryData),
  },
  frontend: {
    model: 'sonnet',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('frontend', discoveryData),
  },
  infrastructure: {
    model: 'sonnet',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('infrastructure', discoveryData),
  },
  performance: {
    model: 'sonnet',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('performance', discoveryData),
  },
  quality: {
    model: 'sonnet',
    dependencies: [],
    analyzerType: 'ai',
    outputShape: 'findings',
    fileSelector: (discoveryData) => getRelevantPaths('quality', discoveryData),
  },
};

function readSkill(skillName, frameworkPath) {
  const lensPath = path.join(frameworkPath, 'skills', 'codebase-doctor', 'references', 'domains', `${skillName}.md`);
  if (fs.existsSync(lensPath)) {
    return fs.readFileSync(lensPath, 'utf8');
  }

  throw new Error(`Domain lens not found: ${lensPath}`);
}

function readFindingContract(frameworkPath) {
  return fs.readFileSync(path.join(frameworkPath, 'skills', 'codebase-doctor', 'references', 'finding-contract.md'), 'utf8');
}

function selectDiscoveryFiles(scanResult, config) {
  const prioritized = [...scanResult.manifest.includedFiles].sort((left, right) => {
    const leftScore = discoveryPriority(left);
    const rightScore = discoveryPriority(right);
    return rightScore - leftScore || left.size - right.size;
  });

  return limitFiles(prioritized, config.promptLimits.discoveryMaxFiles, config.promptLimits.maxChars);
}

function selectDomainFiles(domain, scanResult, discoveryData, config) {
  const relevantPaths = DOMAIN_REGISTRY[domain]?.fileSelector(discoveryData) || getRelevantPaths(domain, discoveryData);
  const candidates = scanResult.manifest.includedFiles.filter((file) => {
    if (!relevantPaths.length || relevantPaths.includes('**/*')) {
      return true;
    }

    return relevantPaths.some((candidatePath) => {
      const normalized = candidatePath.replace(/\/+$/, '');
      return file.path === normalized || file.path.startsWith(`${normalized}/`);
    });
  });

  const prioritized = candidates.sort((left, right) => {
    const leftScore = domainPriority(domain, left);
    const rightScore = domainPriority(domain, right);
    return rightScore - leftScore || left.size - right.size;
  });

  return {
    relevantPaths,
    files: limitFiles(prioritized, config.promptLimits.domainMaxFiles, config.promptLimits.maxChars),
  };
}

function limitFiles(files, maxFiles, maxChars) {
  const limited = [];
  let totalChars = 0;

  for (const file of files) {
    if (limited.length >= maxFiles) {
      break;
    }

    const nextChars = file.content.length + file.path.length + 16;
    if (limited.length && totalChars + nextChars > maxChars) {
      break;
    }

    limited.push(file);
    totalChars += nextChars;
  }

  return limited;
}

function discoveryPriority(file) {
  if (file.category === 'config') {
    return 100;
  }

  if (file.category === 'docs') {
    return 90;
  }

  if (file.path.includes('/api/') || file.path.startsWith('api/')) {
    return 80;
  }

  if (file.path.startsWith('src/')) {
    return 70;
  }

  return 10;
}

function domainPriority(domain, file) {
  if (domain === 'infrastructure') {
    return file.category === 'config' ? 100 : 20;
  }

  if (domain === 'frontend') {
    return /\.(jsx?|tsx?)$/i.test(file.path) ? 100 : 20;
  }

  if (domain === 'data') {
    return /(schema|migration|db|sql|prisma|model)/i.test(file.path) ? 100 : 20;
  }

  if (domain === 'backend' || domain === 'external') {
    return /(api|server|route|worker|job|queue)/i.test(file.path) ? 100 : 20;
  }

  if (domain === 'quality') {
    return file.category === 'tests' ? 100 : 30;
  }

  if (domain === 'security' || domain === 'performance') {
    return file.category === 'config' ? 100 : 50;
  }

  return 10;
}

function formatFilesForPrompt(files) {
  if (!files.length) {
    return 'No file contents were selected for this prompt.';
  }

  return files
    .map((file) => `### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
    .join('\n\n');
}

function formatManifestSummary(scanResult) {
  return JSON.stringify(
    {
      file_counts: scanResult.manifest.fileCounts,
      language_counts: scanResult.manifest.languageCounts,
      locations: scanResult.manifest.locations,
      skipped_files: scanResult.manifest.skippedFiles.slice(0, 50),
    },
    null,
    2,
  );
}

function generateDiscoveryPrompt(projectPath, scanResult, config) {
  const discoveryFiles = selectDiscoveryFiles(scanResult, config);

  return `
# Task: Project Discovery

Analyze the project at: ${projectPath}

## Scanner Summary
${formatManifestSummary(scanResult)}

## File Context
${formatFilesForPrompt(discoveryFiles)}

## Instructions
Follow the discovery methodology to:
1. Detect the technology stack
2. Map the directory structure
3. Identify critical files
4. Assess quality indicators (tests, CI/CD, linting)
Reason privately about the evidence before responding, but do not output chain-of-thought.

## Output Format
Output ONLY a JSON object with this structure (no markdown, no explanation):

{
  "project_name": "string",
  "tech_stack": {
    "frontend": ["tech1", "tech2"],
    "backend": ["tech1"],
    "database": ["tech1"],
    "queue": "tech or null",
    "ai_services": ["service1"],
    "deployment": ["platform1"]
  },
  "structure": {
    "frontend_paths": ["path1", "path2"],
    "backend_paths": ["path1"],
    "data_paths": ["path1"],
    "config_files": ["file1", "file2"]
  },
  "quality_indicators": {
    "has_tests": boolean,
    "has_ci_cd": boolean,
    "has_linting": boolean,
    "has_typescript": boolean,
    "has_error_monitoring": boolean
  },
  "file_counts": {
    "total": number,
    "by_extension": {"ts": number, "tsx": number, "py": number}
  },
  "critical_files": [
    {"path": "string", "reason": "string"}
  ],
  "immediate_concerns": [
    {"issue": "string", "severity": "critical|high|medium|low"}
  ]
}
`;
}

function generateDomainPrompt(domain, projectPath, discoveryData, scanResult, config) {
  const skill = readSkill(domain, config.frameworkPath);
  const selection = selectDomainFiles(domain, scanResult, discoveryData, config);

  return {
    relevantPaths: selection.relevantPaths,
    prompt: `
# Task: ${domain.charAt(0).toUpperCase() + domain.slice(1)} Domain Analysis

## Project Context (from discovery)
- Project: ${discoveryData.project_name}
- Tech Stack: ${JSON.stringify(discoveryData.tech_stack, null, 2)}
- Relevant Paths: ${JSON.stringify(selection.relevantPaths, null, 2)}

## Scanner Summary
${formatManifestSummary(scanResult)}

## Project Path
${projectPath}

## File Context
${formatFilesForPrompt(selection.files)}

## Instructions
Analyze ONLY the ${domain} domain. Focus on files in the relevant paths.
Start with a quick discovery pass over the provided files, then return only structured findings that meet the contract below.

${skill}

## Finding Contract
${readFindingContract(config.frameworkPath)}

## Output Format
Output ONLY a JSON array of findings (no markdown, no explanation):

[
  {
    "domain": "${domain}",
    "category": "kebab-case-slug",
    "title": "string",
    "severity": "critical|high|medium|low",
    "confidence": "low|medium|high",
    "symbol": "enclosingFunctionOrModule",
    "rationale": "short explanation",
    "evidence": [
      {
        "file": "path/to/file",
        "lineRange": "10-20",
        "codeSnippet": "relevant code"
      }
    ],
    "impact": "string",
    "recommendation": {
      "action": "string",
      "effort": "low|medium|high",
      "code_example": "optional fix code"
    },
    "relatedFindings": [],
    "tags": ["tag1", "tag2"]
  }
]
`,
  };
}

function generateSynthesisPrompt(projectPath, allFindings, discoveryData, scanResult, config) {
  const truncatedFindings = allFindings.slice(0, config.promptLimits.synthesisMaxFindings);

  return `
# Task: Cross-Domain Synthesis

## Project Context
- Project: ${discoveryData.project_name}
- Tech Stack: ${JSON.stringify(discoveryData.tech_stack, null, 2)}

## Scanner Summary
${formatManifestSummary(scanResult)}

## All Findings from Domain Analysis
${JSON.stringify(truncatedFindings, null, 2)}

## Instructions
Identify SYSTEMIC PATTERNS that span multiple domains: root causes that explain several findings at once
(for example "No Safety Net": no tests + no CI + no monitoring; "Happy Path Only": no retries + no error handling;
"Scale Cliff": N+1 + no pagination + no caching; "Untrusted Boundaries": missing auth + no input validation).
Scores, deduplication, and the execution plan are computed in code; do not produce them.

## Output Format
Output ONLY a JSON object (no markdown, no explanation):

{
  "systemic_patterns": [
    {
      "id": "SYS-001",
      "name": "Pattern Name",
      "description": "What this pattern means",
      "contributing_findings": ["ID-001", "ID-002"],
      "severity": "critical|high|medium|low",
      "recommendation": "How to address"
    }
  ]
}
`;
}

function getRelevantPaths(domain, discoveryData) {
  const pathMapping = {
    frontend: discoveryData.structure?.frontend_paths || [],
    backend: discoveryData.structure?.backend_paths || [],
    data: discoveryData.structure?.data_paths || [],
    external: [...(discoveryData.structure?.backend_paths || [])],
    security: ['**/*'],
    infrastructure: discoveryData.structure?.config_files || [],
    performance: ['**/*'],
    quality: ['**/*'],
  };

  return pathMapping[domain] || [];
}

function getRelevantDomains(discoveryData) {
  return DOMAIN_ORDER.filter((domain) => {
    if (domain === 'frontend' && !discoveryData.tech_stack?.frontend?.length) {
      return false;
    }

    if (
      domain === 'external' &&
      !discoveryData.tech_stack?.ai_services?.length &&
      !discoveryData.tech_stack?.queue
    ) {
      return false;
    }

    return true;
  });
}

module.exports = {
  DOMAIN_REGISTRY,
  DOMAIN_ORDER,
  generateDiscoveryPrompt,
  generateDomainPrompt,
  generateSynthesisPrompt,
  getRelevantDomains,
  readFindingContract,
  readSkill,
  selectDiscoveryFiles,
  selectDomainFiles,
};
