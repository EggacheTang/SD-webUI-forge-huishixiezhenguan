const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { execFile, spawn } = require('node:child_process');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const FORGE_ARGS = [
  '--disable-ipex-hijack',
  '--theme',
  'dark',
  '--xformers',
  '--api',
  '--cors-allow-origins=*',
  '--no-gradio-queue',
  '--no-download-sd-model',
  '--skip-python-version-check'
];
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'app-config.json');
const PIP_CONSTRAINT_PATH = path.join(CONFIG_DIR, 'pip-constraints.txt');
const OUTPUT_DIR = path.join(__dirname, 'outputs', 'generated');
const LOG_DIR = path.join(__dirname, 'outputs', 'logs');
const PREVIEW_DIR = path.join(__dirname, 'previews');
const FORGE_OPTIONS_URL = 'http://127.0.0.1:7860/sdapi/v1/options';
const FORGE_TXT2IMG_URL = 'http://127.0.0.1:7860/sdapi/v1/txt2img';
const FORGE_COUNT_TOKENS_URL = 'http://127.0.0.1:7860/sdapi/v1/count_tokens';
const FORGE_INTERRUPT_URL = 'http://127.0.0.1:7860/sdapi/v1/interrupt';
const MAX_FORGE_SEED = 4294967295;
const FIXED_TXT2IMG_SCHEDULER = 'Automatic';
const FIXED_CLIP_SKIP = 2;
const TXT2IMG_FALLBACK_DEFAULTS = {
  steps: 20,
  cfgScale: 7,
  samplerName: 'Euler a',
  scheduler: 'Normal',
  hiresDenoisingStrength: 0.4,
  hiresScale: 1.5,
  hiresSteps: 20,
  hiresUpscaler: 'R-ESRGAN 4x+ Anime6B',
  hiresSamplerName: '',
  hiresScheduler: ''
};

let mainWindow = null;
let forgeProcess = null;
let forgePollTimer = null;
let forgeHeartbeatTimer = null;
let forgeLogTailTimer = null;
let forgeLogTailPath = '';
let forgeLogTailOffset = 0;
let forgeLogTailBuffer = '';
let lastForgeStatus = 'unknown';
let closeConfirmed = false;
let closeInProgress = false;
let generationCancelRequested = false;
let generationPaused = false;
let generationSkipRequested = false;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendLog(level, message) {
  sendToRenderer('app-log', {
    level,
    message,
    timestamp: new Date().toISOString()
  });
}

function sendForgeLog(level, message) {
  sendToRenderer('forge-log', {
    level,
    message,
    timestamp: new Date().toISOString()
  });
}

function sendForgeStatus(status, message) {
  lastForgeStatus = status;
  sendToRenderer('forge-status', {
    status,
    message,
    timestamp: new Date().toISOString()
  });
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const configuredForgeRoot = typeof parsed.forgeRoot === 'string' ? parsed.forgeRoot : '';
    const resolvedForgeRoot = resolveForgeRoot(configuredForgeRoot) || autoDetectForgeRoot();

    return {
      forgeRoot: resolvedForgeRoot || ''
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      sendForgeLog('warn', `Failed to read config: ${error.message}`);
    }

    return { forgeRoot: autoDetectForgeRoot() || '' };
  }
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function getLocalDateFolderName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function openForgeProcessLogFile() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const filePath = path.join(LOG_DIR, `forge-${getLocalDateFolderName()}.log`);
  fs.appendFileSync(filePath, `\n\n===== Forge launch ${new Date().toISOString()} =====\n`, 'utf8');
  const initialOffset = fs.statSync(filePath).size;

  return {
    filePath,
    fd: fs.openSync(filePath, 'a'),
    initialOffset
  };
}

function getLatestForgeLogFile() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      return '';
    }

    const files = fs.readdirSync(LOG_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^forge-\d{4}-\d{2}-\d{2}\.log$/i.test(entry.name))
      .map(entry => {
        const filePath = path.join(LOG_DIR, entry.name);
        const stats = fs.statSync(filePath);
        return { filePath, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return files[0]?.filePath || '';
  } catch {
    return '';
  }
}

function stopForgeLogTail() {
  if (forgeLogTailTimer) {
    clearInterval(forgeLogTailTimer);
    forgeLogTailTimer = null;
  }

  forgeLogTailPath = '';
  forgeLogTailOffset = 0;
  forgeLogTailBuffer = '';
}

function flushForgeLogTailText(text) {
  const combined = forgeLogTailBuffer + text;
  const lines = combined.split(/\r?\n/);
  forgeLogTailBuffer = lines.pop() || '';

  lines
    .map(line => line.trimEnd())
    .filter(Boolean)
    .forEach(line => sendForgeLog('info', line));
}

function pollForgeLogTail() {
  if (!forgeLogTailPath) return;

  try {
    const stats = fs.statSync(forgeLogTailPath);

    if (stats.size < forgeLogTailOffset) {
      forgeLogTailOffset = 0;
      forgeLogTailBuffer = '';
    }

    if (stats.size === forgeLogTailOffset) return;

    const fd = fs.openSync(forgeLogTailPath, 'r');
    try {
      const length = stats.size - forgeLogTailOffset;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, forgeLogTailOffset);
      forgeLogTailOffset = stats.size;
      flushForgeLogTailText(buffer.toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    sendForgeLog('warn', `Could not read Forge log tail: ${error.message}`);
    stopForgeLogTail();
  }
}

function startForgeLogTail(filePath, options = {}) {
  if (!filePath) return;
  if (forgeLogTailPath === filePath && forgeLogTailTimer) return;

  stopForgeLogTail();
  forgeLogTailPath = filePath;
  forgeLogTailBuffer = '';

  try {
    const stats = fs.statSync(filePath);
    forgeLogTailOffset = Number.isFinite(options.offset) ? options.offset : stats.size;
  } catch {
    forgeLogTailOffset = 0;
  }

  sendForgeLog('info', `Watching Forge process log: ${filePath}`);
  forgeLogTailTimer = setInterval(pollForgeLogTail, 1000);
}

function saveGeneratedImage(base64Image, index) {
  const now = new Date();
  const outputDir = path.join(OUTPUT_DIR, getLocalDateFolderName(now));
  fs.mkdirSync(outputDir, { recursive: true });

  const cleanBase64 = String(base64Image || '').replace(/^data:image\/\w+;base64,/, '');
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outputDir, `forge-${timestamp}-${String(index + 1).padStart(2, '0')}.png`);

  fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));

  return {
    src: pathToFileURL(filePath).href,
    filePath
  };
}

function sanitizePreviewFileBaseName(value) {
  const rawName = String(value || '').trim() || 'preview';
  const withoutExtension = rawName.replace(/\.(png|jpe?g|webp)$/i, '');
  const safeName = withoutExtension
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);

  if (!safeName) {
    return 'preview';
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeName)) {
    return `${safeName}_preview`;
  }

  return safeName;
}

function sanitizePreviewFolderName(value) {
  const safeName = sanitizePreviewFileBaseName(value);

  return safeName === 'preview' ? '' : safeName;
}

function sanitizePreviewFolderPath(value) {
  return String(value || '')
    .split(/[\\/]+/)
    .map(segment => sanitizePreviewFolderName(segment))
    .filter(Boolean);
}

function copyPreviewImage(sourceFilePath, baseName, folderName = '') {
  const safeFolderParts = sanitizePreviewFolderPath(folderName);
  const targetDir = safeFolderParts.length > 0
    ? path.join(PREVIEW_DIR, ...safeFolderParts)
    : PREVIEW_DIR;

  fs.mkdirSync(targetDir, { recursive: true });

  const fileName = `${sanitizePreviewFileBaseName(baseName)}.png`;
  const filePath = path.join(targetDir, fileName);

  fs.copyFileSync(sourceFilePath, filePath);

  return {
    src: pathToFileURL(filePath).href,
    filePath,
    relativePath: path.join('previews', ...safeFolderParts, fileName).replace(/\\/g, '/')
  };
}

