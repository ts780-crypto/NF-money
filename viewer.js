// Firebase Realtime Database REST API エンドポイント
const DB_URL = "https://nf-reception-default-rtdb.asia-southeast1.firebasedatabase.app/moneyLogs";

// モニター表示用の制限設定
const MAX_DISPLAY_COUNT = 10; 

// 表示モード ('limit': 直近10件, 'all': 全件) - localStorageから状態を復元
let displayMode = localStorage.getItem('nf_viewer_display_mode') || 'limit';
let remoteLogs = [];

window.onload = function() {
  // Service Worker 登録（オフライン対応）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Error:', err));
  }

  // 1. キャッシュから即座に読み込んで表示
  loadCachedRemoteLogs();
  updateToggleUI();
  renderData();

  // 2. ネットワーク状態の監視と初期表示の設定
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  // 3. リアルタイム監視開始
  initRealtimeStream();
};

// --- ネットワーク状態の表示更新 ---
function updateNetworkStatus() {
  const statusBadge = document.getElementById('netStatus');
  const statusText = document.getElementById('netStatusText');
  if (!statusBadge || !statusText) return;

  if (navigator.onLine) {
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
    try {
      remoteLogs = JSON.parse(cached);
    } catch (e) {
      console.error("キャッシュ読み込みエラー", e);
    }
  }
}

function saveCachedRemoteLogs() {
  localStorage.setItem('nf_cached_remote_logs', JSON.stringify(remoteLogs));
}

// 表示モード切り替え処理
function setDisplayMode(mode) {
  displayMode = mode;
  localStorage.setItem('nf_viewer_display_mode', mode);
  updateToggleUI();
  renderData();
}

// ボタン見た目とタイトルの更新
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

function renderData() {
  // 1. 件数・合計金額の計算（常に全データから集計）
  const count = remoteLogs.length;
  const sum = remoteLogs.reduce((total, item) => total + Number(item.amount || 0), 0);

  document.getElementById('totalCount').innerHTML = `${count} <span class="unit">件</span>`;
  document.getElementById('totalAmount').innerHTML = `${sum.toLocaleString()} <span class="unit">円</span>`;

  // 2. 最終更新時刻の更新
  const now = new Date();
  const timeStr = String(now.getHours()).padStart(2, '0') + ':' +
                  String(now.getMinutes()).padStart(2, '0') + ':' +
                  String(now.getSeconds()).padStart(2, '0');
  document.getElementById('lastUpdate').textContent = `最終更新: ${timeStr}`;

  // 3. 記録履歴テーブルの描画
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let logsToRender = remoteLogs.slice().reverse();

  // Modeが 'limit' の場合のみ直近10件に絞り込み
  if (displayMode === 'limit') {
    logsToRender = logsToRender.slice(0, MAX_DISPLAY_COUNT);
  }

  logsToRender.forEach(item => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = item.date;
    row.insertCell(1).textContent = item.amount;
    row.insertCell(2).textContent = item.user || "未設定";
  });
}

function initRealtimeStream() {
  const eventSource = new EventSource(`${DB_URL}.json`);

  eventSource.addEventListener('put', (e) => {
    const res = JSON.parse(e.data);
    if (!res) return;

    if (res.path === '/') {
      // 全データ更新
      const rawData = res.data || {};
      remoteLogs = Object.keys(rawData).map(key => ({
        key: key,
        ...rawData[key]
      }));
    } else {
      // 差分（単一レコード）更新・削除
      const key = res.path.replace('/', '');
      if (res.data === null) {
        remoteLogs = remoteLogs.filter(item => item.key !== key);
      } else {
        const index = remoteLogs.findIndex(item => item.key === key);
        if (index > -1) {
          remoteLogs[index] = { key: key, ...res.data };
        } else {
          remoteLogs.push({ key: key, ...res.data });
        }
      }
    }

    saveCachedRemoteLogs();
    renderData();
  });

  eventSource.onerror = (err) => {
    console.warn("リアルタイム接続切断。再接続を待機中...", err);
  };
}
