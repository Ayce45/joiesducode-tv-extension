// ===== Config =====
const RANDOM_URL = 'https://lesjoiesducode.fr/random';
const FEED_URL = 'https://lesjoiesducode.fr/memes-developpeurs/feed';
const INTERVAL_MS = 10 * 60 * 1000;
const RETRY_MS = 30 * 1000;
const RECENT_HISTORY_SIZE = 10;
const STORAGE_KEY = 'ljdc-tv-state-v1';

// ===== DOM =====
const titleEl = document.getElementById('title');
const mediaEl = document.getElementById('media-wrap');
const countdownEl = document.getElementById('countdown');
const nextBtn = document.getElementById('next-btn');
const fsBtn = document.getElementById('fs-btn');
const modeBtn = document.getElementById('mode-btn');

// ===== State =====
let mode = 'random'; // 'random' | 'chrono'
let chronoQueue = []; // [{ title, link, pubDate }, ...] -- newest first
let chronoPage = 0; // last page fetched
let chronoIndex = 0; // global index across all pages (for persistence)
const recentTitles = [];
let nextLoadAt = 0;
let cycleTimer = null;

// ===== Persistence =====
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.mode === 'random' || s.mode === 'chrono') mode = s.mode;
    if (typeof s.chronoIndex === 'number') chronoIndex = s.chronoIndex;
  } catch (e) {
    console.warn('State load failed', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode, chronoIndex })
    );
  } catch (e) {
    /* ignore */
  }
}

// ===== Fetch (direct, no proxy — host_permissions handles CORS) =====
async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text) throw new Error('Réponse vide');
  return text;
}

// ===== RSS feed parsing (chronological mode) =====
async function fetchRssPage(page) {
  const url = page > 1 ? `${FEED_URL}?paged=${page}` : FEED_URL;
  const xmlText = await fetchText(url);
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('RSS invalide');
  const items = Array.from(xml.querySelectorAll('item')).map(it => ({
    title: it.querySelector('title')?.textContent?.trim() || '',
    link: it.querySelector('link')?.textContent?.trim() || '',
    pubDate: it.querySelector('pubDate')?.textContent?.trim() || '',
  }));
  return items.filter(i => i.link);
}

// Fill the chronological queue, advancing chronoIndex.
// Returns the next item to display, or null if no more memes.
async function nextChronoItem() {
  // Determine target page from index (10 items/page)
  const targetPage = Math.floor(chronoIndex / 10) + 1;
  const offsetInPage = chronoIndex % 10;

  // Refetch only when needed
  if (chronoPage !== targetPage || chronoQueue.length === 0) {
    const items = await fetchRssPage(targetPage);
    if (items.length === 0) {
      // End reached → loop back to start
      chronoIndex = 0;
      const first = await fetchRssPage(1);
      if (first.length === 0) return null;
      chronoQueue = first;
      chronoPage = 1;
      saveState();
      const item = chronoQueue[0];
      chronoIndex = 1;
      saveState();
      return item;
    }
    chronoQueue = items;
    chronoPage = targetPage;
  }

  const item = chronoQueue[offsetInPage];
  if (!item) {
    // Hole in pagination → reset and loop
    chronoIndex = 0;
    return nextChronoItem();
  }
  chronoIndex += 1;
  saveState();
  return item;
}

// ===== Article HTML extraction =====
function extractMemeFromArticleHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let title =
    doc.querySelector('article h1')?.textContent ||
    doc.querySelector('.entry-title')?.textContent ||
    doc.querySelector('h1.post-title')?.textContent ||
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.querySelector('h1')?.textContent ||
    'Les Joies du Code';

  title = title.replace(/\s+/g, ' ').trim();
  title = title.replace(/\s*[-–—|]\s*Les Joies du Code\s*$/i, '').trim();

  const article =
    doc.querySelector('article') || doc.querySelector('main') || doc.body;

  // 1. Video meme — link to .webm/.mp4 inside article
  const videoLink = article.querySelector(
    'a[href*=".webm"], a[href*=".mp4"]'
  );
  if (videoLink) {
    return { title, mediaUrl: videoLink.getAttribute('href'), type: 'video' };
  }
  const videoEl = article.querySelector('video source[src], video[src]');
  if (videoEl) {
    const src = videoEl.getAttribute('src');
    if (src) return { title, mediaUrl: src, type: 'video' };
  }

  // 2. Image meme — main content image inside the article body.
  // The og:image is a separate social-share crop (photo only), so we MUST
  // grab the body image instead which has the full composed meme (title baked in).
  // Most modern articles wrap the meme in .snack-content or .prose.
  let mainImg = article.querySelector(
    '.snack-content img[src], .prose img[src], .entry-content img[src]'
  );

  // Fallback: first <img> in <article> that isn't a related-post thumbnail.
  if (!mainImg) {
    mainImg = Array.from(article.querySelectorAll('img')).find(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src) return false;
      const cls = img.className || '';
      // Skip related-post thumbnails (they use object-cover class)
      if (/object-cover/i.test(cls)) return false;
      // Skip thumbnails with -WIDTHxHEIGHT suffix
      if (/-\d+x\d+\.(jpe?g|png|webp|gif)/i.test(src)) return false;
      if (/discord|logo|avatar|favicon|join/i.test(src)) return false;
      return true;
    });
  }

  if (mainImg) {
    const src =
      mainImg.getAttribute('src') || mainImg.getAttribute('data-src');
    return { title, mediaUrl: src, type: 'image' };
  }

  // 3. Last-resort fallback: og:image (will be the cropped social-share version)
  const ogImage = doc.querySelector('meta[property="og:image"]')?.content;
  if (ogImage) {
    const fullImg = ogImage.replace(
      /-\d+x\d+(\.(jpe?g|png|webp|gif))(\?.*)?$/i,
      '$1$3'
    );
    return { title, mediaUrl: fullImg, type: 'image' };
  }

  throw new Error('Aucun media trouvé');
}

