const fs = require('fs');
const path = require('path');

const envExamplePath = path.resolve(__dirname, '../.env.example');
const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

// Extract all NEXT_PUBLIC_ keys defined in .env.example
const exampleKeys = new Set(
  [...envExampleContent.matchAll(/^(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)].map((m) => m[1])
);

// Scan files in frontend/app, frontend/components, frontend/hooks, frontend/lib
const directoriesToScan = ['frontend/app', 'frontend/components', 'frontend/hooks', 'frontend/lib'];
const missingKeys = new Set();

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const matches = content.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g);
      for (const match of matches) {
        const key = match[1];
        if (!exampleKeys.has(key)) {
          missingKeys.add(`${key} (found in ${fullPath})`);
        }
      }
    }
  }
}

directoriesToScan.forEach(scanDir);

if (missingKeys.size > 0) {
  console.error('❌ CI Error: The following NEXT_PUBLIC_ env variables are used in code but missing from .env.example:\n');
  missingKeys.forEach((key) => console.error(`  - ${key}`));
  process.exit(1);
} else {
  console.log('✅ CI Check Passed: All NEXT_PUBLIC_ environment variables in source exist in .env.example');
}