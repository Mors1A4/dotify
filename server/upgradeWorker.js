import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  onSnapshot,
  query,
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INBOX_ROOT = path.resolve(PROJECT_ROOT, 'inbox');
const FORKS_ROOT = path.resolve(PROJECT_ROOT, '../notify-forks');
const LOCAL_STORE_DIR = path.resolve(__dirname, 'data/upgrades');

const firebaseConfig = {
  apiKey: 'AIzaSyBRlXTMDnpFBsbas9Gl4ECUZTbzF3NLfmE',
  authDomain: 'dotify-11e01.firebaseapp.com',
  projectId: 'dotify-11e01',
  storageBucket: 'dotify-11e01.firebasestorage.app',
  messagingSenderId: '533066775942',
  appId: '1:533066775942:web:6ef28405b556f261960007',
  measurementId: 'G-11GZ3XVP9G',
};

const fbApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

const UPGRADE_COLLECTION = 'upgrade_requests';
const ATTACHMENT_COLLECTION = 'upgrade_request_attachments';
const SYSTEM_COLLECTION = 'upgrade_system';

let isProcessingQueue = false;
let activeRequestId = null;
const processedRunKeys = new Set();

function ensureDirs() {
  for (const dir of [INBOX_ROOT, FORKS_ROOT, LOCAL_STORE_DIR]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.warn('[UpgradeWorker] Could not create directory:', dir, err.message);
    }
  }
}

