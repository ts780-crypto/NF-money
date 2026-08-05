// Firebase Realtime Database REST API エンドポイント
const DB_URL = "https://nf-reception-default-rtdb.asia-southeast1.firebasedatabase.app/moneyLogs";

// モニター表示用の制限設定
const MAX_DISPLAY_COUNT = 10; 

// 表示モード ('limit': 直近10件, 'all': 全件) - localStorageから状態を復元
let displayMode = localStorage.getItem('nf_viewer_display_mode') || 'limit';
let remoteLogs = [];
let eventSource = null;

window.onload = function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Error:', err));
  }

  loadCachedRemoteLogs();
  updateToggleUI();
  renderData();

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

  initRealtimeStream();
};

// --- ネットワーク・同期状態の表示更新 ---
function updateNetworkStatus() {
  const statusBadge = document.getElementById('netStatus');
  const statusText = document.getElementById('netStatusText');
  if (!statusBadge || !statusText) return;

  const isSSEOpen = eventSource && (eventSource.readyState === EventSource.OPEN);
  const isConnected = navigator.onLine && isSSEOpen;

  if (isConnected) {
    statusBadge.className = "net-badge online";
    statusText.textContent = "リアルタイム同期中";
  } else {
    statusBadge.className = "net-badge offline";
    statusText.textContent = "オフライン（同期停止）";
  }
}

function loadCachedRemoteLogs() {
  const cached = localStorage.getItem('nf_cached_remote_logs');
  if (cached) {
    try { remoteLogs = JSON.parse(cached); } catch (e) { console.error("キャッシュ読み込みエラー", e); }
  }
}

function saveCachedRemoteLogs() {
  localStorage.setItem('nf_cached_remote_logs', JSON.stringify(remoteLogs));
}

function setDisplayMode(mode) {
  displayMode = mode;
  localStorage.setItem('nf_viewer_display_mode', mode);
  updateToggleUI();
  renderData();
}

function updateToggleUI() {
  const btn10 = document.getElementById('btnLimit10');
  const btnAll = document.getElementById('btnLimitAll');
  const title = document.getElementById('historyTitle');

  if (!btn10 || !btnAll) return;

  if (displayMode === 'all') {
    btn10.classList.remove('active');
    btnAll.classList.add('active');
    if (title) title.textContent = '記録履歴（全件）';
  } else {
    btn10.classList.add('active');
    btnAll.classList.remove('active');
    if (title) title.textContent = `記録履歴（直近${MAX_DISPLAY_COUNT}件）`;
  }
}

// --- 高速画面描画（DocumentFragment 使用） ---
function renderData() {
  const count = remoteLogs.length;
  const sum = remoteLogs.reduce((total, item) => total + Number(item.amount || 0), 0);

  document.getElementById('totalCount').innerHTML = `${count} <span class="unit">件</span>`;
  document.getElementById('totalAmount').innerHTML = `${sum.toLocaleString()} <span class="unit">円</span>`;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  document.getElementById('lastUpdate').textContent = `最終更新: ${timeStr}`;

  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;

  let logsToRender = remoteLogs.slice().reverse();
  if (displayMode === 'limit') {
    logsToRender = logsToRender.slice(0, MAX_DISPLAY_COUNT);
  }

  const fragment = document.createDocumentFragment();
  logsToRender.forEach(item => {
    const tr = document.createElement('tr');
    
    const tdDate = document.createElement('td');
    tdDate.textContent = item.date;

    const tdAmount = document.createElement('td');
    tdAmount.textContent = item.amount;

    const tdUser = document.createElement('td');
    tdUser.textContent = item.user || "未設定";

    tr.appendChild(tdDate);
    tr.appendChild(tdAmount);
    tr.appendChild(tdUser);
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function initRealtimeStream() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`${DB_URL}.json`);

  eventSource.onopen = () => updateNetworkStatus();

  eventSource.addEventListener('put', (e) => {
    updateNetworkStatus();
    const res = JSON.parse(e.data);
    if (!res) return;

    if (res.path === '/') {
      const rawData = res.data || {};
      remoteLogs = Object.keys(rawData).map(key => ({ key, ...rawData[key] }));
    } else {
      const key = res.path.replace('/', '');
      if (res.data === null) {
        remoteLogs = remoteLogs.filter(item => item.key !== key);
      } else {
        const index = remoteLogs.findIndex(item => item.key === key);
        if (index > -1) {
          remoteLogs[index] = { key, ...res.data };
        } else {
          remoteLogs.push({ key, ...res.data });
        }
      }
    }

    saveCachedRemoteLogs();
    renderData();
  });

  eventSource.onerror = (err) => {
    console.warn("リアルタイム接続切断。再接続を待機中...", err);
    updateNetworkStatus();
  };
}
