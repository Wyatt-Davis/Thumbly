// Snapshot of the page source as delivered, taken before any script touches the DOM (used by "Download HTML").
const ORIGINAL_PAGE_HTML = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
let currentVideoId = null;
let currentIsShort = false;
let cropOffset = 0;
let cropFraction = 0;          // crop start as a fraction of the displayed image length along cropAxis
let userMovedCrop = false;     // true once the user drags the crop
let isDragging = false;
let dragMoved = false;
let isSaving = false;
let startX = 0;              // pointer position along the crop's movable axis at drag start, minus offset
let cropAxis = 'x';          // 'x' for landscape sources, 'y' when the crop can only move vertically (portrait source)
let cropAxisLength = 0;      // displayed image length along cropAxis
let pendingLoadId = 0;
let defaultCropOffset = 0;
let resizeTimeout = null;
let isLightMode = false;
const exportSizes = [512, 1024, 1280, 1920]; // larger output dimension, in px (e.g. 1280 -> 1280×720 at 16:9)
const DEFAULT_EXPORT_SIZE = 1280;
let exportSize = DEFAULT_EXPORT_SIZE;
let currentAspectKey = '1:1';
// Last aspect the user picked by hand (persisted). Auto-picked ratios (Shorts -> 9:16, others -> 1:1) never touch this.
let preferredAspectKey = '1:1';
let workingObjectUrl = null;   // blob URL of the letterbox-trimmed working image (if any)
// Batch-only settings (independent of main preview)
let batchAspectKey = '1:1';
let batchExportSize = DEFAULT_EXPORT_SIZE;
const aspectOptions = ['1:1', '16:9', '9:16', 'original'];
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DEFAULT_FILENAME_TEMPLATE = '{title}';
const FILENAME_TOKENS = ['title', 'channel', 'date', 'aspect'];
const REMOVED_FILENAME_TOKENS = ['id', 'size']; // dropped from saved templates on load
let filenameTemplate = DEFAULT_FILENAME_TEMPLATE;
const videoInfoCache = new Map(); // id -> { title, author } (successful lookups only)

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable (e.g. private mode) */ }
}

// Returns { id, isShort } or null. isShort is true for youtube.com/shorts/ID links.
function parseYouTubeLink(input) {
  if (!input) return null;
  const text = input.trim();
  if (VIDEO_ID_RE.test(text)) return { id: text, isShort: false }; // bare 11-char ID
  // Find the first YouTube URL in the text (host must be youtube.com / *.youtube.com / youtube-nocookie.com / youtu.be)
  const m = text.match(/(?:^|[^\w.-])((?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?:\/[^\s]*)?)/i);
  if (!m) return null;
  let raw = m[1];
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);
  let id = null;
  let isShort = false;
  if (host === 'youtu.be') {
    id = segs[0] || null;
  } else {
    const v = u.searchParams.get('v');
    if (v) id = v;
    else if (segs.length >= 2 && ['shorts', 'live', 'embed', 'v', 'e'].includes(segs[0].toLowerCase())) {
      id = segs[1];
      isShort = segs[0].toLowerCase() === 'shorts';
    }
  }
  if (id) id = id.slice(0, 11);
  return id && VIDEO_ID_RE.test(id) ? { id, isShort } : null;
}

// Title + channel via noembed (YouTube oEmbed proxy with CORS). Returns { title, author }, empty strings on failure.
async function getVideoInfo(videoId) {
  if (videoInfoCache.has(videoId)) return videoInfoCache.get(videoId);
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await res.json();
    const info = { title: data.title || '', author: data.author_name || '' };
    if (info.title) videoInfoCache.set(videoId, info);
    return info;
  } catch {
    return { title: '', author: '' };
  }
}

function getAspectRatio(key) {
  if (key === '16:9') return 16/9;
  if (key === '9:16') return 9/16;
  return 1;
}

// Export Size is the larger output dimension. 'original' ignores it: native size of the (letterbox-trimmed)
// source, no scaling (null when the source isn't known).
function getExportDimensions(key, size, sourceW, sourceH) {
  if (key === 'original') {
    if (!sourceW || !sourceH) return null;
    return { width: sourceW, height: sourceH };
  }
  if (key === '16:9') return { width: size, height: Math.round(size * 9 / 16) };
  if (key === '9:16') return { width: Math.round(size * 9 / 16), height: size };
  return { width: size, height: size };
}

function formatDims(key, size, sourceW, sourceH) {
  const d = getExportDimensions(key, size, sourceW, sourceH);
  if (key === 'original') return d ? `Original (${d.width}×${d.height})` : 'Original';
  return `${d.width}×${d.height}`;
}

// Largest centered rect of the given aspect ratio inside region {x,y,w,h}.
function centeredCrop(region, aspect) {
  let w, h;
  if (region.w / region.h > aspect) {
    h = region.h;
    w = Math.round(h * aspect);
  } else {
    w = region.w;
    h = Math.round(w / aspect);
  }
  return { x: region.x + (region.w - w) / 2, y: region.y + (region.h - h) / 2, w, h };
}

// 4:3 hqdefault/sddefault thumbnails of 16:9 videos have black bars baked in.
// Returns the usable region of the image (bars removed if detected).
function getWorkingRegion(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = { x: 0, y: 0, w: W, h: H };
  if (Math.abs(W / H - 4 / 3) > 0.02) return full;
  const contentH = Math.round(W * 9 / 16);
  const bar = Math.floor((H - contentH) / 2);
  if (bar < 8) return full;
  try {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const isBlackBand = (y0, y1) => {
      const d = ctx.getImageData(0, y0, W, y1 - y0).data;
      let dark = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l < 40) dark++;
        total++;
      }
      return dark / total > 0.98;
    };
    const margin = 3; // ignore JPEG ringing next to the content edge
    if (isBlackBand(0, bar - margin) && isBlackBand(H - bar + margin, H)) {
      return { x: 0, y: bar, w: W, h: H - bar * 2 };
    }
  } catch (err) {
    console.warn('Letterbox detection failed', err);
  }
  return full;
}

function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const FALLBACK_QUALITIES = ['maxresdefault', 'hqdefault', 'sddefault', 'mqdefault'];
const fullRegion = img => ({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });

