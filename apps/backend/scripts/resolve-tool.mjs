import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Resolve tools from the backend script tree so both backend-local installs
// and dependencies hoisted to the monorepo root work the same way.
export function resolveTool(packageName, file) {
  let packageJson;
  try {
    packageJson = require.resolve(`${packageName}/package.json`);
  } catch {
    // Small script fixtures may provide only the requested file, without a
    // package manifest. Normal installations take the package.json path above.
    return require.resolve(`${packageName}/${file}`);
  }
  return join(dirname(packageJson), file);
}
