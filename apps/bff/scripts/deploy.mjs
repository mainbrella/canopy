import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deployBackend } from '../../backend/scripts/deploy.mjs';
import { release } from '../../../scripts/deploy.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const execute = (command, args, options) => execFileSync(command, args, { stdio: 'inherit', ...options });

export function parseArguments(args) {
  if (!args.length) return { mode: 'publish' };
  if (args.length === 1 && args[0] === '--check') return { mode: 'check' };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { mode: 'help' };
  throw new Error('Usage: npm run deploy [-- --check]. Deploys BFF through the shared API and website directly from this machine.');
}

export function deployBff({ publish = true, directory = root, env = process.env, run = execute } = {}) {
  // BFF is composed into these two existing hosts. Finish migrations and API
  // publication before exposing the updated browser application.
  const api = deployBackend({ publish, directory, env, run });
  const site = release('site', { publish, local: publish, directory, env, run });
  return { api, site };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { mode } = parseArguments(process.argv.slice(2));
    if (mode === 'help') {
      console.log('npm run deploy                 Apply D1 migrations, deploy the API, then build and deploy the BFF website locally.');
      console.log('npm run deploy -- --check      Check and bundle both hosts without publishing.');
    } else deployBff({ publish: mode === 'publish' });
  } catch (error) {
    console.error(error.status ? 'BFF deployment failed. Review the preceding output and release records before retrying.' : error.message);
    process.exitCode = 1;
  }
}