// Finds the best thumbnail for a video. Returns { img, url, region, quality }, null if none exist,
// or { stale: true } if isStale() became true while loading.
// Shorts: prefer the true vertical oardefault (missing ones 404 with a 120x90 placeholder), unless it is
// non-portrait or lower-resolution than the regular thumbnail's full height.
async function findThumbnail(videoId, isShort, isStale = () => false) {
  let oar = null;
  if (isShort) {
    const o = await loadImage(`https://img.youtube.com/vi/${videoId}/oardefault.jpg`);
    if (isStale()) return { stale: true };
    if (o && o.naturalWidth > 120 && o.naturalHeight > o.naturalWidth * 1.3) oar = o;
    if (oar && oar.naturalHeight >= 720) return { img: oar, url: oar.src, region: fullRegion(oar), quality: 'oardefault' };
  }
  for (const quality of FALLBACK_QUALITIES) {
    const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    const raw = await loadImage(url);
    if (isStale()) return { stale: true };
    if (!raw || raw.naturalWidth <= 120 || raw.naturalHeight <= 90) continue;
    if (oar && oar.naturalHeight >= raw.naturalHeight) break;
    // Shorts thumbnails are a vertical frame centered on a blurred fill (never 16:9 letterboxing), so don't trim them.
    const region = isShort ? fullRegion(raw) : getWorkingRegion(raw);
    return { img: raw, url, region, quality };
  }
  if (oar) return { img: oar, url: oar.src, region: fullRegion(oar), quality: 'oardefault' };
  return null;
}

function getLoadedImage() {
  const img = document.getElementById('thumbnailImg');
  return img.complete && img.naturalWidth > 0 && img.style.display !== 'none' ? img : null;
}

function updateSizeLabel() {
  const img = getLoadedImage();
  const isOriginal = currentAspectKey === 'original';
  // Original: "Original" (plus the loaded thumbnail's native size); exportSize itself is kept for the other ratios.
  document.getElementById('sizeLabel').textContent =
    formatDims(currentAspectKey, exportSize, img && img.naturalWidth, img && img.naturalHeight);
  const item = document.getElementById('exportSizeItem');
  item.disabled = isOriginal;
  item.title = isOriginal ? 'Original downloads the thumbnail at its native resolution' : '';
}

function updateAspectLabel() {
  document.getElementById('aspectLabel').textContent = currentAspectKey === 'original' ? 'Original' : currentAspectKey;
}

function updateBatchChips() {
  const isOriginal = batchAspectKey === 'original';
  document.getElementById('batchAspectLabel').textContent = isOriginal ? 'Original' : batchAspectKey;
  // Batch Original exports each thumbnail at its native size, so Export Size doesn't apply (batchExportSize is kept for later).
  document.getElementById('batchSizeLabel').textContent = isOriginal ? 'Original' : formatDims(batchAspectKey, batchExportSize);
  const chip = document.getElementById('batchSizeChip');
  chip.disabled = isOriginal;
  chip.title = isOriginal ? 'Original exports each thumbnail at its native resolution' : '';
  document.getElementById('batchDesc').textContent = isOriginal
    ? 'One YouTube link per line. Each thumbnail will be saved at its original size and shape, with no resizing.'
    : `One YouTube link per line. Each thumbnail will be center-cropped to ${batchAspectKey} and saved at ${formatDims(batchAspectKey, batchExportSize)}.`;
}

function cycleExportSize(isBatch = false) {
  const targetSize = isBatch ? batchExportSize : exportSize;
  let index = exportSizes.indexOf(targetSize);
  index = (index + 1) % exportSizes.length;
  if (isBatch) {
    if (batchAspectKey === 'original') return; // not used for batch Original
    batchExportSize = exportSizes[index];
    updateBatchChips();
  } else {
    if (currentAspectKey === 'original') return; // not used for Original
    exportSize = exportSizes[index];
    storageSet('thumbly-export-size', exportSize);
    updateSizeLabel();
  }
}

function cycleAspectRatio(isBatch = false) {
  let index = aspectOptions.indexOf(isBatch ? batchAspectKey : currentAspectKey);
  index = (index + 1) % aspectOptions.length;
  const newKey = aspectOptions[index];

  if (isBatch) {
    batchAspectKey = newKey;
    updateBatchChips();
  } else {
    currentAspectKey = newKey;
    preferredAspectKey = newKey;
    storageSet('thumbly-aspect', currentAspectKey);
    updateAspectLabel();
    updateSizeLabel();
    userMovedCrop = false; // new aspect: start centered
    if (currentVideoId) {
      updateCropOverlay();
      onCropStateChanged();
    }
  }
}

function updateCropOverlay() {
  const square = document.getElementById('cropSquare');
  const img = document.getElementById('thumbnailImg');
  const box = document.getElementById('imageBox');
  const recenterBtn = document.getElementById('recenterBtn');
  if (!getLoadedImage()) return;

  if (currentAspectKey === '16:9' || currentAspectKey === 'original') {
    square.style.display = 'none';
    recenterBtn.classList.remove('visible');
    return;
  }

  const padding = 2;
  const imageLeft = (box.offsetWidth - img.offsetWidth) / 2;
  const imageTop = (box.offsetHeight - img.offsetHeight) / 2;
  const displayedW = img.offsetWidth;
  const displayedH = img.offsetHeight;
  let overlayW, overlayH;

  if (currentAspectKey === '1:1') {
    const size = Math.min(displayedW, displayedH) - (padding * 2);
    overlayW = size;
    overlayH = size;
  } else { // 9:16
    overlayH = displayedH - (padding * 2);
    overlayW = Math.round(overlayH * (9 / 16));
    if (overlayW > displayedW - (padding * 2)) {
      overlayW = displayedW - (padding * 2);
      overlayH = Math.round(overlayW * (16 / 9));
    }
  }

  // The crop moves along whichever axis has free space: horizontally on landscape sources,
  // vertically on portrait sources (e.g. a 1:1 crop of a vertical Shorts thumbnail).
  const maxX = Math.max(0, displayedW - overlayW);
  const maxY = Math.max(0, displayedH - padding * 2 - overlayH);
  cropAxis = maxY > maxX ? 'y' : 'x';
  cropAxisLength = cropAxis === 'x' ? displayedW : displayedH;
  const maxOffset = cropAxis === 'x' ? maxX : maxY;
  defaultCropOffset = maxOffset / 2;

  if (!userMovedCrop) {
    cropOffset = defaultCropOffset;
  } else {
    cropOffset = Math.max(0, Math.min(cropFraction * cropAxisLength, maxOffset));
  }

  if (cropAxis === 'x') {
    square.style.left = `${imageLeft + cropOffset}px`;
    square.style.top = `${imageTop + padding}px`;
  } else {
    square.style.left = `${imageLeft + (displayedW - overlayW) / 2}px`;
    square.style.top = `${imageTop + padding + cropOffset}px`;
  }
  square.style.width = `${overlayW}px`;
  square.style.height = `${overlayH}px`;
  square.style.display = 'block';

  const recenterVisible = userMovedCrop && Math.abs(cropOffset - defaultCropOffset) > 2;
  recenterBtn.classList.toggle('visible', recenterVisible);
}