function resolveImageFilePath(value) {
  const source = String(value || '').trim();

  if (!source) {
    return '';
  }

  if (/^file:\/\//i.test(source)) {
    return fileURLToPath(source);
  }

  if (!path.isAbsolute(source)) {
    return path.join(__dirname, source);
  }

  return source;
}

function waitForGenerationResume() {
  if (!generationPaused) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!generationPaused || generationCancelRequested) {
        clearInterval(timer);
        resolve();
      }
    }, 300);
  });
}

function parseGenerationInfo(infoData) {
  if (infoData && typeof infoData === 'object') {
    return infoData;
  }

  if (typeof infoData !== 'string' || !infoData.trim()) {
    return {};
  }

  const text = infoData.trim();

  try {
    return JSON.parse(text);
  } catch {
    return { infotext: text };
  }
}

function parseSeedFromText(value) {
  const match = String(value || '').match(/(?:^|[,;\n\r])\s*Seed:\s*(\d+)/i);
  if (!match) return NaN;

  const seed = Number(match[1]);
  return Number.isFinite(seed) && seed >= 0 ? seed : NaN;
}

function getSeedCandidate(value) {
  if (typeof value === 'string' && /Seed:/i.test(value)) {
    return parseSeedFromText(value);
  }

  const seed = Number(value);
  return Number.isFinite(seed) && seed >= 0 ? seed : NaN;
}

function attachImageMetadata(image, inputItem, payload, result, imageIndex) {
  const info = parseGenerationInfo(result?.info);
  const allSeeds = Array.isArray(info.all_seeds) ? info.all_seeds : [];
  const infotexts = Array.isArray(info.infotexts) ? info.infotexts : [];
  const actualSeed = [
    allSeeds[imageIndex],
    info.seed,
    infotexts[imageIndex],
    info.infotext,
    info.infotexts,
    result?.info,
    allSeeds[0],
    result?.parameters?.seed,
    payload.seed
  ].map(getSeedCandidate).find(seed => Number.isFinite(seed) && seed >= 0) ?? payload.seed;

  return {
    ...image,
    meta: {
      timestamp: new Date().toISOString(),
      prompt: payload.prompt || '',
      negativePrompt: payload.negative_prompt || '',
      width: payload.width,
      height: payload.height,
      seed: actualSeed,
      requestedSeed: payload.seed,
      hiresFix: Boolean(payload.enable_hr),
      adetailer: Boolean(payload.alwayson_scripts?.ADetailer),
      adetailerPrompts: inputItem?.adetailerPrompts || null,
      scheduler: payload.scheduler || '',
      clipSkip: payload.override_settings?.CLIP_stop_at_last_layers || FIXED_CLIP_SKIP,
      selectedCards: Array.isArray(inputItem?.selectedCards) ? inputItem.selectedCards : [],
      generationInfo: info,
      payload
    }
  };
}

function getForgeBatPath(forgeRoot) {
  return path.join(forgeRoot, 'webui-user.bat');
}

function getForgeWebuiBatPath(forgeRoot) {
  return path.join(forgeRoot, 'webui.bat');
}

function isForgeRoot(candidatePath) {
  return Boolean(
    candidatePath &&
    fs.existsSync(getForgeBatPath(candidatePath)) &&
    fs.existsSync(getForgeWebuiBatPath(candidatePath))
  );
}

function getDirectoryChildrenSafe(parentPath) {
  try {
    return fs.readdirSync(parentPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(parentPath, entry.name));
  } catch {
    return [];
  }
}

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];

  for (const item of paths) {
    if (!item || typeof item !== 'string') continue;

    const resolved = path.resolve(item);
    const key = resolved.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }

  return result;
}

function getForgeRootCandidates(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return [];
  }

  const basePath = path.resolve(inputPath);
  const parentPath = path.dirname(basePath);
  const grandParentPath = path.dirname(parentPath);
  const directChildren = getDirectoryChildrenSafe(basePath);
  const parentChildren = getDirectoryChildrenSafe(parentPath);
  const grandChildren = directChildren.flatMap(getDirectoryChildrenSafe);
  const likelyDirectChildren = directChildren.filter(item => /forge|webui|stable/i.test(path.basename(item)));
  const likelyGrandChildren = grandChildren.filter(item => /forge|webui|stable/i.test(path.basename(item)));
  const likelyParentChildren = parentChildren.filter(item => /forge|webui|stable/i.test(path.basename(item)));

  return uniquePaths([
    basePath,
    path.join(basePath, 'sd-webui-forge-aki-v1.0'),
    path.join(basePath, 'sd-webui-forge'),
    ...likelyDirectChildren,
    ...likelyGrandChildren,
    ...directChildren,
    ...grandChildren,
    parentPath,
    grandParentPath,
    ...likelyParentChildren
  ]);
}

function resolveForgeRoot(inputPath) {
  return getForgeRootCandidates(inputPath).find(isForgeRoot) || '';
}

function autoDetectForgeRoot() {
  const roots = uniquePaths([
    __dirname,
    process.cwd(),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    path.dirname(__dirname),
    path.dirname(path.dirname(__dirname)),
    path.dirname(path.dirname(path.dirname(__dirname)))
  ]);

  for (const root of roots) {
    const resolved = resolveForgeRoot(root);
    if (resolved) {
      return resolved;
    }
  }

  return '';
}

