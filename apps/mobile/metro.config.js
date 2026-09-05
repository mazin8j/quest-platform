// Monorepo-aware Metro configuration (Expo docs: "Work with monorepos").
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch workspace packages so edits in packages/* hot-reload.
config.watchFolders = [workspaceRoot];
// Resolve hoisted dependencies from the workspace root as well as the app.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