function recenterCrop() {
  if (currentAspectKey === '16:9' || currentAspectKey === 'original') return;
  userMovedCrop = false;
  cropOffset = defaultCropOffset;
  document.getElementById('recenterBtn').classList.remove('visible');
  updateCropOverlay();
  onCropStateChanged();
}

// Recent history: crop/aspect changes and downloads update the current video's entry.
function onCropStateChanged() {
  if (currentVideoId && getLoadedImage()) recordRecent(currentVideoId, currentRecentState(currentVideoId));
}

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadPageAsHTML() {
  downloadBlob(new Blob([ORIGINAL_PAGE_HTML], { type: 'text/html;charset=utf-8' }), 'Thumbly.html');
  closeMenu();
}

// Applies the theme and keeps the header toggle's icon (CSS-driven) and accessible name in sync.
function applyTheme(light) {
  isLightMode = light;
  document.body.classList.toggle('light', light);
  const btn = document.getElementById('themeBtn');
  const label = light ? 'Switch to dark mode' : 'Switch to light mode';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function toggleTheme() {
  applyTheme(!isLightMode);
  storageSet('thumbly-theme', isLightMode ? 'light' : 'dark');
}

function setMenuOpen(open) {
  document.getElementById('menuDropdown').classList.toggle('show', open);
  document.getElementById('menuBtn').setAttribute('aria-expanded', String(open));
}

function closeMenu() {
  setMenuOpen(false);
}

function createCroppedCanvas(img, sourceX, sourceY, sourceW, sourceH, targetW, targetH) {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, targetW, targetH);
  return canvas;
}

const LATIN_SPECIAL = { 'ø':'o', 'Ø':'O', 'ł':'l', 'Ł':'L', 'đ':'d', 'Đ':'D', 'ð':'d', 'Ð':'D', 'ß':'ss', 'æ':'ae', 'Æ':'AE', 'œ':'oe', 'Œ':'OE', 'þ':'th', 'Þ':'Th', 'ı':'i' };