function buildForgeEnv(forgeRoot) {
  const pythonDir = path.join(forgeRoot, 'python');
  const gitDir = path.join(forgeRoot, 'git', 'cmd');
  const cacheDir = path.join(forgeRoot, 'cache');
  const dotCacheDir = path.join(forgeRoot, '.cache');
  const matplotlibDir = path.join(cacheDir, 'matplotlib');
  const pipCacheDir = path.join(cacheDir, 'pip');
  const transformersCacheDir = path.join(cacheDir, 'huggingface');
  const pathParts = [];

  for (const dir of [cacheDir, dotCacheDir, matplotlibDir, pipCacheDir, transformersCacheDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(path.join(pythonDir, 'python.exe'))) {
    pathParts.push(pythonDir);
  }

  if (fs.existsSync(path.join(gitDir, 'git.exe'))) {
    pathParts.push(gitDir);
  }

  pathParts.push(process.env.Path || process.env.PATH || '');

  return {
    ...process.env,
    PYTHON: `"${path.join(pythonDir, 'python.exe')}"`,
    Path: pathParts.filter(Boolean).join(path.delimiter),
    PATH: pathParts.filter(Boolean).join(path.delimiter),
    PIP_CONSTRAINT: PIP_CONSTRAINT_PATH,
    PIP_BUILD_CONSTRAINT: PIP_CONSTRAINT_PATH,
    PIP_CACHE_DIR: pipCacheDir,
    PIP_INDEX_URL: 'https://mirrors.cloud.tencent.com/pypi/simple',
    INDEX_URL: 'https://mirrors.cloud.tencent.com/pypi/simple',
    TORCH_INDEX_URL: 'https://download.pytorch.org/whl/cu124',
    SKIP_VENV: '1',
    HF_HOME: transformersCacheDir,
    HUGGINGFACE_HUB_CACHE: path.join(transformersCacheDir, 'hub'),
    TRANSFORMERS_CACHE: transformersCacheDir,
    XDG_CACHE_HOME: dotCacheDir,
    MPLCONFIGDIR: matplotlibDir,
    SD_WEBUI_RESTARTING: '1',
    COMMANDLINE_ARGS: FORGE_ARGS.join(' ')
  };
}

function validateForgeRoot(forgeRoot) {
  const resolvedForgeRoot = resolveForgeRoot(forgeRoot);

  if (!resolvedForgeRoot) {
    throw new Error('请选择 sd-forge-aki 文件夹，或包含 webui.bat / webui-user.bat 的 Forge 根目录。');
  }

  return getForgeWebuiBatPath(resolvedForgeRoot);
}

function checkForgeApi() {
  return new Promise((resolve) => {
    const request = http.get(FORGE_OPTIONS_URL, { timeout: 1500 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });

    request.on('error', () => {
      resolve(false);
    });
  });
}

function requestJson(url, payload, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request(
      url,
      {
        method: 'POST',
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Forge API returned ${response.statusCode}: ${text.slice(0, 500)}`));
            return;
          }

          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(new Error(`Forge API returned invalid JSON: ${error.message}`));
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('Forge image generation timed out.'));
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function isForgeInvalidArgumentError(error) {
  return /Forge API returned 500/i.test(String(error?.message || '')) &&
    /Invalid argument|Errno 22/i.test(String(error?.message || ''));
}

function isForgeConditionSizeMismatchError(error) {
  return /Forge API returned 500/i.test(String(error?.message || '')) &&
    /Sizes of tensors must match except in dimension 2/i.test(String(error?.message || ''));
}

function estimatePromptTokenCount(prompt) {
  const text = String(prompt || '')
    .replace(/<[^>]+>/g, ' lora ')
    .replace(/[\[\](){}:|]/g, ' ');
  const asciiTokens = text.match(/[a-zA-Z0-9_.'-]+/g) || [];
  const cjkTokens = text.match(/[\u3400-\u9fff]/g) || [];

  return asciiTokens.length + cjkTokens.length;
}

function estimatePromptChunkCount(prompt) {
  const sections = String(prompt || '').split(/\bBREAK\b/i);

  return Math.max(1, sections.reduce((total, section) => {
    return total + Math.max(1, Math.ceil(estimatePromptTokenCount(section) / 75));
  }, 0));
}

async function countPromptChunks(prompt) {
  try {
    const result = await requestJson(FORGE_COUNT_TOKENS_URL, { prompt: String(prompt || '') }, 5000);
    const tokenCount = Number(result?.token_count ?? result?.count ?? result?.tokens);
    const maxLength = Number(result?.max_length ?? 75);

    if (Number.isFinite(tokenCount) && tokenCount >= 0) {
      if (tokenCount >= 77 && tokenCount % 77 === 0) {
        return Math.max(1, Math.round(tokenCount / 77));
      }

      return Math.max(1, Math.ceil(tokenCount / (Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 75)));
    }
  } catch {
    // Fall back to a conservative local estimate when Forge does not expose count_tokens.
  }

  return estimatePromptChunkCount(prompt);
}

function appendBreakPadding(prompt, count) {
  const paddingCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (paddingCount <= 0) return String(prompt || '');

  const suffix = Array.from({ length: paddingCount }, () => 'BREAK').join(' ');
  const text = String(prompt || '').trim();

  return text ? `${text} ${suffix}` : suffix;
}

async function balancePromptChunks(payload) {
  const requestPayload = { ...payload };
  const positiveChunks = await countPromptChunks(requestPayload.prompt || '');
  const negativeChunks = await countPromptChunks(requestPayload.negative_prompt || '');
  const diff = positiveChunks - negativeChunks;

  if (diff > 0) {
    requestPayload.negative_prompt = appendBreakPadding(requestPayload.negative_prompt, diff);
  } else if (diff < 0) {
    requestPayload.prompt = appendBreakPadding(requestPayload.prompt, Math.abs(diff));
  }

  if (requestPayload.enable_hr) {
    requestPayload.hr_prompt = requestPayload.prompt;
    requestPayload.hr_negative_prompt = requestPayload.negative_prompt;
  }

  sendForgeLog(
    'warn',
    `Retrying txt2img with balanced prompt chunks: positive ${positiveChunks}, negative ${negativeChunks}.`
  );

  return requestPayload;
}

async function requestTxt2ImgJson(payload) {
  try {
    return await requestJson(FORGE_TXT2IMG_URL, payload);
  } catch (error) {
    if (!isForgeConditionSizeMismatchError(error)) {
      throw error;
    }

    const retryPayload = await balancePromptChunks(payload);
    return requestJson(FORGE_TXT2IMG_URL, retryPayload);
  }
}

function summarizeTxt2ImgPayload(payload) {
  return {
    width: payload.width,
    height: payload.height,
    batch_size: payload.batch_size,
    n_iter: payload.n_iter,
    steps: payload.steps,
    cfg_scale: payload.cfg_scale,
    sampler: payload.sampler_name || payload.sampler_index || '',
    scheduler: payload.scheduler || '',
    seed: payload.seed,
    enable_hr: Boolean(payload.enable_hr),
    hr_scale: payload.hr_scale,
    hr_upscaler: payload.hr_upscaler || '',
    save_images: payload.save_images,
    send_images: payload.send_images,
    do_not_save_samples: payload.do_not_save_samples,
    do_not_save_grid: payload.do_not_save_grid,
    adetailer: Boolean(payload.alwayson_scripts?.ADetailer),
    pad_cond_uncond: payload.override_settings?.pad_cond_uncond
  };
}

async function requestPreviewTxt2Img(payload) {
  try {
    return await requestTxt2ImgJson(payload);
  } catch (error) {
    if (!isForgeInvalidArgumentError(error)) {
      throw error;
    }

    const retryPayload = {
      ...payload,
      save_images: false,
      send_images: true
    };

    delete retryPayload.do_not_save_samples;
    delete retryPayload.do_not_save_grid;

    sendForgeLog(
      'warn',
      `Preview txt2img hit Forge invalid argument; retrying with compatibility save flags. Payload: ${JSON.stringify(summarizeTxt2ImgPayload(retryPayload))}`
    );

    return requestTxt2ImgJson(retryPayload);
  }
}

function requestGetJson(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, (response) => {
      const chunks = [];

      response.on('data', (chunk) => {
        chunks.push(chunk);
      });

      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Forge API returned ${response.statusCode}: ${text.slice(0, 500)}`));
          return;
        }

        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error(`Forge API returned invalid JSON: ${error.message}`));
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Forge API request timed out.'));
    });

    request.on('error', reject);
  });
}

