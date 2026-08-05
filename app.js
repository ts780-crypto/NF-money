// Firebase Realtime Database REST API エンドポイント
const DB_URL = "https://nf-reception-default-rtdb.asia-southeast1.firebasedatabase.app/moneyLogs";

let remoteLogs = [];   // Firebaseから同期されたデータ
let pendingLogs = [];  // ローカル（localStorage）にある未送信データ
let presetAmounts = [250, 200, 150, 100]; // 金額ボタンの初期値

window.onload = function() {
  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Error:', err));
  }

  // 保存された担当者名の読み込み
  const savedName = localStorage.getItem('savedUserName');
  if (savedName) document.getElementById('userName').value = savedName;

  // 1. 金額プリセットの読み込みとボタン描画
  loadPresets();
  renderButtons();

  // 2. ローカルの未送信データ ＆ キャッシュされたリモートデータを即座に読み込み
  loadPendingLogs();
  loadCachedRemoteLogs();

  // 3. サーバーからの受信を待たずに初回描画（0表示チラつき回避）
  renderData();

  // ネットワーク状態の監視
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  // REST API (Server-Sent Events) によるリアルタイム監視開始
  initRealtimeStream();
};

// --- ローカルキャッシュ操作 ---
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

// --- 金額プリセット（ボタンカスタマイズ）機能 ---
function loadPresets() {
  const saved = localStorage.getItem('nf_preset_amounts');
  if (saved) {
    try {
      presetAmounts = JSON.parse(saved);
    } catch (e) {
      console.error("プリセット読み込みエラー", e);
    }
  }
}

function renderButtons() {
  const grid = document.getElementById('btnGrid');
  if (!grid) return;
  grid.innerHTML = '';

  presetAmounts.forEach(amount => {
    const btn = document.createElement('button');
    btn.className = 'btn-input';
    btn.innerHTML = `${amount}<span class="btn-unit">円</span>`;
    btn.onclick = () => 記録(amount);
    grid.appendChild(btn);
  });
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    document.getElementById('preset1').value = presetAmounts[0] || '';
    document.getElementById('preset2').value = presetAmounts[1] || '';
    document.getElementById('preset3').value = presetAmounts[2] || '';
    document.getElementById('preset4').value = presetAmounts[3] || '';
  }
}

function savePresets() {
  const p1 = Number(document.getElementById('preset1').value) || 0;
  const p2 = Number(document.getElementById('preset2').value) || 0;
  const p3 = Number(document.getElementById('preset3').value) || 0;
  const p4 = Number(document.getElementById('preset4').value) || 0;

  presetAmounts = [p1, p2, p3, p4];
  localStorage.setItem('nf_preset_amounts', JSON.stringify(presetAmounts));

  renderButtons();
  toggleSettings();
}

// --- REST API リアルタイム監視 (EventSource) ---
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
        // 削除された場合
        remoteLogs = remoteLogs.filter(item => item.key !== key);
      } else {
        // 追加または変更された場合
        const index = remoteLogs.findIndex(item => item.key === key);
        if (index > -1) {
          remoteLogs[index] = { key: key, ...res.data };
        } else {
          remoteLogs.push({ key: key, ...res.data });
        }
      }
    }
    
    // 最新リモートデータをキャッシュに保存して再描画
    saveCachedRemoteLogs();
    renderData();
  });

  eventSource.onerror = (err) => {
    console.warn("リアルタイム接続切断。再接続を待機中...", err);
  };
}

// --- ローカルキュー (localStorage) 操作 ---
function loadPendingLogs() {
  const stored = localStorage.getItem('nf_pending_logs');
  pendingLogs = stored ? JSON.parse(stored) : [];
}

function savePendingLogs() {
  localStorage.setItem('nf_pending_logs', JSON.stringify(pendingLogs));
}

// --- ネットワーク状態＆自動同期処理 ---
function updateNetworkStatus() {
  const statusBadge = document.getElementById('netStatus');
  const statusText = document.getElementById('netStatusText');

  if (navigator.onLine) {
    statusBadge.className = "net-badge online";
    statusText.textContent = "オンライン";
    syncPendingLogs();
  } else {
    statusBadge.className = "net-badge offline";
    statusText.textContent = "オフライン";
  }
  renderData();
}

