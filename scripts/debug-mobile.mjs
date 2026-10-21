#!/usr/bin/env node
/**
 * Dotify Mobile Debugging & Diagnostics CLI
 *
 * Reads real-time error telemetry and logs shipped from Android devices to Firestore.
 *
 * Usage:
 *   node scripts/debug-mobile.mjs               # Shows last 10 error events
 *   node scripts/debug-mobile.mjs --limit 25    # Shows last 25 error events
 *   node scripts/debug-mobile.mjs --tail        # Live tails incoming error events
 *   node scripts/debug-mobile.mjs --clear       # Clears stored diagnostic logs
 */

const FIREBASE_PROJECT_ID = 'dotify-11e01';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = 'mobile_diagnostics';

function parseDoc(doc) {
  const fields = doc.fields || {};
  const data = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val.stringValue !== undefined) data[key] = val.stringValue;
    else if (val.integerValue !== undefined) data[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) data[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) data[key] = val.booleanValue;
    else if (val.mapValue !== undefined) {
      data[key] = {};
      const sub = val.mapValue.fields || {};
      for (const [sk, sv] of Object.entries(sub)) {
        data[key][sk] = sv.stringValue ?? sv.integerValue ?? sv.booleanValue ?? sv;
      }
    } else {
      data[key] = val;
    }
  }
  data._id = doc.name ? doc.name.split('/').pop() : '';
  data._createTime = doc.createTime;
  return data;
}

async function fetchLogs(limit = 15) {
  try {
    const url = `${FIRESTORE_BASE}/${COLLECTION}?pageSize=50`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch logs from Firestore (${res.status}):`, await res.text());
      return [];
    }
    const json = await res.json();
    const docs = (json.documents || []).map(parseDoc);
    docs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return docs.slice(0, limit);
  } catch (err) {
    console.error('Network error fetching logs:', err.message);
    return [];
  }
}

function printLog(log, index = 0) {
  const timeStr = log.isoTime || (log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Unknown Time');
  const levelBadge = log.level === 'error' ? '❌ ERROR' : log.level === 'warn' ? '⚠️ WARN' : 'ℹ️ INFO';
  const category = log.category || 'GENERAL';
  const version = log.appVersion ? `v${log.appVersion}` : 'unknown version';
  const device = log.deviceModel || log.platform || 'Android Device';

  console.log(`\n┌─────────────────────────────────────────────────────────────────────────────`);
  console.log(`│ [${timeStr}] ${levelBadge} [${category}] - ${device} (${version})`);
  console.log(`├─────────────────────────────────────────────────────────────────────────────`);
  console.log(`│ Message:  ${log.message || 'No message provided'}`);
  if (log.trackTitle || log.trackArtist) {
    console.log(`│ Track:    ${log.trackTitle || 'Unknown'} - ${log.trackArtist || 'Unknown'} (id: ${log.trackId || 'N/A'}, videoId: ${log.videoId || 'none'})`);
  }
  if (log.resolveError) {
    console.log(`│ Resolver: ${log.resolveError}`);
  }
  if (log.source) {
    console.log(`│ Source:   ${log.source}`);
  }
  if (log.details && Object.keys(log.details).length > 0) {
    console.log(`│ Details:  ${JSON.stringify(log.details)}`);
  }
  if (log.stack) {
    console.log(`│ Stack:`);
    const lines = log.stack.split('\n').slice(0, 5);
    lines.forEach(l => console.log(`│   ${l.trim()}`));
  }
  console.log(`└─────────────────────────────────────────────────────────────────────────────`);
}

async function main() {
  const args = process.argv.slice(2);
  const isTail = args.includes('--tail') || args.includes('-t');
  const isClear = args.includes('--clear');
  const limitIdx = args.findIndex(a => a === '--limit' || a === '-n');
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 10;

  if (isClear) {
    console.log('Clearing diagnostic logs from Firestore...');
    const logs = await fetchLogs(100);
    for (const log of logs) {
      if (!log._id) continue;
      await fetch(`${FIRESTORE_BASE}/${COLLECTION}/${log._id}`, { method: 'DELETE' });
    }
    console.log(`Cleared ${logs.length} logs.`);
    return;
  }

  console.log(`========================================================`);
  console.log(`   Dotify Mobile Remote Diagnostics Viewer`);
  console.log(`   Firestore: ${FIREBASE_PROJECT_ID}/${COLLECTION}`);
  console.log(`========================================================`);

  if (isTail) {
    console.log('Tailing live logs (polling every 3s)... Press Ctrl+C to stop.\n');
    let seenIds = new Set();
    while (true) {
      const logs = await fetchLogs(15);
      for (const log of logs.reverse()) {
        if (!seenIds.has(log._id)) {
          seenIds.add(log._id);
          printLog(log);
        }
      }
      if (seenIds.size > 200) {
        seenIds = new Set([...seenIds].slice(-100));
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  } else {
    const logs = await fetchLogs(limit);
    if (logs.length === 0) {
      console.log('\nNo diagnostic error logs found in Firestore. Everything looks healthy!');
      return;
    }
    console.log(`Showing latest ${logs.length} events (most recent first):`);
    logs.forEach((log, idx) => printLog(log, idx));
  }
}

main().catch(err => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