// Unicode-aware: keeps letters/digits from any script, strips Latin accents, collapses separators to '-'.
function sanitizeFilename(text, fallback = 'youtube-video', maxWords = 6, maxLength = 80) {
  let s = (text || '').split(/\s+/).slice(0, maxWords).join(' ');
  s = s.replace(/[øØłŁđĐðÐßæÆœŒþÞı]/g, ch => LATIN_SPECIAL[ch]);
  // Strip accents from Latin letters only (keeps e.g. Japanese dakuten intact)
  s = s.normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
  s = s.replace(/['’`]/g, '');
  s = s.replace(/[^\p{L}\p{M}\p{N}\-]+/gu, ' ');
  s = s.replace(/(^|[\s\-])\p{M}+/gu, '$1'); // drop orphaned marks (e.g. emoji variation selectors)
  s = s.trim().replace(/[\s\-]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/-+$/, '');
  return s || fallback;
}

function localDateString(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function unknownTemplateTokens(template) {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]).filter(t => !FILENAME_TOKENS.includes(t.toLowerCase()));
}

// Strips tokens that are no longer offered ({id}, {size}) from a saved template and tidies the leftovers.
function migrateFilenameTemplate(template) {
  const tpl = template || '';
  const re = new RegExp(`\\{(?:${REMOVED_FILENAME_TOKENS.join('|')})\\}`, 'gi');
  if (!re.test(tpl)) return tpl.trim() || DEFAULT_FILENAME_TEMPLATE;
  let out = tpl.replace(re, ' ').replace(/\(\s*\)|\[\s*\]/g, ' '); // also drop brackets left empty, e.g. "[{id}]"
  out = out.replace(/\s+/g, ' ')                                   // collapse spaces
    .replace(/\s*([-_.,|·–—])(?:\s*\1)+\s*/g, ' $1 ')            // doubled separators -> one
    .replace(/\s*([-_.,|·–—]\s*)+$/g, '')                          // trailing separators
    .replace(/^\s*([-_.,|·–—]\s*)+/g, '')                          // leading separators
    .replace(/\s+/g, ' ').trim();
  // Keep the original spacing around a single separator (e.g. "{title}_{date}" stays tight).
  out = out.replace(/ ([_.]) /g, '$1');
  return out || DEFAULT_FILENAME_TEMPLATE;
}

// ctx: { id, title, channel, aspect }. Returns a sanitized base name (no extension).
function buildFilename(template, ctx) {
  const tpl = (template || '').trim() || DEFAULT_FILENAME_TEMPLATE;
  const title = ctx.title ? sanitizeFilename(ctx.title, '') : '';
  const values = {
    title: title || ctx.id, // title lookup failed -> fall back to the video ID
    channel: ctx.channel || '',
    date: localDateString(),
    aspect: ctx.aspect === 'original' ? 'original' : String(ctx.aspect).replace(':', 'x')
  };
  const out = tpl.replace(/\{([^{}]*)\}/g, (m, k) => {
    const key = k.toLowerCase();
    return FILENAME_TOKENS.includes(key) ? ` ${values[key]} ` : ' ';
  });
  return sanitizeFilename(out, ctx.id, Infinity, 150);
}

function setSaving(saving) {
  const btn = document.getElementById('downloadBtn');
  isSaving = saving;
  btn.disabled = saving;
  btn.textContent = saving ? 'Saving…' : 'Download';
}

// Crop rect in natural pixels of the displayed (working) image, based on the overlay as it is right now.
function getSingleSourceRect(displayImg) {
  const cropEl = document.getElementById('cropSquare');
  const W = displayImg.naturalWidth, H = displayImg.naturalHeight;
  if (currentAspectKey === 'original') return { x: 0, y: 0, w: W, h: H };
  // Source already has the target shape (e.g. a 1080x1920 Shorts thumbnail in 9:16): export all of it.
  if (Math.abs((W / H) / getAspectRatio(currentAspectKey) - 1) < 0.01) return { x: 0, y: 0, w: W, h: H };
  if (currentAspectKey === '16:9' || cropEl.style.display === 'none') {
    return centeredCrop({ x: 0, y: 0, w: W, h: H }, getAspectRatio(currentAspectKey));
  }
  const cropRect = cropEl.getBoundingClientRect();
  const imgRect = displayImg.getBoundingClientRect();
  const relX = cropRect.left - imgRect.left;
  const relY = cropRect.top - imgRect.top;
  const ratio = W / displayImg.offsetWidth;
  const x = Math.max(0, Math.round(relX * ratio));
  const y = Math.max(0, Math.round(relY * ratio));
  const w = Math.min(Math.round(cropRect.width * ratio), W - x);
  const h = Math.min(Math.round(cropRect.height * ratio), H - y);
  return { x, y, w, h };
}

async function forceDownloadCropped(videoId) {
  if (!videoId || isSaving) return;
  const displayImg = getLoadedImage();
  if (!displayImg) {
    alert("Thumbnail not loaded yet. Wait a moment and try again.");
    return;
  }
  // Snapshot everything at click time
  const rect = getSingleSourceRect(displayImg);
  const snap = {
    videoId,
    src: displayImg.src,
    aspect: currentAspectKey,
    rect,
    dims: getExportDimensions(currentAspectKey, exportSize, rect.w, rect.h)
  };
  setSaving(true);
  try {
    const info = await getVideoInfo(snap.videoId);
    if (currentVideoId !== snap.videoId || displayImg.src !== snap.src) {
      console.warn('Video changed while saving; download cancelled.');
      return;
    }
    const name = buildFilename(filenameTemplate, {
      id: snap.videoId, title: info.title, channel: info.author,
      aspect: snap.aspect
    });
    const exportImg = await loadImage(snap.src);
    if (!exportImg) {
      alert('Could not load the thumbnail for export. Please try again.');
      return;
    }
    const r = snap.rect;
    const canvas = createCroppedCanvas(exportImg, r.x, r.y, r.w, r.h, snap.dims.width, snap.dims.height);
    triggerDownload(canvas.toDataURL('image/jpeg', 0.92), `${name}.jpg`);
    onCropStateChanged();
  } catch (err) {
    console.error(err);
    alert('Download failed: ' + (err && err.message ? err.message : err));
  } finally {
    setSaving(false);
  }
}

async function batchDownload(linksText) {
  if (typeof JSZip === 'undefined') {
    throw new Error('The zip library (JSZip) is missing, so batch download is unavailable. Try reloading the page.');
  }
  const lines = linksText.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { processed: 0, failed: [], duplicates: 0 };
  const videoMap = new Map();
  const failed = [];
  let duplicateCount = 0;
  lines.forEach(link => {
    const info = parseYouTubeLink(link);
    if (!info) {
      failed.push(link);
      return;
    }
    const id = info.id;
    if (!videoMap.has(id)) {
      videoMap.set(id, { originalLinks: [link], isShort: info.isShort });
    } else {
      const entry = videoMap.get(id);
      entry.originalLinks.push(link);
      entry.isShort = entry.isShort || info.isShort;
      duplicateCount++;
    }
  });
  if (videoMap.size === 0) return { processed: 0, failed, duplicates: duplicateCount };
  const zip = new JSZip();
  const usedNames = new Set();
  let processed = 0;
  let index = 0;
  const statusEl = document.getElementById('batchStatus');
  for (const [videoId, entry] of videoMap) {
    index++;
    statusEl.textContent = `Processing ${index}/${videoMap.size}…`;
    const info = await getVideoInfo(videoId);
    const found = await findThumbnail(videoId, entry.isShort);
    if (!found) {
      failed.push(...entry.originalLinks);
      continue;
    }
    const { img, region } = found;
    const src = batchAspectKey === 'original' ? region : centeredCrop(region, getAspectRatio(batchAspectKey));
    // Original: native resolution of the (letterbox-trimmed) thumbnail, no resizing.
    const dims = getExportDimensions(batchAspectKey, batchExportSize, src.w, src.h); // Original -> src.w × src.h
    const canvas = createCroppedCanvas(img, src.x, src.y, src.w, src.h, dims.width, dims.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    const baseName = buildFilename(filenameTemplate, {
      id: videoId, title: info.title, channel: info.author,
      aspect: batchAspectKey
    });
    let name = baseName;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${baseName}-${n}`;
    usedNames.add(name.toLowerCase());
    zip.file(`${name}.jpg`, base64, { base64: true });
    processed++;
  }
  if (processed > 0) {
    const dims = getExportDimensions(batchAspectKey, batchExportSize);
    const blob = await zip.generateAsync({ type: "blob" });
    const zipName = dims
      ? `thumbly-batch-${batchAspectKey.replace(':', 'x')}-${dims.width}x${dims.height}.zip`
      : 'thumbly-batch-original.zip';
    downloadBlob(blob, zipName);
  }
  return {
    processed,
    failed: [...new Set(failed)],
    duplicates: duplicateCount
  };
}

function releaseWorkingImage() {
  if (workingObjectUrl) {
    URL.revokeObjectURL(workingObjectUrl);
    workingObjectUrl = null;
  }
}

function hidePreview() {
  const img = document.getElementById('thumbnailImg');
  img.style.opacity = '0';
  img.style.display = 'none';
  img.alt = '';
  document.getElementById('loading').style.display = 'none';
  document.getElementById('cropSquare').style.display = 'none';
  document.getElementById('downloadBtn').classList.remove('visible');
  document.getElementById('recenterBtn').classList.remove('visible');
}

function showPlaceholder() {
  hidePreview();
  document.getElementById('invalidMessage').style.display = 'none';
  document.getElementById('placeholder').style.display = 'block';
}

function showInvalid(message = '[Invalid Link]') {
  hidePreview();
  document.getElementById('placeholder').style.display = 'none';
  const msg = document.getElementById('invalidMessage');
  msg.textContent = message;
  msg.style.display = 'flex';
}

function fullReset() {
  pendingLoadId++;
  currentVideoId = null;
  cropOffset = 0;
  cropFraction = 0;
  userMovedCrop = false;
  defaultCropOffset = 0;
  isDragging = false;
  showPlaceholder();
  updateSizeLabel();
}

function setThumbnailAlt(videoId, title) {
  const img = document.getElementById('thumbnailImg');
  img.alt = title ? `Thumbnail of "${title}"` : `YouTube thumbnail for ${videoId}`;
}

async function tryLoadThumbnail(videoId, { isShort = false } = {}) {
  const img = document.getElementById('thumbnailImg');
  const placeholder = document.getElementById('placeholder');
  const loading = document.getElementById('loading');
  const invalidMsg = document.getElementById('invalidMessage');
  pendingLoadId++;
  const thisLoadId = pendingLoadId;
  invalidMsg.style.display = 'none';
  placeholder.style.display = 'none';
  hidePreview();
  loading.style.display = 'block';

  let finalUrl = null;
  const found = await findThumbnail(videoId, isShort, () => thisLoadId !== pendingLoadId);
  if (found && found.stale) return;
  if (found) {
    const { img: raw, url, region } = found;
    if (region.y === 0 && region.h === raw.naturalHeight) {
      finalUrl = url;
    } else {
      // Trim baked-in letterbox bars so display and exports use a true 16:9 image
      const canvas = createCroppedCanvas(raw, region.x, region.y, region.w, region.h, region.w, region.h);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
      if (thisLoadId !== pendingLoadId) return;
      if (!blob) {
        finalUrl = url;
      } else {
        releaseWorkingImage();
        workingObjectUrl = URL.createObjectURL(blob);
        finalUrl = workingObjectUrl;
      }
    }
  }

  if (!finalUrl) {
    if (currentVideoId === videoId) currentVideoId = null; // so re-pasting retries
    showInvalid('[Video not found]');
    return;
  }

  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (thisLoadId !== pendingLoadId) return;
    loading.style.display = 'none';
    img.style.display = 'block';
    setTimeout(() => { img.style.opacity = '1'; }, 10);
    const cached = videoInfoCache.get(videoId);
    setThumbnailAlt(videoId, cached && cached.title);
    updateCropOverlay();
    updateSizeLabel();
    document.getElementById('downloadBtn').classList.add('visible');
    const input = document.getElementById('urlInput');
    if (document.activeElement === input) input.blur();
    onVideoLoaded(videoId);
    getVideoInfo(videoId).then(info => {
      if (currentVideoId === videoId && info.title) {
        setThumbnailAlt(videoId, info.title);
        onVideoInfo(videoId, info);
      }
    });
  };
  img.onerror = () => {
    if (thisLoadId !== pendingLoadId) return;
    if (currentVideoId === videoId) currentVideoId = null;
    showInvalid('[Video not found]');
  };
  img.src = finalUrl;
  if (finalUrl !== workingObjectUrl) releaseWorkingImage();
}

// ---- Recent history (localStorage 'thumbly-recent'; thumbnail is an i.ytimg.com URL, never image data) ----
const RECENT_KEY = 'thumbly-recent';
const RECENT_MAX = 10;
let recentItems = loadRecent();

function loadRecent() {
  try {
    const list = JSON.parse(storageGet(RECENT_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(e => e && typeof e.id === 'string' && VIDEO_ID_RE.test(e.id)).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecent() {
  storageSet(RECENT_KEY, JSON.stringify(recentItems));
  renderRecent();
}

function currentRecentState(videoId) {
  const info = videoInfoCache.get(videoId);
  const state = {
    isShort: currentIsShort,
    aspect: currentAspectKey,
    crop: userMovedCrop ? cropFraction : null, // null = centered default
    thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    updated: Date.now()
  };
  if (info && info.title) state.title = info.title;
  return state;
}

// Insert or update an entry and move it to the front (deduped by video id).
function recordRecent(videoId, patch) {
  const index = recentItems.findIndex(e => e.id === videoId);
  const previous = index >= 0 ? recentItems.splice(index, 1)[0] : {};
  recentItems.unshift({ ...previous, ...patch, id: videoId });
  if (recentItems.length > RECENT_MAX) recentItems.length = RECENT_MAX;
  saveRecent();
}

function aspectDisplay(key) {
  return key === 'original' ? 'Original' : key;
}

function renderRecent() {
  const section = document.getElementById('recentSection');
  const list = document.getElementById('recentList');
  const active = document.activeElement;
  const focusedId = active && list.contains(active) ? active.closest('.recent-item').dataset.id : null;
  const focusedClass = focusedId ? active.className : null;
  list.textContent = '';
  for (const entry of recentItems) {
    const label = entry.title || entry.id;
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.dataset.id = entry.id;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent-open';
    open.title = label;
    const thumb = document.createElement('img');
    thumb.className = 'recent-thumb';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.src = entry.thumb || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`;
    thumb.onerror = () => { thumb.style.visibility = 'hidden'; };
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = label;
    const sub = document.createElement('span');
    sub.className = 'recent-sub';
    sub.textContent = `${entry.isShort ? 'Short · ' : ''}${aspectDisplay(entry.aspect)}`;
    meta.append(name, sub);
    const prefix = document.createElement('span');
    prefix.className = 'sr-only';
    prefix.textContent = 'Open ';
    open.append(prefix, thumb, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${label} from recent`);
    li.append(open, remove);
    list.append(li);
  }
  section.hidden = recentItems.length === 0;
  if (focusedId) {
    const target = list.querySelector(`.recent-item[data-id="${focusedId}"] .${focusedClass.split(' ')[0]}`);
    if (target) target.focus();
  }
}

function removeRecent(videoId) {
  const index = recentItems.findIndex(e => e.id === videoId);
  if (index < 0) return;
  recentItems.splice(index, 1);
  const list = document.getElementById('recentList');
  saveRecent();
  const next = list.querySelectorAll('.recent-open')[Math.min(index, recentItems.length - 1)];
  (next || document.getElementById('urlInput')).focus();
}

function clearRecent() {
  recentItems = [];
  saveRecent();
  document.getElementById('urlInput').focus();
}

// Restore a video exactly as it was saved: aspect + crop position, no auto-pick, nothing persisted.
function restoreRecent(videoId) {
  const entry = recentItems.find(e => e.id === videoId);
  if (!entry) return;
  const input = document.getElementById('urlInput');
  input.value = entry.isShort ? `https://www.youtube.com/shorts/${entry.id}` : `https://www.youtube.com/watch?v=${entry.id}`;
  updateClearBtnVisibility();
  currentIsShort = !!entry.isShort;
  currentAspectKey = aspectOptions.includes(entry.aspect) ? entry.aspect : (currentIsShort ? '9:16' : '1:1');
  updateAspectLabel();
  cropFraction = typeof entry.crop === 'number' ? entry.crop : 0;
  userMovedCrop = typeof entry.crop === 'number';
  if (videoId === currentVideoId && getLoadedImage()) {
    updateSizeLabel();
    updateCropOverlay();
    onCropStateChanged();
  } else {
    currentVideoId = videoId;
    cropOffset = 0;
    updateSizeLabel();
    tryLoadThumbnail(videoId, { isShort: currentIsShort });
  }
}

function onVideoLoaded(videoId) {
  recordRecent(videoId, currentRecentState(videoId));
}

function onVideoInfo(videoId, info) {
  const entry = recentItems.find(e => e.id === videoId);
  if (entry && info.title && entry.title !== info.title) {
    entry.title = info.title;
    saveRecent();
  }
}

function initRecent() {
  const list = document.getElementById('recentList');
  list.addEventListener('click', e => {
    const item = e.target.closest('.recent-item');
    if (!item) return;
    if (e.target.closest('.recent-remove')) removeRecent(item.dataset.id);
    else if (e.target.closest('.recent-open')) restoreRecent(item.dataset.id);
  });
  document.getElementById('clearRecentBtn').addEventListener('click', clearRecent);
  renderRecent();
}

function updateClearBtnVisibility() {
  const input = document.getElementById('urlInput');
  const clearBtn = document.getElementById('clearBtn');
  const hasText = input.value.trim().length > 0;
  clearBtn.classList.toggle('visible', hasText);
}

function updateBatchClearVisibility() {
  const textarea = document.getElementById('batchInput');
  const clearBtn = document.getElementById('clearBatchBtn');
  const hasText = textarea.value.trim().length > 0;
  clearBtn.classList.toggle('visible', hasText);
}

function clearInput() {
  const input = document.getElementById('urlInput');
  input.value = '';
  fullReset();
  updateClearBtnVisibility();
  input.focus();
}

// ---- Dialogs (batch, filename template): modal, focus moves in, Tab is trapped, Escape closes, focus returns.
let openDialogEl = null;
let dialogOpener = null;
function getFocusable(root) {
  return [...root.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
}
function openDialog(modal, initialFocus) {
  if (openDialogEl && openDialogEl !== modal) closeDialog(openDialogEl, false);
  closeMenu();
  const active = document.activeElement;
  dialogOpener = active && active !== document.body ? active : document.getElementById('urlInput');
  openDialogEl = modal;
  modal.style.display = 'flex';
  document.querySelector('.container').inert = true;
  (initialFocus || getFocusable(modal)[0]).focus();
}
function closeDialog(modal = openDialogEl, restoreFocus = true) {
  if (!modal) return;
  modal.style.display = 'none';
  if (openDialogEl === modal) openDialogEl = null;
  document.querySelector('.container').inert = false;
  if (restoreFocus && dialogOpener && document.contains(dialogOpener)) {
    // An opener that was hidden in the closed menu can't take focus; fall back to the menu button.
    const target = dialogOpener.closest('#menuDropdown') ? document.getElementById('menuBtn') : dialogOpener;
    target.focus();
  }
  dialogOpener = null;
}
function trapTab(e) {
  if (!openDialogEl || e.key !== 'Tab') return false;
  const items = getFocusable(openDialogEl);
  if (!items.length) return false;
  const first = items[0], last = items[items.length - 1];
  if (!openDialogEl.contains(document.activeElement)) {
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus();
  } else {
    return false;
  }
  e.preventDefault();
  return true;
}

function init() {
  const input = document.getElementById('urlInput');
  const downloadBtn = document.getElementById('downloadBtn');
  const recenterBtn = document.getElementById('recenterBtn');
  const clearBtn = document.getElementById('clearBtn');
  const batchBtn = document.getElementById('batchBtn');
  const imageBox = document.getElementById('imageBox');
  const imgElement = document.getElementById('thumbnailImg');
  const menuBtn = document.getElementById('menuBtn');
  const menuDropdown = document.getElementById('menuDropdown');
  const downloadHTMLItem = document.getElementById('downloadHTMLItem');
  const themeBtn = document.getElementById('themeBtn');
  const exportSizeItem = document.getElementById('exportSizeItem');
  const aspectRatioItem = document.getElementById('aspectRatioItem');
  const filenameItem = document.getElementById('filenameItem');
  const batchModal = document.getElementById('batchModal');
  const processBatchBtn = document.getElementById('processBatchBtn');
  const clearBatchBtn = document.getElementById('clearBatchBtn');
  const batchInput = document.getElementById('batchInput');
  const closeBatchModal = document.getElementById('closeBatchModal');
  const batchStatus = document.getElementById('batchStatus');
  const batchAspectChip = document.getElementById('batchAspectChip');
  const batchSizeChip = document.getElementById('batchSizeChip');
  const filenameModal = document.getElementById('filenameModal');
  const filenameInput = document.getElementById('filenameTemplateInput');
  const filenamePreview = document.getElementById('filenamePreview');
  const filenameWarning = document.getElementById('filenameWarning');
  applyTheme(storageGet('thumbly-theme') === 'light');
  // Saved sizes from older versions (512/1024) are still valid options.
  const savedSize = parseInt(storageGet('thumbly-export-size'), 10);
  exportSize = exportSizes.includes(savedSize) ? savedSize : DEFAULT_EXPORT_SIZE;
  const savedAspect = storageGet('thumbly-aspect');
  // The single-link aspect is auto-picked per link (Shorts -> 9:16, everything else -> 1:1), so the app
  // starts at 1:1. The saved manual choice is still remembered and used as the Batch modal's default.
  if (savedAspect && aspectOptions.includes(savedAspect)) preferredAspectKey = savedAspect;
  const savedTemplate = storageGet('thumbly-filename-template');
  filenameTemplate = migrateFilenameTemplate(savedTemplate);
  if (savedTemplate && savedTemplate !== filenameTemplate) storageSet('thumbly-filename-template', filenameTemplate);
  function updateFilenameLabel() {
    document.getElementById('filenameLabel').textContent = filenameTemplate;
  }
  updateFilenameLabel();
  function syncBatchSettings() {
    batchAspectKey = preferredAspectKey;
    batchExportSize = exportSize;
    updateBatchChips();
  }
  function openBatch() {
    batchStatus.innerHTML = '';
    syncBatchSettings();
    updateBatchClearVisibility();
    openDialog(batchModal, batchInput);
  }
  updateSizeLabel();
  updateAspectLabel();
  initRecent();
  function applyAutoAspect(isShort) {
    const key = isShort ? '9:16' : '1:1';
    if (currentAspectKey === key) return;
    currentAspectKey = key; // not persisted: only manual choices go to localStorage
    updateAspectLabel();
    updateSizeLabel();
  }
  function handleInput() {
    const value = input.value.trim();
    const linkInfo = parseYouTubeLink(value);
    const videoId = linkInfo ? linkInfo.id : null;
    if (!value) {
      fullReset();
    } else if (videoId) {
      if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        currentIsShort = linkInfo.isShort;
        cropOffset = 0;
        cropFraction = 0;
        userMovedCrop = false;
        applyAutoAspect(linkInfo.isShort);
        tryLoadThumbnail(videoId, { isShort: linkInfo.isShort });
      }
    } else {
      pendingLoadId++;
      currentVideoId = null;
      showInvalid();
    }
    updateClearBtnVisibility();
  }
  input.addEventListener('input', handleInput);
  input.addEventListener('paste', () => setTimeout(handleInput, 10));
  clearBtn.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    clearInput();
  });
  batchBtn.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    openBatch();
  });
  batchInput.addEventListener('input', updateBatchClearVisibility);
  clearBatchBtn.addEventListener('click', () => {
    if (batchStatus.innerHTML.trim() !== '') {
      batchStatus.style.transition = 'opacity 0.3s ease';
      batchStatus.style.opacity = '0';
      setTimeout(() => {
        batchInput.value = '';
        batchStatus.innerHTML = '';
        batchStatus.style.transition = '';
        batchStatus.style.opacity = '';
        updateBatchClearVisibility();
        batchInput.focus();
      }, 320);
    } else {
      batchInput.value = '';
      updateBatchClearVisibility();
      batchInput.focus();
    }
  });
  batchAspectChip.addEventListener('click', () => cycleAspectRatio(true));
  batchSizeChip.addEventListener('click', () => cycleExportSize(true));
  menuBtn.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    setMenuOpen(!menuDropdown.classList.contains('show'));
  });
  document.addEventListener('click', (e) => {
    if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
      closeMenu();
    }
  });
  exportSizeItem.addEventListener('click', () => cycleExportSize(false));
  aspectRatioItem.addEventListener('click', () => cycleAspectRatio(false));

  // ---- Filename template editor
  function sampleContext() {
    const info = currentVideoId ? videoInfoCache.get(currentVideoId) : null;
    const id = currentVideoId || 'dQw4w9WgXcQ';
    const title = currentVideoId ? (info ? info.title : '') : 'Rick Astley - Never Gonna Give You Up (Official Video)';
    const channel = currentVideoId ? (info ? info.author : '') : 'Rick Astley';
    return { id, title, channel, aspect: currentAspectKey };
  }
  function updateFilenamePreview() {
    const tpl = filenameInput.value;
    filenamePreview.textContent = `${buildFilename(tpl, sampleContext())}.jpg`;
    const unknown = unknownTemplateTokens(tpl);
    filenameWarning.textContent = unknown.length ? `Unknown token${unknown.length > 1 ? 's' : ''} ignored: ${unknown.map(t => `{${t}}`).join(', ')}` : '';
  }
  function openFilenameEditor() {
    filenameInput.value = filenameTemplate;
    updateFilenamePreview();
    openDialog(filenameModal, filenameInput);
    filenameInput.select();
  }
  function saveFilenameTemplate() {
    const tpl = filenameInput.value.trim() || DEFAULT_FILENAME_TEMPLATE;
    filenameTemplate = tpl;
    storageSet('thumbly-filename-template', tpl);
    updateFilenameLabel();
    closeDialog(filenameModal);
  }
  filenameItem.addEventListener('click', openFilenameEditor);
  filenameInput.addEventListener('input', updateFilenamePreview);
  filenameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveFilenameTemplate(); }
  });
  document.querySelectorAll('#filenameModal [data-token]').forEach(btn => {
    btn.addEventListener('click', () => {
      const token = `{${btn.dataset.token}}`;
      const start = filenameInput.selectionStart ?? filenameInput.value.length;
      const end = filenameInput.selectionEnd ?? start;
      const v = filenameInput.value;
      filenameInput.value = v.slice(0, start) + token + v.slice(end);
      filenameInput.focus();
      filenameInput.setSelectionRange(start + token.length, start + token.length);
      updateFilenamePreview();
    });
  });
  document.getElementById('filenameResetBtn').addEventListener('click', () => {
    filenameInput.value = DEFAULT_FILENAME_TEMPLATE;
    updateFilenamePreview();
    filenameInput.focus();
  });
  document.getElementById('filenameSaveBtn').addEventListener('click', saveFilenameTemplate);
  document.getElementById('filenameCancelBtn').addEventListener('click', () => closeDialog(filenameModal));
  document.getElementById('closeFilenameModal').addEventListener('click', () => closeDialog(filenameModal));

  function renderBatchResult(result, error) {
    const frag = document.createDocumentFragment();
    const addBreak = () => frag.appendChild(document.createElement('br'));
    if (error) {
      const s = document.createElement('strong');
      s.className = 'status-error';
      s.textContent = 'Batch download failed: ' + (error && error.message ? error.message : String(error));
      frag.appendChild(s);
      return frag;
    }
    const head = document.createElement('strong');
    if (result.processed > 0) {
      head.className = 'success';
      head.textContent = `${result.processed} thumbnail${result.processed === 1 ? '' : 's'} downloaded successfully.`;
    } else {
      head.className = 'status-error';
      head.textContent = 'No thumbnails could be downloaded.';
    }
    frag.appendChild(head);
    if (result.duplicates > 0) {
      addBreak();
      const d = document.createElement('span');
      d.className = 'status-warn';
      d.textContent = `${result.duplicates} duplicate link(s) were skipped.`;
      frag.appendChild(d);
    }
    if (result.failed.length > 0) {
      addBreak();
      const f = document.createElement('strong');
      f.className = 'status-error';
      f.textContent = `Failed downloads (${result.failed.length}):`;
      frag.appendChild(f);
      const list = document.createElement('div');
      list.className = 'failed-list';
      result.failed.forEach((link, i) => {
        if (i > 0) list.appendChild(document.createElement('br'));
        list.appendChild(document.createTextNode(link));
      });
      frag.appendChild(list);
    }
    return frag;
  }

  processBatchBtn.addEventListener('click', async () => {
    const text = batchInput.value.trim();
    if (!text) return;
    batchInput.value = '';
    updateBatchClearVisibility();
    batchStatus.textContent = 'Starting batch download…';
    batchStatus.classList.add('show');
    processBatchBtn.disabled = true;
    clearBatchBtn.disabled = true;
    let result = null, error = null;
    try {
      result = await batchDownload(text);
    } catch (err) {
      console.error(err);
      error = err;
    } finally {
      processBatchBtn.disabled = false;
      clearBatchBtn.disabled = false;
    }
    batchStatus.classList.remove('show');
    batchStatus.innerHTML = '';
    batchStatus.appendChild(renderBatchResult(result, error));
    setTimeout(() => batchStatus.classList.add('show'), 10);
    if (openDialogEl === batchModal && !batchModal.contains(document.activeElement)) batchInput.focus();
  });
  closeBatchModal.addEventListener('click', () => closeDialog(batchModal));
  [batchModal, filenameModal].forEach(modal => {
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeDialog(modal); });
  });
  downloadHTMLItem.addEventListener('click', downloadPageAsHTML);
  themeBtn.addEventListener('click', toggleTheme);
  function pointerAlongAxis(clientX, clientY) {
    const rect = imgElement.getBoundingClientRect();
    return cropAxis === 'x' ? clientX - rect.left : clientY - rect.top;
  }
  function moveCropTo(clientX, clientY) {
    const newOffset = pointerAlongAxis(clientX, clientY) - startX;
    cropFraction = cropAxisLength ? Math.max(0, newOffset) / cropAxisLength : 0;
    userMovedCrop = true;
    dragMoved = true;
    updateCropOverlay(); // clamps to the allowed range
    cropFraction = cropAxisLength ? cropOffset / cropAxisLength : 0;
  }
  const cropDisabled = () => !currentVideoId || currentAspectKey === '16:9' || currentAspectKey === 'original';
  function endDrag() {
    if (isDragging && dragMoved) onCropStateChanged();
    isDragging = false;
    dragMoved = false;
    imageBox.style.cursor = 'grab';
  }
  imageBox.addEventListener('mousedown', (e) => {
    if (cropDisabled()) return;
    isDragging = true;
    dragMoved = false;
    startX = pointerAlongAxis(e.clientX, e.clientY) - cropOffset;
    imageBox.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging || cropDisabled()) return;
    moveCropTo(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', endDrag);
  imageBox.addEventListener('touchstart', (e) => {
    if (cropDisabled()) return;
    isDragging = true;
    dragMoved = false;
    startX = pointerAlongAxis(e.touches[0].clientX, e.touches[0].clientY) - cropOffset;
    e.preventDefault();
  });
  document.addEventListener('touchmove', (e) => {
    if (!isDragging || cropDisabled()) return;
    moveCropTo(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  });
  document.addEventListener('touchend', endDrag);
  window.addEventListener('resize', () => {
    if (currentVideoId) {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateCropOverlay, 120);
    }
  });
  downloadBtn.addEventListener('click', () => currentVideoId && forceDownloadCropped(currentVideoId));
  recenterBtn.addEventListener('click', recenterCrop);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openDialogEl) {
        closeDialog(openDialogEl);
        e.preventDefault();
        return;
      }
      if (menuDropdown.classList.contains('show')) {
        const focusWasInMenu = menuDropdown.contains(document.activeElement);
        closeMenu();
        if (focusWasInMenu) menuBtn.focus();
        e.preventDefault();
        return;
      }
    }
    if (trapTab(e)) return;
    const active = document.activeElement;
    const dialogOpen = !!openDialogEl;
    const inTextField = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
    if (e.key === 'Enter') {
      // Only from the link input (or when nothing is focused, since the input blurs after a thumbnail loads);
      // focused buttons handle Enter themselves.
      const fromLinkInput = active === input || !active || active === document.body;
      if (fromLinkInput && !dialogOpen && currentVideoId && downloadBtn.classList.contains('visible') && !isSaving) {
        e.preventDefault();
        forceDownloadCropped(currentVideoId);
      }
      return;
    }
    // Single-letter shortcuts
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (inTextField || dialogOpen) return;
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      openBatch();
      return;
    }
    if (key === 'r' && currentVideoId) {
      recenterCrop();
      e.preventDefault();
      return;
    }
    if (key === 'c') {
      clearInput();
      e.preventDefault();
    }
  });
  updateClearBtnVisibility();
}
window.onload = init;
