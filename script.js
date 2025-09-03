// Basic offline MP3 player using IndexedDB + Audio element.
const dbName = 'mp3pwa-db';
const storeName = 'tracks';
let db;
let playlist = [];
let currentIndex = -1;
const player = document.getElementById('player');
const trackList = document.getElementById('trackList');
const npTitle = document.getElementById('npTitle');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const seek = document.getElementById('seek');
const cur = document.getElementById('cur');
const dur = document.getElementById('dur');

let deferredPrompt;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  }
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
        store.createIndex('name', 'name', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function init() {
  db = await openDB();
  await loadAll();
  renderList();
}
async function loadAll() {
  playlist = [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { id, name, type, size, lastModified } = cursor.value;
        playlist.push({ id, name, type, size, lastModified });
        cursor.continue();
      } else resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function humanSize(bytes) {
  const u = ['B','KB','MB','GB','TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length-1) { n/=1024; i++; }
  return `${n.toFixed(n<10&&i>0?1:0)} ${u[i]}`;
}

function renderList() {
  trackList.innerHTML = '';
  if (playlist.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No songs yet. Tap “Add Songs” to import.';
    trackList.appendChild(li);
    return;
  }
  playlist.forEach((t, idx) => {
    const li = document.createElement('li');

    const left = document.createElement('div');
    left.className = 'track';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${t.type || 'audio'} • ${humanSize(t.size)}`;
    left.appendChild(title);
    left.appendChild(meta);

    const buttons = document.createElement('div');
    buttons.className = 'row-btns';
    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => playAt(idx));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => removeTrack(t.id));
    buttons.appendChild(playBtn);
    buttons.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(buttons);
    trackList.appendChild(li);
  });
}

async function getBlobById(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

async function playAt(idx) {
  if (idx < 0 || idx >= playlist.length) return;
  currentIndex = idx;
  const t = playlist[idx];
  const blob = await getBlobById(t.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  player.src = url;
  player.play().catch(()=>{});
  npTitle.textContent = t.name;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.name, artist: 'Local file', album: 'Offline Library'
    });
  }
}

function playNext(dir=1) {
  if (playlist.length === 0) return;
  const next = currentIndex < 0 ? 0 : (currentIndex + dir + playlist.length) % playlist.length;
  playAt(next);
}

playPauseBtn.addEventListener('click', () => {
  if (player.paused) player.play(); else player.pause();
});
prevBtn.addEventListener('click', () => playNext(-1));
nextBtn.addEventListener('click', () => playNext(1));

player.addEventListener('play', () => { playPauseBtn.textContent = '⏸'; });
player.addEventListener('pause', () => { playPauseBtn.textContent = '▶️'; });

player.addEventListener('loadedmetadata', () => {
  seek.max = Math.floor(player.duration)||100;
  dur.textContent = fmtTime(player.duration||0);
});
player.addEventListener('timeupdate', () => {
  seek.value = Math.floor(player.currentTime||0);
  cur.textContent = fmtTime(player.currentTime||0);
});
seek.addEventListener('input', () => { player.currentTime = Number(seek.value||0); });
player.addEventListener('ended', () => playNext(1));

function fmtTime(s) {
  s = Math.floor(s);
  const m = Math.floor(s/60);
  const sec = s%60;
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

document.getElementById('pickFiles').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files||[]);
  if (!files.length) return;
  for (const f of files) { await addFile(f); }
  await loadAll();
  renderList();
  if (currentIndex === -1 && playlist.length > 0) playAt(0);
  e.target.value = '';
});

function addFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const blob = new Blob([reader.result], { type: file.type || 'audio/mpeg' });
      const rec = { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, blob };
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.add(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function removeTrack(id) {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const req = store.delete(id);
  req.onsuccess = async () => { await loadAll(); renderList(); };
}

document.getElementById('clearBtn').addEventListener('click', () => {
  const yes = confirm('Remove all imported songs from this device?');
  if (!yes) return;
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear().onsuccess = () => {
    playlist = []; currentIndex = -1;
    renderList();
    npTitle.textContent = 'Nothing playing';
    player.removeAttribute('src');
    player.load();
  };
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => player.play());
  navigator.mediaSession.setActionHandler('pause', () => player.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => playNext(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => playNext(1));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}

init();