function stripAnsi(str) {
  if (!str) return '';
  return String(str).replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

function sanitizeSlug(text, fallback = 'upgrade') {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return clean || fallback;
}

function sanitizeForFirestore(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function saveLocalRequestCopy(reqDoc) {
  ensureDirs();
  try {
    const filePath = path.join(LOCAL_STORE_DIR, `${reqDoc.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(reqDoc, null, 2), 'utf8');
  } catch (err) {
    console.warn('[UpgradeWorker] Failed to save local request copy:', err.message);
  }
}

export function getLocalRequests() {
  ensureDirs();
  try {
    const files = fs.readdirSync(LOCAL_STORE_DIR).filter((f) => f.endsWith('.json'));
    const list = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(LOCAL_STORE_DIR, f), 'utf8');
        list.push(JSON.parse(raw));
      } catch {}
    }
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

async function updateRequestState(reqId, patch) {
  try {
    const docRef = doc(db, UPGRADE_COLLECTION, reqId);
    const cleanPatch = sanitizeForFirestore({
      ...patch,
      updatedAt: Date.now(),
    });
    await setDoc(docRef, cleanPatch, { merge: true });

    // Also update local file cache if present
    const localFile = path.join(LOCAL_STORE_DIR, `${reqId}.json`);
    let existing = {};
    if (fs.existsSync(localFile)) {
      try {
        existing = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      } catch {}
    }
    saveLocalRequestCopy({ ...existing, ...cleanPatch, id: reqId });
  } catch (err) {
    console.warn(`[UpgradeWorker] Firestore update warning for ${reqId}:`, err.message);
  }
}

function resolveOpencodeBinary() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
    'opencode',
  ];
  for (const candidate of candidates) {
    if (candidate !== 'opencode' && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'opencode';
}

export function ensureMainProjectGitRepo() {
  const gitDir = path.join(PROJECT_ROOT, '.git');
  try {
    if (!fs.existsSync(gitDir)) {
      console.log('[UpgradeWorker] Initializing git repository in main project:', PROJECT_ROOT);
      execSync('git init -b main', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      execSync('git config user.name "Dotify Upgrade Agent"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      execSync('git config user.email "upgrade-agent@dotify.local"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      execSync('git add -A', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      execSync('git commit -m "chore: initial Dotify main project repository"', {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
      console.log('[UpgradeWorker] Main project git repository initialized on branch main.');
    } else {
      // Ensure at least one commit exists
      try {
        execSync('git rev-parse --verify HEAD', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      } catch {
        execSync('git config user.name "Dotify Upgrade Agent"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        execSync('git config user.email "upgrade-agent@dotify.local"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        execSync('git add -A', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        execSync('git commit -m "chore: initial Dotify main project repository"', {
          cwd: PROJECT_ROOT,
          stdio: 'pipe',
        });
      }
    }
  } catch (err) {
    console.warn('[UpgradeWorker] Git init check warning:', err.message);
  }
}

async function resolveAttachmentDataUrl(att) {
  if (att.dataUrl && att.dataUrl.startsWith('data:')) {
    return att.dataUrl;
  }
  if (att.attachmentDocId) {
    try {
      const attSnap = await getDoc(doc(db, ATTACHMENT_COLLECTION, att.attachmentDocId));
      if (attSnap.exists()) {
        const data = attSnap.data();
        if (data && data.dataUrl) {
          return data.dataUrl;
        }
      }
    } catch (err) {
      console.warn('[UpgradeWorker] Failed to fetch attachment doc:', att.attachmentDocId, err.message);
    }
  }
  if (att.previewDataUrl && att.previewDataUrl.startsWith('data:')) {
    return att.previewDataUrl;
  }
  return null;
}

function extensionFromMime(mimeType, fallbackName = '') {
  const extFromName = path.extname(fallbackName || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extFromName)) {
    return extFromName;
  }
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

async function saveAttachmentsToInbox(reqDoc) {
  ensureDirs();
  const inboxDir = path.join(INBOX_ROOT, reqDoc.id);
  const latestDir = path.join(INBOX_ROOT, 'latest');

  for (const d of [inboxDir, latestDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // Collect attachments from both top-level and all messages
  const allAttachments = [];
  const seenIds = new Set();

  if (Array.isArray(reqDoc.attachments)) {
    for (const a of reqDoc.attachments) {
      if (a && !seenIds.has(a.id || a.name)) {
        seenIds.add(a.id || a.name);
        allAttachments.push(a);
      }
    }
  }
  if (Array.isArray(reqDoc.messages)) {
    for (const msg of reqDoc.messages) {
      if (Array.isArray(msg.attachments)) {
        for (const a of msg.attachments) {
          if (a && !seenIds.has(a.id || a.name)) {
            seenIds.add(a.id || a.name);
            allAttachments.push(a);
          }
        }
      }
    }
  }

  const savedImagePaths = [];

  for (let i = 0; i < allAttachments.length; i++) {
    const att = allAttachments[i];
    const dataUrl = await resolveAttachmentDataUrl(att);
    if (!dataUrl) continue;

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) continue;

    const mimeType = match[1];
    const base64Data = match[2];
    const ext = extensionFromMime(mimeType, att.name);
    const baseSlug = sanitizeSlug(path.basename(att.name || `image-${i + 1}`, path.extname(att.name || '')), `image-${i + 1}`);
    const fileName = `${i + 1}-${baseSlug}${ext}`;
    const filePath = path.join(inboxDir, fileName);

    try {
      const buf = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buf);
      savedImagePaths.push(filePath);

      // Also copy to inbox/latest for quick access
      const latestFilePath = path.join(latestDir, `${reqDoc.id}-${fileName}`);
      fs.writeFileSync(latestFilePath, buf);
    } catch (err) {
      console.warn('[UpgradeWorker] Failed to write image to inbox:', err.message);
    }
  }

  // Write human-readable markdown summary + raw json in inbox/<reqId>/
  const messagesText = Array.isArray(reqDoc.messages)
    ? reqDoc.messages
        .map(
          (m) =>
            `### [${new Date(m.createdAt || Date.now()).toISOString()}] ${String(m.role || 'user').toUpperCase()} (${m.authorName || 'User'})\n\n${m.text || ''}`
        )
        .join('\n\n---\n\n')
    : reqDoc.prompt || '';

  const markdownContent = `# ${reqDoc.type === 'fix' ? '[BUG FIX]' : '[FEATURE UPGRADE]'} ${reqDoc.title || reqDoc.id}

- **Request ID**: \`${reqDoc.id}\`
- **Type**: \`${reqDoc.type || 'upgrade'}\`
- **Submitted By**: ${reqDoc.submittedBy?.displayName || 'Dotify User'} (${reqDoc.submittedBy?.email || 'local'}) on \`${reqDoc.submittedBy?.platform || 'app'}\`
- **Created At**: ${new Date(reqDoc.createdAt || Date.now()).toISOString()}
- **Target Model**: \`opencode/muse-spark-1.3\` (\`--variant xhigh\`)
- **Inbox Folder**: \`${inboxDir}\`

## Saved Image Attachments (${savedImagePaths.length})
${savedImagePaths.length > 0 ? savedImagePaths.map((p) => `- \`${p}\``).join('\n') : '_No images attached_'}

## Chat Transcript & Instructions

${messagesText}
`;

  try {
    fs.writeFileSync(path.join(inboxDir, 'request.md'), markdownContent, 'utf8');
    fs.writeFileSync(path.join(inboxDir, 'request.json'), JSON.stringify(reqDoc, null, 2), 'utf8');
    fs.writeFileSync(path.join(latestDir, 'LATEST_REQUEST.md'), markdownContent, 'utf8');
  } catch (err) {
    console.warn('[UpgradeWorker] Failed writing request.md:', err.message);
  }

  return { inboxDir, savedImagePaths };
}

function prepareGitFork(reqDoc, savedImagePaths) {
  ensureMainProjectGitRepo();
  ensureDirs();

  const shortId = String(reqDoc.id || '')
    .replace(/^req_/, '')
    .slice(-6);
  const slug = sanitizeSlug(reqDoc.title || reqDoc.prompt, reqDoc.type || 'upgrade');
  const forkName = reqDoc.forkName || `${reqDoc.type || 'upgrade'}-${shortId}-${slug}`;
  const forkBranch = reqDoc.forkBranch || `fork/${forkName}`;
  const forkPath = reqDoc.forkPath || path.join(FORKS_ROOT, forkName);

  if (!fs.existsSync(forkPath)) {
    console.log(`[UpgradeWorker] Creating git fork at ${forkPath} (branch: ${forkBranch})...`);
    execSync(`git clone "${PROJECT_ROOT}" "${forkPath}"`, { stdio: 'pipe' });
    execSync('git config user.name "Dotify OpenCode Agent"', { cwd: forkPath, stdio: 'pipe' });
    execSync('git config user.email "opencode@dotify.local"', { cwd: forkPath, stdio: 'pipe' });
    execSync(`git checkout -b "${forkBranch}"`, { cwd: forkPath, stdio: 'pipe' });
  } else {
    try {
      execSync(`git checkout "${forkBranch}"`, { cwd: forkPath, stdio: 'pipe' });
    } catch {
      try {
        execSync(`git checkout -b "${forkBranch}"`, { cwd: forkPath, stdio: 'pipe' });
      } catch {}
    }
  }

  // Link node_modules via Windows directory junction so builds/checks work immediately in the fork
  const mainNodeModules = path.join(PROJECT_ROOT, 'node_modules');
  const forkNodeModules = path.join(forkPath, 'node_modules');
  if (fs.existsSync(mainNodeModules) && !fs.existsSync(forkNodeModules)) {
    try {
      execSync(`cmd /c mklink /J "${forkNodeModules}" "${mainNodeModules}"`, { stdio: 'pipe' });
    } catch (err) {
      console.warn('[UpgradeWorker] Could not junction node_modules into fork:', err.message);
    }
  }

  // Ensure opencode.json is configured in the fork
  const opencodeConfigPath = path.join(forkPath, 'opencode.json');
  const opencodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    model: 'opencode/muse-spark-1.3-contributor-free',
    small_model: 'opencode/muse-spark-1.3-contributor-free',
    permission: {
      bash: 'allow',
      edit: 'allow',
      write: 'allow',
      webfetch: 'allow',
    },
  };
  try {
    fs.writeFileSync(opencodeConfigPath, JSON.stringify(opencodeConfig, null, 2), 'utf8');
  } catch {}

  // Copy saved images into the fork under .upgrade-context/
  const forkContextDir = path.join(forkPath, '.upgrade-context');
  const forkImagePaths = [];
  try {
    if (!fs.existsSync(forkContextDir)) {
      fs.mkdirSync(forkContextDir, { recursive: true });
    }
    for (const imgPath of savedImagePaths) {
      if (fs.existsSync(imgPath)) {
        const dest = path.join(forkContextDir, path.basename(imgPath));
        fs.copyFileSync(imgPath, dest);
        forkImagePaths.push(dest);
      }
    }
  } catch (err) {
    console.warn('[UpgradeWorker] Warning copying images into fork context:', err.message);
  }

  return { forkName, forkBranch, forkPath, forkImagePaths };
}

function buildOpencodePrompt(reqDoc, forkInfo, savedImagePaths) {
  const userMessages = Array.isArray(reqDoc.messages)
    ? reqDoc.messages.filter((m) => m.role === 'user')
    : [];

  const transcript =
    userMessages.length > 0
      ? userMessages
          .map((m, idx) => `[Message ${idx + 1} from ${m.authorName || 'User'}]:\n${m.text}`)
          .join('\n\n')
      : reqDoc.prompt || reqDoc.title || '';

  const imageNote =
    savedImagePaths.length > 0
      ? `\nAttached reference images have been provided via -f and saved at:\n${savedImagePaths
          .map((p) => `- ${p}`)
          .join('\n')}\nPlease inspect the attached images carefully as visual context for this ${
          reqDoc.type === 'fix' ? 'bug fix' : 'feature upgrade'
        }.`
      : '';

  return [
    `You are implementing a ${reqDoc.type === 'fix' ? 'BUG FIX' : 'FEATURE UPGRADE'} for Dotify (notify) in a dedicated git fork.`,
    `Git Fork Directory: ${forkInfo.forkPath}`,
    `Git Branch: ${forkInfo.forkBranch}`,
    `Request Title: ${reqDoc.title || 'Feature Upgrade / Fix'}`,
    imageNote,
    `User Request / Chat Specification:\n${transcript}`,
    `\nInstructions:`,
    `1. Implement the requested ${reqDoc.type === 'fix' ? 'fix' : 'feature upgrade'} cleanly in this repository (${forkInfo.forkPath}).`,
    `2. Do not start long-running dev servers that block termination.`,
    `3. Verify your changes compile cleanly and summarize exactly what files you modified and how the upgrade/fix works.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function runOpencodeCli({ forkPath, savedImagePaths, promptText, onProgress }) {
  return new Promise((resolve) => {
    const bin = resolveOpencodeBinary();
    const modelId = process.env.DOTIFY_OPENCODE_MODEL || 'opencode/muse-spark-1.3-contributor-free';
    const variant = process.env.DOTIFY_OPENCODE_VARIANT || 'xhigh';

    const args = ['run', '-m', modelId, '--variant', variant];
    for (const imgPath of savedImagePaths) {
      if (fs.existsSync(imgPath)) {
        args.push(`--file=${imgPath}`);
      }
    }
    args.push('--', promptText);

    const displayCmd = `opencode run -m opencode/muse-spark-1.3 --variant ${variant} --dir "${forkPath}" ${savedImagePaths
      .map((p) => `-f "${p}"`)
      .join(' ')} "<prompt>"`;

    console.log(`[UpgradeWorker] Launching OpenCode CLI: ${displayCmd}`);

    const useShell = bin.endsWith('.cmd') || bin === 'opencode';
    const child = spawn(bin, args, {
      cwd: forkPath,
      stdio: ['ignore', 'pipe', 'pipe'], // 'ignore' on stdin prevents opencode from waiting for pipe EOF
      shell: useShell,
      windowsHide: true,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let combinedLogs = `[${new Date().toISOString()}] $ ${displayCmd}\n\n`;
    let lastFlush = 0;

    const maybeFlushProgress = (force = false) => {
      const now = Date.now();
      if (force || now - lastFlush > 2500) {
        lastFlush = now;
        if (onProgress) {
          onProgress(combinedLogs.slice(-12000), displayCmd);
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      const text = stripAnsi(chunk.toString());
      stdoutBuf += text;
      combinedLogs += text;
      maybeFlushProgress(false);
    });

    child.stderr.on('data', (chunk) => {
      const text = stripAnsi(chunk.toString());
      stderrBuf += text;
      combinedLogs += text;
      maybeFlushProgress(false);
    });

    // Safety timeout (15 minutes max for complex xhigh upgrades)
    const timeoutId = setTimeout(() => {
      combinedLogs += `\n[UpgradeWorker] OpenCode CLI timed out after 15 minutes; terminating process.\n`;
      try {
        child.kill('SIGTERM');
      } catch {}
    }, 15 * 60 * 1000);

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      combinedLogs += `\n[UpgradeWorker] Process error: ${err.message}\n`;
      maybeFlushProgress(true);
      resolve({
        ok: false,
        exitCode: -1,
        stdout: stdoutBuf.trim(),
        stderr: stderrBuf.trim(),
        logs: combinedLogs,
        displayCmd,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      maybeFlushProgress(true);
      resolve({
        ok: code === 0 || stdoutBuf.trim().length > 0,
        exitCode: code ?? 0,
        stdout: stdoutBuf.trim(),
        stderr: stderrBuf.trim(),
        logs: combinedLogs,
        displayCmd,
      });
    });
  });
}

function commitAndPushForkChanges(forkInfo, reqDoc) {
  const { forkPath, forkBranch } = forkInfo;
  let changedFiles = [];
  let commitHash = '';

  try {
    // Remove temporary .upgrade-context before committing so we only commit real project changes
    const ctxDir = path.join(forkPath, '.upgrade-context');
    if (fs.existsSync(ctxDir)) {
      try {
        fs.rmSync(ctxDir, { recursive: true, force: true });
      } catch {}
    }

    const statusOut = execSync('git status --porcelain', { cwd: forkPath, stdio: 'pipe' })
      .toString()
      .trim();

    if (statusOut) {
      changedFiles = statusOut
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      execSync('git add -A', { cwd: forkPath, stdio: 'pipe' });
      const commitTitle = String(reqDoc.title || reqDoc.prompt || 'implement upgrade')
        .replace(/["\r\n]+/g, ' ')
        .slice(0, 72);
      const prefix = reqDoc.type === 'fix' ? 'fix' : 'feat';
      execSync(`git commit -m "${prefix}(opencode): ${commitTitle}"`, {
        cwd: forkPath,
        stdio: 'pipe',
      });
    } else {
      // Check if opencode itself already committed changes during its run
      try {
        const diffMain = execSync('git diff --name-status origin/main..HEAD', {
          cwd: forkPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();
        if (diffMain) {
          changedFiles = diffMain
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        }
      } catch {}
    }

    try {
      commitHash = execSync('git rev-parse --short HEAD', { cwd: forkPath, stdio: 'pipe' })
        .toString()
        .trim();
    } catch {}

    // Push the fork branch back to the main project repo so `git branch -a` in notify shows `fork/<name>`
    try {
      execSync(`git push origin HEAD:refs/heads/${forkBranch} --force`, {
        cwd: forkPath,
        stdio: 'pipe',
      });
      console.log(`[UpgradeWorker] Pushed branch ${forkBranch} back to main project (${commitHash}).`);
    } catch (pushErr) {
      console.warn('[UpgradeWorker] Branch push warning:', pushErr.message);
    }
  } catch (err) {
    console.warn('[UpgradeWorker] Git commit/push warning:', err.message);
  }

  return { changedFiles, commitHash };
}

export async function processUpgradeRequest(reqDoc) {
  if (!reqDoc || !reqDoc.id) return;
  const runKey = `${reqDoc.id}_${reqDoc.updatedAt || reqDoc.createdAt || 0}`;
  if (processedRunKeys.has(runKey) || activeRequestId === reqDoc.id) {
    return;
  }
  processedRunKeys.add(runKey);
  activeRequestId = reqDoc.id;

  console.log(`[UpgradeWorker] Processing ${reqDoc.type || 'upgrade'} request: ${reqDoc.id} ("${reqDoc.title || ''}")`);

  try {
    await updateHeartbeat('busy', reqDoc.id);

    // 1. Save images and markdown transcript to local PC Inbox
    await updateRequestState(reqDoc.id, {
      status: 'processing',
      agentLogs: `[1/4] Receiving request & saving attached images to local PC inbox...\n`,
    });

    const { inboxDir, savedImagePaths } = await saveAttachmentsToInbox(reqDoc);

    // 2. Create Git Fork of the main project
    await updateRequestState(reqDoc.id, {
      status: 'processing',
      inboxDir,
      savedImages: savedImagePaths,
      agentLogs: `[1/4] Saved ${savedImagePaths.length} image(s) to ${inboxDir}\n[2/4] Creating git fork of main project...\n`,
    });

    const forkInfo = prepareGitFork(reqDoc, savedImagePaths);

    // 3. Run OpenCode CLI with Muse Spark 1.3 (xhigh)
    const promptText = buildOpencodePrompt(reqDoc, forkInfo, savedImagePaths);

    await updateRequestState(reqDoc.id, {
      status: 'processing',
      forkName: forkInfo.forkName,
      forkBranch: forkInfo.forkBranch,
      forkPath: forkInfo.forkPath,
      agentLogs:
        `[1/4] Saved ${savedImagePaths.length} image(s) to ${inboxDir}\n` +
        `[2/4] Created git fork at ${forkInfo.forkPath} (branch: ${forkInfo.forkBranch})\n` +
        `[3/4] Running OpenCode CLI with Muse Spark 1.3 (xhigh)...\n\n`,
    });

    const cliResult = await runOpencodeCli({
      forkPath: forkInfo.forkPath,
      savedImagePaths,
      promptText,
      onProgress: (liveLogs, displayCmd) => {
        updateRequestState(reqDoc.id, {
          status: 'processing',
          cliCommand: displayCmd,
          agentLogs:
            `[1/4] Saved ${savedImagePaths.length} image(s) to ${inboxDir}\n` +
            `[2/4] Git Fork: ${forkInfo.forkPath} (${forkInfo.forkBranch})\n` +
            `[3/4] Running OpenCode CLI (muse-spark-1.3 xhigh)...\n\n` +
            liveLogs,
        });
      },
    });

    // 4. Commit changes in the fork and push branch back to main repo
    const { changedFiles, commitHash } = commitAndPushForkChanges(forkInfo, reqDoc);

    const summaryText =
      cliResult.stdout ||
      (cliResult.ok
        ? `Implemented ${reqDoc.type === 'fix' ? 'fix' : 'upgrade'} in git fork \`${forkInfo.forkBranch}\`.`
        : `OpenCode exited with code ${cliResult.exitCode}. See CLI logs for details.`);

    const assistantMsg = {
      id: `msg_${Date.now()}_ai`,
      role: 'assistant',
      authorName: 'OpenCode (Muse Spark 1.3 xhigh)',
      createdAt: Date.now(),
      text:
        `${summaryText}\n\n` +
        `---\n` +
        `- **Git Fork Path**: \`${forkInfo.forkPath}\`\n` +
        `- **Git Branch**: \`${forkInfo.forkBranch}\`${commitHash ? ` (\`${commitHash}\`)` : ''}\n` +
        `- **Inbox Images Saved**: \`${inboxDir}\` (${savedImagePaths.length} file${savedImagePaths.length === 1 ? '' : 's'})\n` +
        (changedFiles.length > 0
          ? `- **Modified Files (${changedFiles.length})**:\n${changedFiles.map((f) => `  - \`${f}\``).join('\n')}`
          : `- **Modified Files**: Working tree clean / committed in fork`),
    };

    const existingMessages = Array.isArray(reqDoc.messages) ? reqDoc.messages : [];
    const finalStatus = cliResult.ok ? 'completed' : 'failed';

    await updateRequestState(reqDoc.id, {
      status: finalStatus,
      completedAt: Date.now(),
      inboxDir,
      savedImages: savedImagePaths,
      forkName: forkInfo.forkName,
      forkBranch: forkInfo.forkBranch,
      forkPath: forkInfo.forkPath,
      cliCommand: cliResult.displayCmd,
      agentLogs:
        `[1/4] Saved ${savedImagePaths.length} image(s) to ${inboxDir}\n` +
        `[2/4] Git Fork: ${forkInfo.forkPath} (branch: ${forkInfo.forkBranch})\n` +
        `[3/4] OpenCode (muse-spark-1.3 xhigh) finished (exit code ${cliResult.exitCode})\n` +
        `[4/4] Committed & pushed branch ${forkInfo.forkBranch} (${commitHash || 'HEAD'})\n\n` +
        cliResult.logs.slice(-15000),
      agentSummary: summaryText,
      changedFiles,
      commitHash,
      messages: [...existingMessages, assistantMsg],
      error: cliResult.ok ? '' : cliResult.error || `Exit code ${cliResult.exitCode}`,
    });

    console.log(`[UpgradeWorker] Completed request ${reqDoc.id} -> branch ${forkInfo.forkBranch}`);

    if (cliResult.ok && reqDoc.autoApply) {
      try {
        console.log(`[UpgradeWorker] autoApply is enabled for ${reqDoc.id} — applying changes & publishing update...`);
        await applyAndReleaseForkUpgrade(reqDoc.id);
      } catch (applyErr) {
        console.warn('[UpgradeWorker] autoApply error:', applyErr.message);
      }
    }
  } catch (err) {
    console.error(`[UpgradeWorker] Error processing request ${reqDoc.id}:`, err);
    await updateRequestState(reqDoc.id, {
      status: 'failed',
      error: err.message || String(err),
      agentLogs: `[ERROR] ${err.stack || err.message || String(err)}`,
    });
  } finally {
    activeRequestId = null;
    await updateHeartbeat('online', null);
  }
}

export async function applyAndReleaseForkUpgrade(requestId) {
  const docRef = doc(db, UPGRADE_COLLECTION, requestId);
  const snap = await getDoc(docRef);
  let reqDoc = snap.exists() ? snap.data() : null;
  if (!reqDoc) {
    reqDoc = getLocalRequests().find((r) => r.id === requestId);
  }
  if (!reqDoc) {
    throw new Error(`Upgrade request ${requestId} not found.`);
  }

  const { forkBranch, forkPath } = reqDoc;
  if (!forkBranch) {
    throw new Error(`Request has no associated fork branch.`);
  }

  console.log(`[UpgradeWorker] Applying upgrade ${requestId} (branch: ${forkBranch})...`);

  await updateRequestState(requestId, {
    status: 'processing',
    agentLogs: (reqDoc.agentLogs || '') + `\n[5/6] Merging changes from ${forkBranch} into live project...\n`,
  });

  try {
    // 1. Copy or merge modified files from fork
    if (forkPath && fs.existsSync(forkPath) && Array.isArray(reqDoc.changedFiles) && reqDoc.changedFiles.length > 0) {
      console.log(`[UpgradeWorker] Applying changed files from fork ${forkPath}...`);
      for (const fileLine of reqDoc.changedFiles) {
        const relPath = fileLine.replace(/^[MADRCU?!]+\s+/, '').trim();
        if (relPath.startsWith('.upgrade-context') || relPath === 'opencode.json') continue;
        const srcFile = path.join(forkPath, relPath);
        const destFile = path.join(PROJECT_ROOT, relPath);
        if (fs.existsSync(srcFile) && fs.statSync(srcFile).isFile()) {
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.copyFileSync(srcFile, destFile);
          console.log(`[UpgradeWorker] Copied: ${relPath}`);
        }
      }
    } else {
      execSync(`git merge --no-ff "${forkBranch}" -m "feat(upgrade): apply ${sanitizeSlug(reqDoc.title || 'feature upgrade')}"`, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
    }

    // 2. Commit changes to main git repo
    try {
      execSync('git add -A', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      const commitTitle = String(reqDoc.title || reqDoc.prompt || 'upgrade').replace(/["\r\n]+/g, ' ').slice(0, 72);
      execSync(`git commit -m "feat: ${commitTitle}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
    } catch {}

    // 3. Verify frontend build passes cleanly
    await updateRequestState(requestId, {
      agentLogs: (reqDoc.agentLogs || '') + `\n[5/6] Verifying project build...\n`,
    });
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });

    // 4. Publish update package (patch bump) to GitHub Releases CDN + Firestore
    await updateRequestState(requestId, {
      agentLogs: (reqDoc.agentLogs || '') + `\n[6/6] Publishing release package to GitHub Releases CDN & Firestore...\n`,
    });

    const releaseScript = path.join(PROJECT_ROOT, 'scripts', 'release.mjs');
    const releaseCmd = `node "${releaseScript}" patch --skip-build --notes "Implemented: ${reqDoc.title || 'Feature upgrade'}"`;
    execSync(releaseCmd, { cwd: PROJECT_ROOT, stdio: 'pipe' });

    // 5. Read new version
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const newVersion = pkg.version;

    const successMessage = {
      id: `msg_${Date.now()}_released`,
      role: 'assistant',
      authorName: 'OpenCode Release Manager',
      createdAt: Date.now(),
      text: `🚀 **Update v${newVersion} Published!**\n\nThe changes from \`${forkBranch}\` have been merged and published.\n\nAll Dotify clients across Windows Desktop and Android will now receive this update on startup.`,
    };

    const existingMessages = Array.isArray(reqDoc.messages) ? reqDoc.messages : [];

    await updateRequestState(requestId, {
      status: 'released',
      releasedVersion: newVersion,
      releasedAt: Date.now(),
      agentLogs:
        (reqDoc.agentLogs || '') +
        `\n[SUCCESS] Update v${newVersion} published successfully to GitHub CDN and Firestore.\n`,
      messages: [...existingMessages, successMessage],
    });

    return { ok: true, version: newVersion };
  } catch (err) {
    console.error(`[UpgradeWorker] Failed applying upgrade:`, err);
    await updateRequestState(requestId, {
      error: `Apply/Release failed: ${err.message}`,
      agentLogs: (reqDoc.agentLogs || '') + `\n[ERROR] Apply/Release failed: ${err.message}\n`,
    });
    throw err;
  }
}

export async function drainUpgradeQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const q = query(collection(db, UPGRADE_COLLECTION));
    const snapshot = await getDocs(q);
    const queued = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id) {
        saveLocalRequestCopy(data);
        if (data.status === 'queued') {
          queued.push(data);
        }
      }
    });

    // Sort FIFO by createdAt / updatedAt
    queued.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    for (const item of queued) {
      await processUpgradeRequest(item);
    }
  } catch (err) {
    console.debug('[UpgradeWorker] Queue check deferred (offline or reconnecting):', err.message);
  } finally {
    isProcessingQueue = false;
  }
}

async function updateHeartbeat(state = 'online', currentJobId = null) {
  try {
    const ref = doc(db, SYSTEM_COLLECTION, 'host_status');
    await setDoc(
      ref,
      {
        status: state,
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.release()}`,
        model: 'opencode/muse-spark-1.3 (xhigh)',
        activeRequestId: currentJobId || activeRequestId || null,
        inboxRoot: INBOX_ROOT,
        forksRoot: FORKS_ROOT,
        lastSeen: Date.now(),
      },
      { merge: true }
    );
  } catch {}
}

let workerStarted = false;

export function startUpgradeWorker(app) {
  if (workerStarted) return;
  workerStarted = true;

  ensureDirs();
  ensureMainProjectGitRepo();

  console.log('[UpgradeWorker] Starting Firebase Cloud Queue & OpenCode (muse-spark-1.3 xhigh) Worker...');

  // 1. Register REST endpoints on Express `app` if provided
  if (app) {
    app.get('/api/upgrades/status', (req, res) => {
      res.json({
        ok: true,
        online: true,
        hostname: os.hostname(),
        model: 'opencode/muse-spark-1.3',
        variant: 'xhigh',
        activeRequestId,
        inboxRoot: INBOX_ROOT,
        forksRoot: FORKS_ROOT,
        lastSeen: Date.now(),
      });
    });

    app.get('/api/upgrades', (req, res) => {
      res.json({
        ok: true,
        requests: getLocalRequests(),
      });
    });

    app.post('/api/upgrades', async (req, res) => {
      try {
        const body = req.body || {};
        const id = body.id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const now = Date.now();

        // Save attachments to Firestore attachment collection if provided
        const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
        const docAttachments = [];

        for (let i = 0; i < rawAttachments.length; i++) {
          const att = rawAttachments[i];
          const attDocId = `${id}_att_${i}`;
          if (att.dataUrl) {
            try {
              await setDoc(doc(db, ATTACHMENT_COLLECTION, attDocId), {
                id: attDocId,
                requestId: id,
                name: att.name || `image-${i + 1}.png`,
                mimeType: att.mimeType || 'image/png',
                dataUrl: att.dataUrl,
                createdAt: now,
              });
            } catch {}
          }
          docAttachments.push({
            id: att.id || attDocId,
            name: att.name || `image-${i + 1}.png`,
            mimeType: att.mimeType || 'image/png',
            attachmentDocId: attDocId,
            previewDataUrl: att.previewDataUrl || att.dataUrl || '',
            sizeBytes: att.sizeBytes || 0,
          });
        }

        const reqDoc = sanitizeForFirestore({
          id,
          type: body.type === 'fix' ? 'fix' : 'upgrade',
          title: (body.title || '').trim() || (body.prompt || 'Upgrade Request').slice(0, 60),
          prompt: body.prompt || '',
          status: 'queued',
          model: 'opencode/muse-spark-1.3 (xhigh)',
          createdAt: body.createdAt || now,
          updatedAt: now,
          submittedBy: body.submittedBy || {
            uid: 'local',
            email: 'local@dotify.app',
            displayName: 'Dotify User',
            platform: 'desktop',
          },
          attachments: docAttachments,
          messages: Array.isArray(body.messages) && body.messages.length > 0
            ? body.messages
            : [
                {
                  id: `msg_${now}`,
                  role: 'user',
                  authorName: body.submittedBy?.displayName || 'Dotify User',
                  text: body.prompt || '',
                  attachments: docAttachments,
                  createdAt: now,
                },
              ],
        });

        saveLocalRequestCopy(reqDoc);
        await setDoc(doc(db, UPGRADE_COLLECTION, id), reqDoc, { merge: true });

        // Trigger asynchronous queue processing immediately
        setTimeout(() => {
          drainUpgradeQueue();
        }, 50);

        res.json({ ok: true, request: reqDoc });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.post('/api/upgrades/:id/reply', async (req, res) => {
      try {
        const { id } = req.params;
        const { text, attachments = [], authorName = 'Dotify User' } = req.body || {};
        const now = Date.now();

        const docRef = doc(db, UPGRADE_COLLECTION, id);
        const snap = await getDoc(docRef);
        let existing = snap.exists() ? snap.data() : null;
        if (!existing) {
          const localList = getLocalRequests();
          existing = localList.find((r) => r.id === id);
        }
        if (!existing) {
          return res.status(404).json({ ok: false, error: 'Request not found' });
        }

        const docAttachments = [];
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          const attDocId = `${id}_att_${now}_${i}`;
          if (att.dataUrl) {
            try {
              await setDoc(doc(db, ATTACHMENT_COLLECTION, attDocId), {
                id: attDocId,
                requestId: id,
                name: att.name || `image-${i + 1}.png`,
                mimeType: att.mimeType || 'image/png',
                dataUrl: att.dataUrl,
                createdAt: now,
              });
            } catch {}
          }
          docAttachments.push({
            id: att.id || attDocId,
            name: att.name || `image-${i + 1}.png`,
            mimeType: att.mimeType || 'image/png',
            attachmentDocId: attDocId,
            previewDataUrl: att.previewDataUrl || att.dataUrl || '',
            sizeBytes: att.sizeBytes || 0,
          });
        }

        const newMsg = {
          id: `msg_${now}`,
          role: 'user',
          authorName,
          text: text || '',
          attachments: docAttachments,
          createdAt: now,
        };

        const updatedMessages = [...(existing.messages || []), newMsg];
        const updatedAttachments = [...(existing.attachments || []), ...docAttachments];

        await updateRequestState(id, {
          status: 'queued',
          prompt: text || existing.prompt,
          messages: updatedMessages,
          attachments: updatedAttachments,
          updatedAt: now,
        });

        setTimeout(() => {
          drainUpgradeQueue();
        }, 50);

        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.post('/api/upgrades/:id/apply', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await applyAndReleaseForkUpgrade(id);
        res.json(result);
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  // 2. Initial heartbeat & immediate drain of any requests queued while PC was off
  updateHeartbeat('online', null);
  drainUpgradeQueue();

  // 3. Real-time Firestore listener so new requests from any device trigger immediately
  try {
    const q = query(collection(db, UPGRADE_COLLECTION));
    onSnapshot(
      q,
      (snapshot) => {
        let hasQueued = false;
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data && data.id) {
            saveLocalRequestCopy(data);
            if (data.status === 'queued') {
              hasQueued = true;
            }
          }
        });
        if (hasQueued) {
          drainUpgradeQueue();
        }
      },
      (err) => {
        console.debug('[UpgradeWorker] Firestore realtime listener warning:', err.message);
      }
    );
  } catch (err) {
    console.debug('[UpgradeWorker] Firestore listener setup deferred:', err.message);
  }

  // 4. Periodic heartbeat & fallback queue poll every 15 seconds (handles wake-from-sleep / network reconnects)
  setInterval(() => {
    updateHeartbeat(activeRequestId ? 'busy' : 'online', activeRequestId);
    drainUpgradeQueue();
  }, 15000);
}

// Allow running `node server/upgradeWorker.js` directly as a standalone daemon
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startUpgradeWorker(null);
}
