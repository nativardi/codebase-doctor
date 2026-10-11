const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { scanProject } = require('../lib/scanner');

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ucof-scanner-'));
}

test('scanner respects .gitignore entries', () => {
  const projectPath = createTempProject();
  fs.writeFileSync(path.join(projectPath, '.gitignore'), 'secret.txt\n');
  fs.writeFileSync(path.join(projectPath, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(projectPath, 'secret.txt'), 'ignore me');

  const result = scanProject(projectPath);

  assert.equal(result.manifest.includedFiles.some((file) => file.path === 'secret.txt'), false);
  assert.deepEqual(
    result.manifest.skippedFiles.find((file) => file.path === 'secret.txt')?.reason,
    'gitignored',
  );
});

test('scanner skips binary files', () => {
  const projectPath = createTempProject();
  fs.writeFileSync(path.join(projectPath, '.gitignore'), '');
  fs.writeFileSync(path.join(projectPath, 'logo.bin'), Buffer.from([0, 159, 146, 150]));

  const result = scanProject(projectPath);

  assert.equal(result.manifest.includedFiles.some((file) => file.path === 'logo.bin'), false);
  assert.equal(result.manifest.skippedFiles.find((file) => file.path === 'logo.bin')?.reason, 'binary');
});

test('scanner applies the size limit and records skip reasons', () => {
  const projectPath = createTempProject();
  fs.writeFileSync(path.join(projectPath, '.gitignore'), '');
  fs.writeFileSync(path.join(projectPath, 'small.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(projectPath, 'large.js'), 'x'.repeat(50));

  const result = scanProject(projectPath, { fileSizeLimitBytes: 20 });

  assert.equal(result.manifest.includedFiles.some((file) => file.path === 'small.js'), true);
  assert.equal(result.manifest.includedFiles.some((file) => file.path === 'large.js'), false);
  assert.equal(result.manifest.skippedFiles.find((file) => file.path === 'large.js')?.reason, 'size_limit');
});

test('scanner produces stable hashes for unchanged files', () => {
  const projectPath = createTempProject();
  fs.writeFileSync(path.join(projectPath, '.gitignore'), '');
  fs.writeFileSync(path.join(projectPath, 'index.js'), 'module.exports = 1;\n');

  const first = scanProject(projectPath);
  const second = scanProject(projectPath);
  const firstHash = first.manifest.includedFiles.find((file) => file.path === 'index.js')?.hash;
  const secondHash = second.manifest.includedFiles.find((file) => file.path === 'index.js')?.hash;

  assert.equal(firstHash, secondHash);

  fs.writeFileSync(path.join(projectPath, 'index.js'), 'module.exports = 2;\n');
  const third = scanProject(projectPath);
  const thirdHash = third.manifest.includedFiles.find((file) => file.path === 'index.js')?.hash;

  assert.notEqual(firstHash, thirdHash);
});
