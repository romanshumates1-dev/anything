#!/usr/bin/env node
/**
 * Windows Installer Helper for DealFlow AI Desktop
 * Detects symlink privilege issues and provides fallback options.
 */

import { execSync } from 'child_process';
import { exit, platform, arch } from 'process';
import path from 'path';
import fs from 'fs';
import os from 'os';

function isWindows() {
  return platform === 'win32';
}

function isAdmin() {
  if (!isWindows()) return true;
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function canCreateSymlinks() {
  if (!isWindows()) return true;
  try {
    // Test symlink creation in temp directory
    const testDir = path.join(os.tmpdir(), 'symlink-test-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    const linkPath = path.join(testDir, 'test-link');
    fs.symlinkSync('test', linkPath);
    fs.rmSync(testDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function printBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                  DealFlow AI — Windows Installer                  ║
╚══════════════════════════════════════════════════════════════════╝

Target architecture: ${arch}
Node.js version: ${process.version}

`);
}

function buildDir() {
  console.log('🔨 Building unpacked directory (non-admin fallback)...');
  try {
    execSync('yarn workspace desktop pack:dir', { stdio: 'inherit' });
    console.log('✅ Unpacked app created in apps/desktop/dist/');
    console.log('\n⚠️  Note: This creates an unpacked directory without code signing.');
    console.log('   To run: cd apps/desktop && node dist/main/main.js');
    console.log('   Or use the executable directly: dist/main/main.js');
  } catch (error) {
    console.error('❌ Build failed:', error);
    exit(1);
  }
}

function buildInstaller() {
  console.log('🔨 Building Windows installer...');
  try {
    execSync('yarn workspace desktop dist:win', { stdio: 'inherit' });
    console.log('✅ Windows installer created in apps/desktop/release/');
  } catch (error) {
    console.error('❌ Installer build failed:', error);
    exit(1);
  }
}

function main() {
  printBanner();

  if (!isWindows()) {
    console.log('ℹ️  Not on Windows. Running standard build...');
    buildInstaller();
    return;
  }

  const admin = isAdmin();
  const symlinks = canCreateSymlinks();

  console.log(`Admin privileges: ${admin ? 'Yes' : 'No'}`);
  console.log(`Can create symlinks: ${symlinks ? 'Yes' : 'No'}`);

  if (!admin || !symlinks) {
    console.log(`
⚠️  Windows installer requires Administrator privileges due to:
   - Symlink creation for unpacked app verification
   - Code signing with signtool (optional but recommended)

`);

    if (process.argv.includes('--installer-only')) {
      console.log('❌ Cannot build installer without admin/symlink privileges.');
      console.log('   Run from elevated PowerShell or use "pack:dir" instead.');
      console.log('   Usage: node apps/desktop/scripts/windows-installer.mjs');
      console.log('   For unpacked: node apps/desktop/scripts/windows-installer.mjs --dir-only');
      exit(1);
    }

    console.log('🔄 Falling back to unpacked directory build...');
    buildDir();
    return;
  }

  buildInstaller();
}

main();