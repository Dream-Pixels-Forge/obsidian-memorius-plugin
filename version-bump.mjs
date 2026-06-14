import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// Read manifest.json
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;

// Update manifest.json
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// Update versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));

console.log(`Version bumped to ${targetVersion}`);
