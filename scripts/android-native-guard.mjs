#!/usr/bin/env node
/**
 * android-native-guard.mjs
 * Idempotent guard that keeps the native background-audio wiring intact across
 * Tauri CLI regenerations of src-tauri/gen/android. Run before every Gradle build
 * (build-apk.bat invokes it). If a critical manual file lost its marker, this
 * script FAILS the build loudly instead of silently shipping a broken APK.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'src-tauri', 'gen', 'android');

const MEDIA3_DEPS = [
  'androidx.media3:media3-exoplayer:1.5.1',
  'androidx.media3:media3-common:1.5.1',
  'androidx.media3:media3-datasource:1.5.1',
  'com.github.TeamNewPipe:NewPipeExtractor:v0.26.5',
];

let changed = 0;
const notes = [];

function read(rel) {
  const p = path.join(ANDROID, rel);
  if (!existsSync(p)) throw new Error(`Missing expected file: ${p}`);
  return { p, text: readFileSync(p, 'utf8') };
}
function write(rel, text, p) {
  writeFileSync(p, text, 'utf8');
  changed++;
  notes.push(`injected into ${rel}`);
}

// 1. JitPack repository must exist in allprojects repositories.
{
  const rel = 'build.gradle.kts';
  const { p, text } = read(rel);
  if (!text.includes('jitpack.io')) {
    const needle = 'allprojects {\n    repositories {\n        google()\n        mavenCentral()\n';
    if (text.includes(needle)) {
      write(rel, text.replace(needle, `${needle}        maven { url = uri("https://jitpack.io") } // guard: native audio extractor\n`), p);
    } else {
      console.error('[android-native-guard] FATAL: allprojects repositories block not found in build.gradle.kts');
      process.exit(1);
    }
  } else {
    notes.push('jitpack repo present');
  }
}

// 2. Media3 + NewPipeExtractor dependencies must exist in app/build.gradle.kts.
{
  const rel = path.join('app', 'build.gradle.kts');
  const { p, text } = read(rel);
  const missing = MEDIA3_DEPS.filter((d) => !text.includes(d));
  if (missing.length > 0) {
    const marker = 'dependencies {\n';
    if (!text.includes(marker)) {
      console.error('[android-native-guard] FATAL: dependencies block not found in app/build.gradle.kts');
      process.exit(1);
    }
    const inject = '    // Native background / screen-off audio (native-audio guard)\n'
      + missing.map((d) => `    implementation("${d}")`).join('\n') + '\n';
    write(rel, text.replace(marker, `${marker}${inject}`), p);
  } else {
    notes.push('media3 + extractor deps present');
  }
}

// 3. Service must survive swipe-from-recents.
{
  const rel = path.join('app', 'src', 'main', 'AndroidManifest.xml');
  const { p, text } = read(rel);
  const serviceNeedle = 'android:name=".DotifyMediaService"';
  if (text.includes(serviceNeedle) && !text.includes('stopWithTask')) {
    const replaced = text.replace(
      'android:name=".DotifyMediaService"\n            android:foregroundServiceType="mediaPlayback"',
      'android:name=".DotifyMediaService"\n            android:foregroundServiceType="mediaPlayback"\n            android:stopWithTask="false"'
    );
    if (replaced === text) {
      console.error('[android-native-guard] FATAL: could not patch stopWithTask onto the service tag');
      process.exit(1);
    }
    write(rel, replaced, p);
  } else {
    notes.push('stopWithTask present');
  }
}

// 4. MainActivity must contain the AndroidNativePlayer JS interface (manual file — cannot auto-inject).
{
  const { text } = read(path.join('app', 'src', 'main', 'java', 'com', 'dotify', 'music', 'MainActivity.kt'));
  if (!text.includes('AndroidNativePlayer')) {
    console.error('[android-native-guard] FATAL: MainActivity.kt lost the AndroidNativePlayer bridge (Tauri regenerated or overwritten). Re-add the native JS interface.');
    process.exit(1);
  }
  notes.push('AndroidNativePlayer bridge present');
}

// 5. NativePlayerEngine + YtStreamResolver must exist as standalone files.
{
  for (const f of ['NativePlayerEngine.kt', 'YtStreamResolver.kt']) {
    if (!existsSync(path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'dotify', 'music', f))) {
      console.error(`[android-native-guard] FATAL: missing ${f} (deleted or regenerated away)`);
      process.exit(1);
    }
  }
  notes.push('native engine files present');
}

console.log('[android-native-guard] OK | ' + notes.join(' | ') + (changed ? ` | patched ${changed} file(s)` : ''));
process.exit(0);