// ===== Render =====
function render({ title, mediaUrl, type }) {
  titleEl.textContent = title;
  titleEl.classList.remove('loading');
  titleEl.classList.add('fade-in');
  void titleEl.offsetWidth;

  mediaEl.innerHTML = '';
  const node = document.createElement(type === 'video' ? 'video' : 'img');
  node.classList.add('fade-in');

  if (type === 'video') {
    node.src = mediaUrl;
    node.autoplay = true;
    node.loop = true;
    node.muted = true;
    node.playsInline = true;
    node.controls = false;
  } else {
    node.src = mediaUrl;
    node.alt = title;
  }

  node.onerror = () => {
    console.error('Media load error:', mediaUrl);
    showError(`Media inaccessible :\n${mediaUrl}`);
  };

  mediaEl.appendChild(node);
}

function showError(msg) {
  titleEl.textContent = 'Oups…';
  titleEl.classList.remove('loading');
  mediaEl.innerHTML =
    '<div class="error">' +
    escapeHtml(msg) +
    '<br><br><small>Nouvel essai dans 30s…</small></div>';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===== Load one meme according to current mode =====
async function loadOneMeme(attempt = 0) {
  try {
    let articleUrl;
    let prefetchedTitle = null;

    if (mode === 'chrono') {
      const item = await nextChronoItem();
      if (!item) throw new Error('Aucun meme dans le flux');
      articleUrl = item.link;
      prefetchedTitle = item.title;
    } else {
      articleUrl = `${RANDOM_URL}?_=${Date.now()}`;
    }

    const html = await fetchText(articleUrl);
    const meme = extractMemeFromArticleHtml(html);
    if (prefetchedTitle && !meme.title)
      meme.title = prefetchedTitle;

    // In random mode only, retry if we just showed this title
    if (
      mode === 'random' &&
      recentTitles.includes(meme.title) &&
      attempt < 4
    ) {
      return loadOneMeme(attempt + 1);
    }
    recentTitles.push(meme.title);
    if (recentTitles.length > RECENT_HISTORY_SIZE) recentTitles.shift();

    render(meme);
    return true;
  } catch (e) {
    console.error('Load failed:', e);
    showError(`Erreur : ${e.message}`);
    return false;
  }
}

async function cycle() {
  clearTimeout(cycleTimer);
  const ok = await loadOneMeme();
  const delay = ok ? INTERVAL_MS : RETRY_MS;
  nextLoadAt = Date.now() + delay;
  cycleTimer = setTimeout(cycle, delay);
}

function tickCountdown() {
  if (!nextLoadAt) {
    countdownEl.textContent = '';
    return;
  }
  const ms = Math.max(0, nextLoadAt - Date.now());
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  countdownEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

// ===== Mode toggle =====
function updateModeBtn() {
  if (mode === 'chrono') {
    modeBtn.textContent = `📅 Chrono · #${chronoIndex + 1}`;
    modeBtn.title = 'Mode : du plus récent au plus vieux';
  } else {
    modeBtn.textContent = '🎲 Random';
    modeBtn.title = 'Mode : aléatoire';
  }
}

function setMode(newMode, options = {}) {
  if (newMode !== 'random' && newMode !== 'chrono') return;
  if (newMode === mode && !options.forceReload) return;
  mode = newMode;
  saveState();
  updateModeBtn();
  // Reload current display under the new mode
  titleEl.textContent = 'Chargement…';
  titleEl.classList.add('loading');
  mediaEl.innerHTML = '';
  cycle();
}

modeBtn.addEventListener('click', () => {
  setMode(mode === 'random' ? 'chrono' : 'random');
});

// ===== Other controls =====
nextBtn.addEventListener('click', () => {
  titleEl.textContent = 'Chargement…';
  titleEl.classList.add('loading');
  mediaEl.innerHTML = '';
  cycle();
});

fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'ArrowRight') nextBtn.click();
  if (e.key === 'f') fsBtn.click();
  if (e.key === 'm') modeBtn.click();
  if (e.key === 'r') {
    // Reset chrono position back to most recent
    chronoIndex = 0;
    chronoPage = 0;
    chronoQueue = [];
    saveState();
    updateModeBtn();
    nextBtn.click();
  }
});

// Hide cursor when idle (for TV)
let cursorTimer;
function showCursor() {
  document.body.style.cursor = 'default';
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => {
    document.body.style.cursor = 'none';
  }, 3000);
}
document.addEventListener('mousemove', showCursor);
showCursor();

// Update mode button display every cycle (chronoIndex changes)
setInterval(updateModeBtn, 1000);
setInterval(tickCountdown, 1000);

// ===== Boot =====
loadState();
updateModeBtn();
cycle();
