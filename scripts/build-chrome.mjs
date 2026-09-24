#!/usr/bin/env node

import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'v3');
const buildDir = join(root, 'dist', 'chrome');
const packagesDir = join(root, 'dist', 'packages');

const manifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8'));

// Chrome MV3 accepts a service worker but rejects Firefox's legacy `scripts`
// background member. The Gecko block is metadata for Firefox only.
delete manifest.background.scripts;
delete manifest.browser_specific_settings;

await rm(buildDir, {recursive: true, force: true});
await cp(sourceDir, buildDir, {recursive: true});
await writeFile(join(buildDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await mkdir(packagesDir, {recursive: true});

const packageName = `always-active-plus-${manifest.version}-chrome.zip`;
const packagePath = join(packagesDir, packageName);
await rm(packagePath, {force: true});
await execFileAsync('zip', ['-qr', packagePath, '.'], {cwd: buildDir});

console.log(`Chrome extension directory: ${buildDir}`);
console.log(`Chrome extension package: ${packagePath}`);