function requestPost(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        timeout,
        headers: {
          'Content-Length': 0
        }
      },
      (response) => {
        response.resume();

        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Forge API returned ${response.statusCode}.`));
            return;
          }

          resolve();
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('Forge interrupt timed out.'));
    });

    request.on('error', reject);
    request.end();
  });
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function getInputString(input, keys, fallback = '') {
  for (const key of keys) {
    const value = input?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
}

function applyFixedTxt2ImgSettings(payload, input = {}) {
  payload.scheduler = getInputString(input, ['scheduler'], FIXED_TXT2IMG_SCHEDULER);
  payload.override_settings = {
    ...(payload.override_settings || {}),
    CLIP_stop_at_last_layers: clampNumber(input?.clipSkip ?? input?.clip_skip, FIXED_CLIP_SKIP, 1, 12),
    pad_cond_uncond: true
  };
  payload.override_settings_restore_afterwards = true;
}

function getUiConfigStringWithFallback(uiConfig, keys, fallback = '') {
  const value = getUiConfigString(uiConfig, keys);
  return value || fallback;
}

function getUiConfigBooleanWithFallback(uiConfig, keys, fallback = false) {
  const value = getUiConfigBoolean(uiConfig, keys);
  return typeof value === 'boolean' ? value : fallback;
}

function getADetailerKey(label, suffix = '') {
  return `txt2img/${label}${suffix}/value`;
}

function buildADetailerArgsFromUiConfig(uiConfig, suffix = '', defaultModel = 'None') {
  return {
    ad_model: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ADetailer detector', suffix)
    ], defaultModel),
    ad_model_classes: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ADetailer detector classes', suffix)
    ], ''),
    ad_tab_enable: true,
    ad_prompt: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ad_prompt', suffix)
    ], ''),
    ad_negative_prompt: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ad_negative_prompt', suffix)
    ], ''),
    ad_confidence: getUiConfigNumber(uiConfig, [
      getADetailerKey('Detection model confidence threshold', suffix)
    ], 0.3, 0, 1),
    ad_mask_filter_method: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('Method to filter top k masks by (confidence or area)', suffix)
    ], 'Area'),
    ad_mask_k: getUiConfigNumber(uiConfig, [
      getADetailerKey('Mask only the top k (0 to disable)', suffix)
    ], 0, 0, 10),
    ad_mask_min_ratio: getUiConfigNumber(uiConfig, [
      getADetailerKey('Mask min area ratio', suffix)
    ], 0, 0, 1),
    ad_mask_max_ratio: getUiConfigNumber(uiConfig, [
      getADetailerKey('Mask max area ratio', suffix)
    ], 1, 0, 1),
    ad_x_offset: getUiConfigNumber(uiConfig, [
      getADetailerKey('Mask x(→) offset', suffix),
      getADetailerKey('Mask x offset', suffix)
    ], 0, -200, 200),
    ad_y_offset: getUiConfigNumber(uiConfig, [
      getADetailerKey('Mask y(↑) offset', suffix),
      getADetailerKey('Mask y offset', suffix)
    ], 0, -200, 200),
    ad_dilate_erode: getUiConfigNumber(uiConfig, [
      getADetailerKey('Mask erosion (-) / dilation (+)', suffix)
    ], 4, -128, 128),
    ad_mask_merge_invert: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('Mask merge mode', suffix)
    ], 'None'),
    ad_mask_blur: getUiConfigNumber(uiConfig, [
      getADetailerKey('Inpaint mask blur', suffix)
    ], 4, 0, 64),
    ad_denoising_strength: getUiConfigNumber(uiConfig, [
      getADetailerKey('Inpaint denoising strength', suffix)
    ], 0.4, 0, 1),
    ad_inpaint_only_masked: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Inpaint only masked', suffix)
    ], true),
    ad_inpaint_only_masked_padding: getUiConfigNumber(uiConfig, [
      getADetailerKey('Inpaint only masked padding, pixels', suffix)
    ], 32, 0, 256),
    ad_use_inpaint_width_height: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate width/height', suffix)
    ], false),
    ad_inpaint_width: getUiConfigNumber(uiConfig, [
      getADetailerKey('inpaint width', suffix)
    ], 512, 64, 2048),
    ad_inpaint_height: getUiConfigNumber(uiConfig, [
      getADetailerKey('inpaint height', suffix)
    ], 512, 64, 2048),
    ad_use_steps: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate steps', suffix)
    ], false),
    ad_steps: getUiConfigNumber(uiConfig, [
      getADetailerKey('ADetailer steps', suffix)
    ], 28, 1, 150),
    ad_use_cfg_scale: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate CFG scale', suffix)
    ], false),
    ad_cfg_scale: getUiConfigNumber(uiConfig, [
      getADetailerKey('ADetailer CFG scale', suffix)
    ], 7, 0, 30),
    ad_use_checkpoint: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate checkpoint', suffix)
    ], false),
    ad_checkpoint: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ADetailer checkpoint', suffix)
    ], 'Use same checkpoint'),
    ad_use_vae: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate VAE', suffix)
    ], false),
    ad_vae: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ADetailer VAE', suffix)
    ], 'Use same VAE'),
    ad_use_sampler: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate sampler', suffix)
    ], false),
    ad_sampler: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ADetailer sampler', suffix)
    ], 'DPM++ 2M'),
    ad_scheduler: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ADetailer scheduler', suffix)
    ], 'Use same scheduler'),
    ad_use_noise_multiplier: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate noise multiplier', suffix)
    ], false),
    ad_noise_multiplier: getUiConfigNumber(uiConfig, [
      getADetailerKey('Noise multiplier for img2img', suffix)
    ], 1, 0.5, 1.5),
    ad_use_clip_skip: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Use separate CLIP skip', suffix)
    ], false),
    ad_clip_skip: getUiConfigNumber(uiConfig, [
      getADetailerKey('ADetailer CLIP skip', suffix)
    ], 1, 1, 12),
    ad_restore_face: getUiConfigBooleanWithFallback(uiConfig, [
      getADetailerKey('Restore faces after ADetailer', suffix)
    ], false),
    ad_controlnet_model: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ControlNet model', suffix)
    ], 'None'),
    ad_controlnet_module: getUiConfigStringWithFallback(uiConfig, [
      getADetailerKey('ControlNet module', suffix)
    ], 'None'),
    ad_controlnet_weight: getUiConfigNumber(uiConfig, [
      getADetailerKey('ControlNet weight', suffix)
    ], 1, 0, 1),
    ad_controlnet_guidance_start: getUiConfigNumber(uiConfig, [
      getADetailerKey('ControlNet guidance start', suffix)
    ], 0, 0, 1),
    ad_controlnet_guidance_end: getUiConfigNumber(uiConfig, [
      getADetailerKey('ControlNet guidance end', suffix)
    ], 1, 0, 1),
    is_api: true
  };
}

function readADetailerUiDefaults(forgeRoot) {
  if (!forgeRoot) return [];

  const uiConfigPath = path.join(forgeRoot, 'ui-config.json');
  if (!fs.existsSync(uiConfigPath)) return [];

  try {
    const uiConfig = JSON.parse(fs.readFileSync(uiConfigPath, 'utf8'));
    const suffixes = ['', ' 2nd', ' 3rd', ' 4th'];

    return suffixes
      .map((suffix, index) => buildADetailerArgsFromUiConfig(uiConfig, suffix, index === 0 ? 'face_yolov8n.pt' : 'None'))
      .filter(args => args.ad_model && args.ad_model !== 'None');
  } catch (error) {
    sendForgeLog('warn', `Could not read WebUI ADetailer defaults: ${error.message}`);
    return [];
  }
}

function normalizeADetailerPromptMap(value) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    face: typeof source.face === 'string' ? source.face.trim() : '',
    hand: typeof source.hand === 'string' ? source.hand.trim() : ''
  };
}

function getADetailerPromptKindForModel(modelName) {
  const text = String(modelName || '').toLowerCase();

  if (/hand|hands/.test(text)) {
    return 'hand';
  }

  if (/face|eye|mediapipe/.test(text)) {
    return 'face';
  }

  return '';
}

function getFallbackADetailerPrompt(kind) {
  if (kind === 'hand') {
    return 'hands, fingers';
  }

  if (kind === 'face') {
    return 'face, eyes, mouth';
  }

  return '';
}

function applyADetailerPromptOverrides(adetailerArgs, promptMap) {
  return adetailerArgs.map(args => {
    const kind = getADetailerPromptKindForModel(args.ad_model);
    const prompt = promptMap[kind] || getFallbackADetailerPrompt(kind);

    if (!prompt) {
      return args;
    }

    return {
      ...args,
      ad_prompt: prompt
    };
  });
}

function applyADetailerSettings(payload, forgeRoot, promptOverrides = null) {
  const adetailerArgs = readADetailerUiDefaults(forgeRoot);
  const baseArgs = adetailerArgs.length > 0
    ? adetailerArgs
    : [{ ...buildADetailerArgsFromUiConfig({}, '', 'face_yolov8n.pt'), ad_tab_enable: true }];
  const firstArg = applyADetailerPromptOverrides(
    baseArgs,
    normalizeADetailerPromptMap(promptOverrides)
  );

  payload.alwayson_scripts = {
    ...(payload.alwayson_scripts || {}),
    ADetailer: {
      args: [
        true,
        false,
        ...firstArg
      ]
    }
  };
}

function buildTxt2ImgPayload(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
  const negativePrompt = typeof input?.negativePrompt === 'string' ? input.negativePrompt : '';

  const forgeRoot = readConfig().forgeRoot;
  const uiDefaults = readTxt2ImgUiDefaults(forgeRoot);
  const steps = clampNumber(input?.steps, uiDefaults.steps, 1, 150);
  const cfgScale = clampNumber(input?.cfgScale ?? input?.cfg_scale, uiDefaults.cfgScale, 1, 30);
  const samplerName = getInputString(input, ['samplerName', 'sampler_name'], uiDefaults.samplerName);
  const scheduler = getInputString(input, ['scheduler'], FIXED_TXT2IMG_SCHEDULER);
  const payload = {
    prompt,
    negative_prompt: negativePrompt,
    width: clampNumber(input?.width, 1024, 64, 2048),
    height: clampNumber(input?.height, 1536, 64, 2048),
    batch_size: clampNumber(input?.batchSize ?? input?.batch_size, 1, 1, 8),
    n_iter: clampNumber(input?.nIter ?? input?.n_iter, 1, 1, 8),
    seed: clampNumber(input?.seed, -1, -1, MAX_FORGE_SEED),
    restore_faces: false,
    save_images: true
  };

  if (Number.isFinite(steps)) {
    payload.steps = steps;
  }

  if (Number.isFinite(cfgScale)) {
    payload.cfg_scale = cfgScale;
  }

  if (samplerName) {
    payload.sampler_index = samplerName;
    payload.sampler_name = samplerName;
  }

  applyFixedTxt2ImgSettings(payload, { ...input, scheduler });

  if (typeof uiDefaults.tiling === 'boolean') {
    payload.tiling = uiDefaults.tiling;
  }

  if (input?.hiresFix) {
    payload.enable_hr = true;
    payload.denoising_strength = clampNumber(
      input?.hiresDenoisingStrength ?? input?.denoising_strength,
      uiDefaults.hiresDenoisingStrength,
      0,
      1
    );
    payload.firstphase_width = payload.width;
    payload.firstphase_height = payload.height;
    payload.hr_scale = clampNumber(input?.hiresScale ?? input?.hr_scale, uiDefaults.hiresScale, 1, 8);
    payload.hr_upscaler = getInputString(input, ['hiresUpscaler', 'hr_upscaler'], uiDefaults.hiresUpscaler);
    payload.hr_second_pass_steps = clampNumber(
      input?.hiresSteps ?? input?.hr_second_pass_steps,
      uiDefaults.hiresSteps,
      0,
      150
    );
    payload.hr_prompt = prompt;
    payload.hr_negative_prompt = negativePrompt;
    payload.hr_additional_modules = [];

    const hiresSamplerName = getInputString(input, ['hiresSamplerName', 'hr_sampler_name'], uiDefaults.hiresSamplerName);
    const hiresScheduler = getInputString(input, ['hiresScheduler', 'hr_scheduler'], uiDefaults.hiresScheduler || scheduler);

    if (hiresSamplerName) {
      payload.hr_sampler_name = hiresSamplerName;
    }

    payload.hr_scheduler = hiresScheduler || scheduler;
  }

  if (input?.adetailer) {
    applyADetailerSettings(payload, forgeRoot, input?.adetailerPrompts);
  }

  return payload;
}

function buildPromptsFromFilePayload(input) {
  const taskText = typeof input?.taskText === 'string' ? input.taskText.trim() : '';

  if (!taskText) {
    throw new Error('Prompt script text is empty.');
  }

  const forgeRoot = readConfig().forgeRoot;
  const uiDefaults = readTxt2ImgUiDefaults(forgeRoot);
  const payload = {
    prompt: '',
    negative_prompt: '',
    batch_size: 1,
    n_iter: 1,
    script_name: 'Prompts from file or textbox',
    script_args: [
      false,
      false,
      taskText
    ],
    restore_faces: false,
    save_images: true
  };

  if (Number.isFinite(uiDefaults.steps)) {
    payload.steps = uiDefaults.steps;
  }

  if (Number.isFinite(uiDefaults.cfgScale)) {
    payload.cfg_scale = uiDefaults.cfgScale;
  }

  if (uiDefaults.samplerName) {
    payload.sampler_index = uiDefaults.samplerName;
    payload.sampler_name = uiDefaults.samplerName;
  }

  applyFixedTxt2ImgSettings(payload);

  if (typeof uiDefaults.tiling === 'boolean') {
    payload.tiling = uiDefaults.tiling;
  }

  if (input?.hiresFix) {
    payload.enable_hr = true;
    payload.denoising_strength = uiDefaults.hiresDenoisingStrength;
    payload.firstphase_width = clampNumber(input?.width, 1024, 64, 2048);
    payload.firstphase_height = clampNumber(input?.height, 1536, 64, 2048);
    payload.hr_scale = uiDefaults.hiresScale;
    payload.hr_upscaler = uiDefaults.hiresUpscaler;
    payload.hr_second_pass_steps = uiDefaults.hiresSteps;
    payload.hr_prompt = '';
    payload.hr_negative_prompt = '';
    payload.hr_additional_modules = [];

    if (uiDefaults.hiresSamplerName) {
      payload.hr_sampler_name = uiDefaults.hiresSamplerName;
    }

    payload.hr_scheduler = FIXED_TXT2IMG_SCHEDULER;
  }

  if (input?.adetailer) {
    applyADetailerSettings(payload, forgeRoot, input?.adetailerPrompts);
  }

  return payload;
}

function findUiConfigValue(uiConfig, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(uiConfig, key)) {
      return uiConfig[key];
    }
  }

  const normalizedKeys = keys.map(key => key.toLowerCase());
  const matchedKey = Object.keys(uiConfig).find(key => {
    const normalized = key.toLowerCase();
    return normalizedKeys.some(candidate => normalized.includes(candidate.replace('/value', '')));
  });

  return matchedKey ? uiConfig[matchedKey] : undefined;
}

function getUiConfigNumber(uiConfig, keys, fallback, min, max) {
  const value = findUiConfigValue(uiConfig, keys);
  return clampNumber(value, fallback, min, max);
}

function getUiConfigString(uiConfig, keys) {
  const value = findUiConfigValue(uiConfig, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getUiConfigBoolean(uiConfig, keys) {
  const value = findUiConfigValue(uiConfig, keys);

  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function normalizeHiresOverride(value, sameValue) {
  return value && value.toLowerCase() !== sameValue.toLowerCase() ? value : '';
}

function withTxt2ImgFallbackDefaults(defaults = {}) {
  return {
    ...defaults,
    steps: Number.isFinite(defaults.steps) && defaults.steps >= 4
      ? defaults.steps
      : TXT2IMG_FALLBACK_DEFAULTS.steps,
    cfgScale: Number.isFinite(defaults.cfgScale) ? defaults.cfgScale : TXT2IMG_FALLBACK_DEFAULTS.cfgScale,
    samplerName: defaults.samplerName || TXT2IMG_FALLBACK_DEFAULTS.samplerName,
    scheduler: defaults.scheduler || TXT2IMG_FALLBACK_DEFAULTS.scheduler,
    hiresDenoisingStrength: Number.isFinite(defaults.hiresDenoisingStrength)
      ? defaults.hiresDenoisingStrength
      : TXT2IMG_FALLBACK_DEFAULTS.hiresDenoisingStrength,
    hiresScale: Number.isFinite(defaults.hiresScale)
      ? defaults.hiresScale
      : TXT2IMG_FALLBACK_DEFAULTS.hiresScale,
    hiresSteps: Number.isFinite(defaults.hiresSteps)
      ? defaults.hiresSteps
      : TXT2IMG_FALLBACK_DEFAULTS.hiresSteps,
    hiresUpscaler: defaults.hiresUpscaler || TXT2IMG_FALLBACK_DEFAULTS.hiresUpscaler,
    hiresSamplerName: normalizeHiresOverride(
      defaults.hiresSamplerName || TXT2IMG_FALLBACK_DEFAULTS.hiresSamplerName,
      'Use same sampler'
    ),
    hiresScheduler: normalizeHiresOverride(
      defaults.hiresScheduler || TXT2IMG_FALLBACK_DEFAULTS.hiresScheduler,
      'Use same scheduler'
    )
  };
}

function readTxt2ImgUiDefaults(forgeRoot) {
  if (!forgeRoot) {
    return withTxt2ImgFallbackDefaults();
  }

  const uiConfigPath = path.join(forgeRoot, 'ui-config.json');

  if (!fs.existsSync(uiConfigPath)) {
    return withTxt2ImgFallbackDefaults();
  }

  try {
    const uiConfig = JSON.parse(fs.readFileSync(uiConfigPath, 'utf8'));

    return withTxt2ImgFallbackDefaults({
      steps: getUiConfigNumber(uiConfig, [
        'txt2img/Sampling steps/value',
        'txt2img/Steps/value'
      ], NaN, 1, 150),
      cfgScale: getUiConfigNumber(uiConfig, [
        'txt2img/CFG Scale/value',
        'txt2img/CFG scale/value'
      ], NaN, 1, 30),
      samplerName: getUiConfigString(uiConfig, [
        'txt2img/Sampling method/value',
        'txt2img/Sampler/value'
      ]),
      scheduler: getUiConfigString(uiConfig, [
        'txt2img/Schedule type/value',
        'txt2img/Scheduler/value'
      ]),
      hiresDenoisingStrength: getUiConfigNumber(uiConfig, [
        'txt2img/Denoising strength/value',
        'txt2img/Hires denoising strength/value'
      ], NaN, 0, 1),
      hiresScale: getUiConfigNumber(uiConfig, [
        'txt2img/Upscale by/value',
        'txt2img/Hires upscale/value',
        'txt2img/Hires scale/value'
      ], NaN, 1, 8),
      hiresSteps: getUiConfigNumber(uiConfig, [
        'txt2img/Hires steps/value',
        'txt2img/Hires sampling steps/value'
      ], NaN, 0, 150),
      hiresUpscaler: getUiConfigString(uiConfig, [
        'txt2img/Upscaler/value',
        'txt2img/Hires upscaler/value'
      ]),
      hiresSamplerName: getUiConfigString(uiConfig, [
        'txt2img/Hires sampling method/value',
        'txt2img/Hires sampler/value'
      ]),
      hiresScheduler: getUiConfigString(uiConfig, [
        'txt2img/Hires schedule type/value',
        'txt2img/Hires scheduler/value'
      ]),
      tiling: getUiConfigBoolean(uiConfig, [
        'txt2img/Tiling/value'
      ])
    });
  } catch (error) {
    sendForgeLog('warn', `Could not read WebUI txt2img defaults: ${error.message}`);
    return withTxt2ImgFallbackDefaults();
  }
}

async function pollForgeApiOnce() {
  const available = await checkForgeApi();

  if (available) {
    sendForgeStatus('ready', 'Forge API is available at http://127.0.0.1:7860.');
    sendForgeLog('info', `API check succeeded: ${FORGE_OPTIONS_URL}`);
    stopForgePolling();
    stopForgeHeartbeat();
    return true;
  }

  sendForgeStatus('starting', 'Waiting for Forge API on http://127.0.0.1:7860...');
  return false;
}

function startForgePolling() {
  stopForgePolling();
  pollForgeApiOnce();
  forgePollTimer = setInterval(pollForgeApiOnce, 2500);
}

function stopForgePolling() {
  if (forgePollTimer) {
    clearInterval(forgePollTimer);
    forgePollTimer = null;
  }
}

function startForgeHeartbeat() {
  stopForgeHeartbeat();
  forgeHeartbeatTimer = setInterval(() => {
    if (forgeProcess && forgeProcess.exitCode === null && lastForgeStatus !== 'ready') {
      sendForgeLog('info', 'Forge is still running. Waiting for API on http://127.0.0.1:7860...');
    }
  }, 15000);
}

function stopForgeHeartbeat() {
  if (forgeHeartbeatTimer) {
    clearInterval(forgeHeartbeatTimer);
    forgeHeartbeatTimer = null;
  }
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout);
      }
    );
  });
}

async function findExternalForgeProcessIds(forgeRoot) {
  const safeRoot = forgeRoot.replace(/'/g, "''");
  const command = [
    `$root = '${safeRoot}'`,
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  ($_.ExecutablePath -like \"$root\\*\" -or $_.CommandLine -like \"*$root*\") -and $_.ProcessId -ne $PID",
    "}",
    '$items | Select-Object -ExpandProperty ProcessId'
  ].join('\n');

  try {
    const stdout = await runPowerShell(command);
    return stdout
      .split(/\r?\n/)
      .map(line => Number.parseInt(line.trim(), 10))
      .filter(Number.isInteger);
  } catch (error) {
    sendForgeLog('warn', `Could not inspect existing Forge processes: ${error.message}`);
    return [];
  }
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    execFile(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 15000 },
      () => resolve()
    );
  });
}

async function stopForge(config) {
  stopForgePolling();
  stopForgeHeartbeat();
  stopForgeLogTail();

  if (forgeProcess && forgeProcess.exitCode === null) {
    await killProcessTree(forgeProcess.pid);
    sendForgeLog('info', `Stopped tracked Forge process tree: ${forgeProcess.pid}`);
  }

  forgeProcess = null;

  if (config?.forgeRoot) {
    const ids = await findExternalForgeProcessIds(config.forgeRoot);

    if (ids.length > 0) {
      await Promise.all(ids.map(id => killProcessTree(id)));
      sendForgeLog('info', `Stopped leftover Forge processes: ${ids.join(', ')}`);
    }
  }

  sendForgeStatus('stopped', 'Forge is stopped.');
}

function hasTrackedForgeProcess() {
  return Boolean(forgeProcess && forgeProcess.exitCode === null);
}

async function getRunningForgeProcessIds(config) {
  if (!config?.forgeRoot) {
    return [];
  }

  return findExternalForgeProcessIds(config.forgeRoot);
}

async function confirmStopForgeAndExit() {
  if (closeConfirmed || closeInProgress) {
    return;
  }

  closeInProgress = true;
  const config = readConfig();
  const trackedRunning = hasTrackedForgeProcess();
  const externalProcessIds = await getRunningForgeProcessIds(config);
  const apiAvailable = await checkForgeApi();
  const hasRunningForge = trackedRunning || externalProcessIds.length > 0 || apiAvailable;

  const result = await dialog.showMessageBox(mainWindow, {
    type: hasRunningForge ? 'warning' : 'question',
    title: '退出程序',
    message: hasRunningForge ? '退出程序时如何处理 Forge？' : '是否退出程序？',
    detail: hasRunningForge
      ? '可以停止 Forge 后退出，也可以保留已经启动的 Forge，下次点击启动时会先检测状态。'
      : '当前没有检测到需要关闭的 Forge 后台进程。',
    buttons: hasRunningForge ? ['停止 Forge 并退出', '保留 Forge 并退出', '取消'] : ['退出程序', '取消'],
    defaultId: 0,
    cancelId: hasRunningForge ? 2 : 1,
    noLink: true
  });

  if (result.response === 0) {
    if (hasRunningForge) {
      sendForgeLog('info', 'Closing app: stopping Forge before exit...');
      await stopForge(config);
    }

    closeConfirmed = true;
    app.quit();
    return;
  }

  if (hasRunningForge && result.response === 1) {
    sendForgeLog('info', 'Closing app: keeping Forge running.');
    closeConfirmed = true;
    app.quit();
    return;
  }

  closeInProgress = false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: '绘世光辉写真馆',
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    sendLog('info', 'Renderer loaded.');
    sendForgeStatus(lastForgeStatus, 'Forge controller initialized.');
  });

  mainWindow.on('close', (event) => {
    if (closeConfirmed) {
      return;
    }

    event.preventDefault();
    confirmStopForgeAndExit().catch((error) => {
      closeInProgress = false;
      sendForgeLog('error', `Could not close Forge before exit: ${error.message}`);
      dialog.showErrorBox('退出失败', error.message);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle('app:get-info', () => ({
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }));

  ipcMain.handle('app:choose-preview-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose preview image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: '' };
    }

    return {
      canceled: false,
      path: pathToFileURL(result.filePaths[0]).href
    };
  });

  ipcMain.handle('app:copy-preview-image', async (_event, input) => {
    const sourceFilePath = resolveImageFilePath(input?.sourceFilePath || input?.src);

    if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
      throw new Error('Preview source image does not exist.');
    }

    const previewImage = copyPreviewImage(sourceFilePath, input?.previewName, input?.previewFolder);
    sendLog('info', `Copied preview image to ${previewImage.relativePath}`);
    return previewImage;
  });

  ipcMain.handle('app:get-default-backup', async () => {
    const defaultBackupPath = path.join(__dirname, '000.json');

    if (!fs.existsSync(defaultBackupPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(defaultBackupPath, 'utf8'));
  });

  ipcMain.handle('app:save-default-backup', async (_event, data) => {
    if (!data || typeof data !== 'object' || !data.currentLibrary) {
      throw new Error('Default settings data is invalid.');
    }

    const defaultBackupPath = path.join(__dirname, '000.json');
    fs.writeFileSync(defaultBackupPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return { saved: true, path: defaultBackupPath };
  });

  ipcMain.handle('forge:get-config', () => readConfig());

  ipcMain.handle('forge:set-root', async (_event, inputPath) => {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
      return readConfig();
    }

    const forgeRoot = resolveForgeRoot(inputPath);

    if (!forgeRoot) {
      throw new Error(`Could not restore Forge root from backup: ${inputPath}`);
    }

    const config = { forgeRoot };
    writeConfig(config);
    sendForgeLog('info', `Forge root restored from backup: ${forgeRoot}`);
    return config;
  });

  ipcMain.handle('forge:choose-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 sd-forge-aki 或 Forge 根目录',
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return readConfig();
    }

    const selectedPath = result.filePaths[0];
    const forgeRoot = resolveForgeRoot(selectedPath);

    if (!forgeRoot) {
      throw new Error(`没有在所选位置找到 Forge：${selectedPath}\n请选择 sd-forge-aki 文件夹，或包含 webui.bat / webui-user.bat 的 Forge 根目录。`);
    }

    const config = { forgeRoot };
    writeConfig(config);
    sendForgeLog('info', `Forge root saved: ${forgeRoot}`);
    return config;
  });

  ipcMain.handle('forge:start', async () => {
    const config = readConfig();
    const batPath = validateForgeRoot(config.forgeRoot);

    const externalProcessIds = await findExternalForgeProcessIds(config.forgeRoot);
    const trackedRunning = forgeProcess && forgeProcess.exitCode === null;

    if (trackedRunning || externalProcessIds.length > 0) {
      const existingIds = [
        ...(trackedRunning ? [forgeProcess.pid] : []),
        ...externalProcessIds
      ].filter(Boolean);

      sendForgeStatus('starting', 'Stopping existing Forge before restart...');
      sendForgeLog('info', `Stopping existing Forge before restart${existingIds.length ? `: ${existingIds.join(', ')}` : '.'}`);
      await stopForge(config);
    }

    sendForgeStatus('starting', 'Starting Forge...');
    sendForgeLog('info', `Running: ${batPath} ${FORGE_ARGS.join(' ')}`);
    sendForgeLog('info', `Using PATH Python: ${path.join(config.forgeRoot, 'python', 'python.exe')}`);
    sendForgeLog('info', `Using PATH Git: ${path.join(config.forgeRoot, 'git', 'cmd', 'git.exe')}`);
    sendForgeLog('info', `Using pip constraints: ${PIP_CONSTRAINT_PATH}`);
    sendForgeLog('info', 'Using pip index: https://mirrors.cloud.tencent.com/pypi/simple');
    sendForgeLog('info', 'Using Forge bundled Python without venv: SKIP_VENV=1');
    sendForgeLog('info', 'Browser autolaunch disabled: SD_WEBUI_RESTARTING=1');

    const forgeLog = openForgeProcessLogFile();
    sendForgeLog('info', `Forge process output is written to: ${forgeLog.filePath}`);
    startForgeLogTail(forgeLog.filePath, { offset: forgeLog.initialOffset });

    forgeProcess = spawn('cmd.exe', ['/d', '/s', '/c', `webui.bat ${FORGE_ARGS.join(' ')}`], {
      cwd: config.forgeRoot,
      windowsHide: true,
      env: buildForgeEnv(config.forgeRoot),
      stdio: ['ignore', forgeLog.fd, forgeLog.fd]
    });

    fs.closeSync(forgeLog.fd);

    forgeProcess.on('error', (error) => {
      sendForgeStatus('error', error.message);
      sendForgeLog('error', `Failed to start Forge: ${error.message}`);
      stopForgePolling();
      stopForgeHeartbeat();
    });

    forgeProcess.on('exit', (code, signal) => {
      const message = signal
        ? `Forge process exited with signal ${signal}.`
        : `Forge process exited with code ${code}.`;

      sendForgeLog(code === 0 ? 'info' : 'error', message);

      if (lastForgeStatus !== 'ready') {
        sendForgeStatus(code === 0 ? 'stopped' : 'error', message);
        stopForgePolling();
      }

      stopForgeHeartbeat();
      stopForgeLogTail();
    });

    startForgePolling();
    startForgeHeartbeat();
    return { started: true, alreadyRunning: false };
  });

  ipcMain.handle('forge:stop', async () => {
    await stopForge(readConfig());
    return { stopped: true };
  });

  ipcMain.handle('forge:check-api', async () => {
    const available = await checkForgeApi();

    if (available) {
      sendForgeStatus('ready', 'Forge API is available at http://127.0.0.1:7860.');
      startForgeLogTail(getLatestForgeLogFile());
    }

    return { available };
  });

  ipcMain.handle('forge:open-webui', async () => {
    await shell.openExternal('http://127.0.0.1:7860/');
    return { opened: true };
  });

  ipcMain.handle('forge:open-image-folder', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Image path is empty.');
    }

    shell.showItemInFolder(filePath);
    return { opened: true };
  });

  ipcMain.handle('forge:open-today-output-folder', async () => {
    const folderPath = path.join(OUTPUT_DIR, getLocalDateFolderName());
    fs.mkdirSync(folderPath, { recursive: true });
    await shell.openPath(folderPath);
    return { opened: true, folderPath };
  });

  ipcMain.handle('forge:get-defaults', async () => {
    const config = readConfig();
    const uiDefaults = readTxt2ImgUiDefaults(config.forgeRoot);
    let options = {};

    if (await checkForgeApi()) {
      try {
        options = await requestGetJson(FORGE_OPTIONS_URL);
      } catch (error) {
        sendForgeLog('warn', `Could not read Forge options: ${error.message}`);
      }
    }

    return {
      ...uiDefaults,
      scheduler: FIXED_TXT2IMG_SCHEDULER,
      clipSkip: FIXED_CLIP_SKIP,
      model: options.sd_model_checkpoint || '',
      vae: options.sd_vae || '',
      apiAvailable: Object.keys(options).length > 0
    };
  });

  ipcMain.handle('forge:cancel-generation', async () => {
    generationCancelRequested = true;
    generationPaused = false;

    try {
      await requestPost(FORGE_INTERRUPT_URL);
      sendForgeLog('warn', 'Forge generation stop requested.');
    } catch (error) {
      sendForgeLog('warn', `Could not interrupt Forge generation: ${error.message}`);
    }

    return { canceled: true };
  });

  ipcMain.handle('forge:pause-generation', async () => {
    generationPaused = true;
    sendForgeLog('warn', 'Forge generation queue paused.');
    return { paused: true };
  });

  ipcMain.handle('forge:resume-generation', async () => {
    generationPaused = false;
    sendForgeLog('info', 'Forge generation queue resumed.');
    return { paused: false };
  });

  ipcMain.handle('forge:skip-current-generation', async () => {
    generationSkipRequested = true;

    try {
      await requestPost(FORGE_INTERRUPT_URL);
      sendForgeLog('warn', 'Forge current generation skip requested.');
    } catch (error) {
      sendForgeLog('warn', `Could not skip current generation: ${error.message}`);
    }

    return { skipped: true };
  });

  ipcMain.handle('forge:generate-preview-image', async (_event, input) => {
    const apiAvailable = await checkForgeApi();

    if (!apiAvailable) {
      throw new Error('Forge API is not available. Start Forge and wait until it is ready.');
    }

    const payload = buildTxt2ImgPayload({
      ...input,
      batchSize: 1,
      nIter: 1,
      seed: input?.seed ?? -1
    });

    payload.batch_size = 1;
    payload.n_iter = 1;
    payload.save_images = false;
    payload.send_images = true;
    payload.do_not_save_samples = true;
    payload.do_not_save_grid = true;

    sendForgeLog('info', `Generating preview image: ${payload.width}x${payload.height}, hires ${payload.enable_hr ? 'on' : 'off'}, ADetailer ${payload.alwayson_scripts?.ADetailer ? 'on' : 'off'}, Forge saving disabled.`);

    const result = await requestPreviewTxt2Img(payload);
    const firstImage = Array.isArray(result.images) ? result.images[0] : null;

    if (!firstImage) {
      throw new Error('Forge did not return a preview image.');
    }

    const outputImage = saveGeneratedImage(firstImage, 0);
    const previewImage = copyPreviewImage(outputImage.filePath, input?.previewName, input?.previewFolder);
    const image = attachImageMetadata(
      outputImage,
      input,
      payload,
      result,
      0
    );
    image.preview = previewImage;
    image.previewRelativePath = previewImage.relativePath;

    sendForgeLog('info', `Preview image saved to outputs and copied to ${previewImage.relativePath}`);

    return {
      image,
      parameters: result.parameters || payload,
      info: typeof result.info === 'string' ? result.info : ''
    };
  });

  ipcMain.handle('forge:generate-image', async (_event, input) => {
    const apiAvailable = await checkForgeApi();

    if (!apiAvailable) {
      throw new Error('Forge API is not available. Start Forge and wait until it is ready.');
    }

    if (Array.isArray(input?.items) && input.items.length > 0) {
      generationCancelRequested = false;
      generationPaused = false;
      generationSkipRequested = false;
      const images = [];
      const parameters = [];
      const info = [];
      const expectedImageCount = input.items.reduce((total, item) => {
        const batchSize = clampNumber(item?.batchSize ?? item?.batch_size, 1, 1, 8);
        const nIter = clampNumber(item?.nIter ?? item?.n_iter, 1, 1, 8);
        return total + (batchSize * nIter);
      }, 0);

      sendForgeLog('info', `Generating ${input.items.length} image task(s) via direct txt2img API.`);

      for (let index = 0; index < input.items.length; index += 1) {
        await waitForGenerationResume();

        if (generationCancelRequested) {
          sendForgeLog('warn', `Generation stopped before task ${index + 1}.`);
          break;
        }

        const payload = buildTxt2ImgPayload(input.items[index]);

        sendForgeLog(
          'info',
          `[${index + 1}/${input.items.length}] txt2img: ${payload.width}x${payload.height}, steps ${payload.steps}, CFG ${payload.cfg_scale}, sampler ${payload.sampler_index || payload.sampler_name}, hires ${payload.enable_hr ? 'on' : 'off'}, ADetailer ${payload.alwayson_scripts?.ADetailer ? 'on' : 'off'}.`
        );

        let result;
        let skippedCurrent = false;

        try {
          result = await requestTxt2ImgJson(payload);
        } catch (error) {
          if (generationSkipRequested) {
            generationSkipRequested = false;
            skippedCurrent = true;
            sendForgeLog('warn', `Generation skipped during task ${index + 1}.`);
          }

          if (generationCancelRequested) {
            sendForgeLog('warn', `Generation interrupted during task ${index + 1}.`);
            break;
          }

          if (skippedCurrent) {
            continue;
          }

          throw error;
        }

        if (generationSkipRequested) {
          generationSkipRequested = false;
          sendForgeLog('warn', `Generation skipped after task ${index + 1} returned.`);
          continue;
        }

        const resultStartIndex = images.length;
        const resultImages = Array.isArray(result.images)
          ? result.images.map((image, imageIndex) => attachImageMetadata(
            saveGeneratedImage(image, resultStartIndex + imageIndex),
            input.items[index],
            payload,
            result,
            imageIndex
          ))
          : [];

        images.push(...resultImages);
        parameters.push(result.parameters || payload);

        resultImages.forEach((image, imageIndex) => {
          sendToRenderer('forge-image-generated', {
            index: resultStartIndex + imageIndex,
            total: expectedImageCount,
            image
          });
        });

        if (typeof result.info === 'string' && result.info) {
          info.push(result.info);
        }

        sendForgeLog('info', `[${index + 1}/${input.items.length}] Finished. Images: ${resultImages.length}`);
      }

      sendForgeLog('info', `Image generation finished. Images: ${images.length}`);

      return {
        images,
        parameters,
        info: info.join('\n'),
        canceled: generationCancelRequested
      };
    }

    const usePromptScript = typeof input?.taskText === 'string' && input.taskText.trim();
    const payload = usePromptScript
      ? buildPromptsFromFilePayload(input)
      : buildTxt2ImgPayload(input);

    if (usePromptScript) {
      const lineCount = input.taskText.split(/\r?\n/).filter(line => line.trim()).length;
      sendForgeLog('info', `Generating via Prompts from file or textbox. Lines: ${lineCount}.`);
    } else {
      sendForgeLog('info', `Generating image: ${payload.width}x${payload.height}, batch size ${payload.batch_size}. Other txt2img settings use WebUI defaults from ui-config.json when available.`);
    }

    const result = await requestTxt2ImgJson(payload);
    const images = Array.isArray(result.images)
      ? result.images.map((image, index) => attachImageMetadata(
        saveGeneratedImage(image, index),
        input,
        payload,
        result,
        index
      ))
      : [];

    sendForgeLog('info', `Image generation finished. Images: ${images.length}`);

    return {
      images,
      parameters: result.parameters || payload,
      info: typeof result.info === 'string' ? result.info : ''
    };
  });

  ipcMain.on('renderer:log', (_event, entry) => {
    const level = typeof entry?.level === 'string' ? entry.level : 'info';
    const message = typeof entry?.message === 'string' ? entry.message : '';
    sendLog(level, message);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopForgePolling();
  stopForgeHeartbeat();
  stopForgeLogTail();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