// REST API (POST) を使った未送信データの一括送信
async function syncPendingLogs() {
  if (!navigator.onLine || pendingLogs.length === 0) return;

  const itemsToSync = [...pendingLogs];
  for (const item of itemsToSync) {
    try {
      const res = await fetch(`${DB_URL}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          date: item.date,
          amount: item.amount,
          user: item.user,
          timestamp: item.timestamp || Date.now()
        })
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      // 送信成功したものをローカルから除去
      pendingLogs = pendingLogs.filter(p => p.id !== item.id);
      savePendingLogs();
    } catch (err) {
      console.error("送信エラー:", err);
      break;
    }
  }
  renderData();
}

// --- 記録処理 ---
function 記録(金額) {
  const userName = document.getElementById('userName').value || "未設定";
  const now = new Date();
  const dateStr = now.getFullYear() + '/' +
    String(now.getMonth() + 1).padStart(2, '0') + '/' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');

  const logItem = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    date: dateStr,
    amount: 金額,
    user: userName,
    timestamp: Date.now()
  };

  pendingLogs.push(logItem);
  savePendingLogs();
  renderData();

  if (navigator.onLine) {
    syncPendingLogs();
  }
}

// --- 画面レンダリング ---
function renderData() {
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const remoteIds = new Set(remoteLogs.map(r => r.id).filter(Boolean));
  const activePendingLogs = pendingLogs.filter(p => !remoteIds.has(p.id));
  const allLogs = [...remoteLogs, ...activePendingLogs.map(p => ({ ...p, isPending: true }))];

  const count = allLogs.length;
  const sum = allLogs.reduce((total, item) => total + Number(item.amount || 0), 0);

  document.getElementById('totalCount').innerHTML = `${count} <span class="unit">件</span>`;
  document.getElementById('totalAmount').innerHTML = `${sum.toLocaleString()} <span class="unit">円</span>`;

  // 楽観的UI: オフライン時のみ「未送信: X件」を表示
  const syncInfo = document.getElementById('syncInfo');
  if (!navigator.onLine && activePendingLogs.length > 0) {
    syncInfo.textContent = `未送信: ${activePendingLogs.length}件`;
    syncInfo.style.color = 'var(--cancel-text)';
  } else {
    syncInfo.textContent = "全データ同期完了";
    syncInfo.style.color = 'var(--text-sub)';
  }

  // テーブル出力（新しい順）
  allLogs.slice().reverse().forEach(item => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = item.date;
    row.insertCell(1).textContent = item.amount;
    
    const userCell = row.insertCell(2);
    userCell.textContent = item.user || "未設定";
    
    // オフラインの未送信データのみ「未送信」タグを表示
    if (item.isPending && !navigator.onLine) {
      const tag = document.createElement('span');
      tag.className = 'pending-tag';
      tag.textContent = '未送信';
      userCell.appendChild(tag);
    }
  });
}

// --- 操作機能 (REST API: DELETE) ---
async function 直近1件削除() {
  const remoteIds = new Set(remoteLogs.map(r => r.id).filter(Boolean));
  const activePendingLogs = pendingLogs.filter(p => !remoteIds.has(p.id));

  if (activePendingLogs.length > 0) {
    const lastPending = activePendingLogs[activePendingLogs.length - 1];
    if (confirm(`【未送信データ】直近の記録を取り消しますか？\n・金額: ${lastPending.amount}円`)) {
      pendingLogs = pendingLogs.filter(p => p.id !== lastPending.id);
      savePendingLogs();
      renderData();
    }
    return;
  }

  if (remoteLogs.length > 0) {
    const lastLog = remoteLogs[remoteLogs.length - 1];
    if (confirm(`直近の記録を取り消しますか？\n・日時: ${lastLog.date}\n・金額: ${lastLog.amount}円`)) {
      try {
        await fetch(`${DB_URL}/${lastLog.key}.json`, { method: 'DELETE' });
      } catch (err) {
        alert("削除に失敗しました: " + err.message);
      }
    }
    return;
  }

  alert('削除するデータがありません');
}

function csvダウンロード() {
  const remoteIds = new Set(remoteLogs.map(r => r.id).filter(Boolean));
  const activePendingLogs = pendingLogs.filter(p => !remoteIds.has(p.id));
  const allLogs = [...remoteLogs, ...activePendingLogs];

  if (allLogs.length === 0) {
    alert('データがありません');
    return;
  }

  let csvContent = '\uFEFF日時,金額,担当者,ステータス\n';
  allLogs.forEach(item => {
    const status = activePendingLogs.some(p => p.id === item.id) ? '未送信' : '同期済';
    csvContent += `"${item.date}",${item.amount},"${item.user || ''}","${status}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '共有金額記録.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function データ全削除() {
  if (confirm('全員の共有記録およびローカルの未送信データをすべて削除しますか？\n※元に戻せません')) {
    pendingLogs = [];
    remoteLogs = [];
    savePendingLogs();
    saveCachedRemoteLogs();
    try {
      await fetch(`${DB_URL}.json`, { method: 'DELETE' });
    } catch (err) {
      alert("全削除に失敗しました: " + err.message);
    }
  }
}
