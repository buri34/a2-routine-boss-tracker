const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", "target", "release", "gen"]);
const textExtensions = new Set([
  ".cmd",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".rs",
  ".svg",
  ".toml",
  ".txt",
  ".yml",
  ".yaml",
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

test("public repository contains the required policy documents", () => {
  for (const name of ["LICENSE", "README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md"]) {
    assert.equal(fs.existsSync(path.join(root, name)), true, `${name} is required`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.private, true, "prevent accidental npm publication");

  const cargoToml = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
  assert.match(cargoToml, /^license = "MIT"$/m);
});

test("Windows-only repository excludes unrelated platform artifacts", () => {
  for (const relativePath of [
    "BUILD_INFO.md",
    "src-tauri/icons/android",
    "src-tauri/icons/ios",
    "src-tauri/icons/icon.icns",
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} is not part of the Windows release`);
  }

  const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.deepEqual(tauriConfig.bundle.icon, ["icons/icon.ico"]);
});

test("public repository excludes local data and credentials", () => {
  const bannedFileNames = new Set([".env", "state.json"]);
  const bannedExtensions = new Set([".key", ".p12", ".pem", ".pfx"]);
  const files = walk(root);

  for (const file of files) {
    const relativePath = path.relative(root, file);
    assert.equal(bannedFileNames.has(path.basename(file)), false, `local file found: ${relativePath}`);
    assert.equal(bannedExtensions.has(path.extname(file).toLowerCase()), false, `credential file found: ${relativePath}`);
  }

  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][^"']+["']/i,
    /\/Users\/[^/\s]+/,
    /[A-Za-z]:\\Users\\[^\\\s]+/,
    /\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01])|10\.)\.?(?:\d{1,3}\.){1,2}\d{1,3}\b/,
  ];

  for (const file of files.filter((candidate) => textExtensions.has(path.extname(candidate).toLowerCase()))) {
    const text = fs.readFileSync(file, "utf8");
    const relativePath = path.relative(root, file);
    for (const pattern of patterns) {
      assert.doesNotMatch(text, pattern, `sensitive value found in ${relativePath}`);
    }
  }
});

test("public text files contain no hidden bidirectional controls or embedded BOM", () => {
  for (const file of walk(root).filter((candidate) => textExtensions.has(path.extname(candidate).toLowerCase()))) {
    const text = fs.readFileSync(file, "utf8");
    const relativePath = path.relative(root, file);
    assert.doesNotMatch(text, /[\u200B-\u200F\u202A-\u202E\u2060-\u2069]/u, `hidden control found in ${relativePath}`);
    assert.equal(text.slice(1).includes("\uFEFF"), false, `embedded BOM found in ${relativePath}`);
  }
});
