// Firebase Realtime Database REST API エンドポイント
const DB_URL = "https://nf-reception-default-rtdb.asia-southeast1.firebasedatabase.app/moneyLogs";

// 入力画面のパスワード設定
const APP_PASSWORD = "nf2026";

// 定数・変数
const DEFAULT_PRESETS = [250, 200, 150, 100];
let remoteLogs = [];   // Firebaseから同期されたデータ
let pendingLogs = [];  // ローカル（localStorage）にある未送信データ
let presetAmounts = [...DEFAULT_PRESETS];
let eventSource = null; // リアルタイム通信オブジェクト
let isSyncing = false;  // 二重送信防止ロックフラグ

window.onload = function() {
  checkAuthStatus();
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Error:', err));
  }

  const savedName = localStorage.getItem('savedUserName');
  if (savedName) document.getElementById('userName').value = savedName;

  loadPresets();
  renderButtons();

  loadPendingLogs();
  loadCachedRemoteLogs();
  renderData();

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

  initRealtimeStream();
};

// --- 認証機能 ---
function checkAuthStatus() {
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;

  if (sessionStorage.getItem('nf_authenticated') === 'true') {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
  }
}

function authenticate(event) {
  if (event) event.preventDefault();

  const input = document.getElementById('passInput').value;
  const errorMsg = document.getElementById('authError');

  if (input === APP_PASSWORD) {
    sessionStorage.setItem('nf_authenticated', 'true');
    document.getElementById('authOverlay').style.display = 'none';
    if (errorMsg) errorMsg.style.display = 'none';
  } else {
    if (errorMsg) errorMsg.style.display = 'block';
  }
}

// --- ローカルキャッシュ操作 ---
function loadCachedRemoteLogs() {
  const cached = localStorage.getItem('nf_cached_remote_logs');
  if (cached) {
    try { remoteLogs = JSON.parse(cached); } catch (e) { console.error("キャッシュ読み込みエラー", e); }
  }
}

function saveCachedRemoteLogs() {
  localStorage.setItem('nf_cached_remote_logs', JSON.stringify(remoteLogs));
}

// --- 金額プリセット機能 ---
function loadPresets() {
  const saved = localStorage.getItem('nf_preset_amounts');
  if (saved) {
    try { presetAmounts = JSON.parse(saved); } catch (e) { console.error("プリセット読み込みエラー", e); }
  }
}

function renderButtons() {
  const grid = document.getElementById('btnGrid');
  if (!grid) return;
  
  const fragment = document.createDocumentFragment();
  presetAmounts.forEach(amount => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-input';
    btn.innerHTML = `${amount}<span class="btn-unit">円</span>`;
    btn.onclick = () => recordLog(amount);
    fragment.appendChild(btn);
  });

  grid.innerHTML = '';
  grid.appendChild(fragment);
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

function resetPresets() {
  if (confirm('金額ボタンを初期設定（250円・200円・150円・100円）に戻しますか？')) {
    presetAmounts = [...DEFAULT_PRESETS];
    localStorage.removeItem('nf_preset_amounts');
    renderButtons();
    toggleSettings();
  }
}

// --- REST API リアルタイム監視 (EventSource) ---
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
      // 💡【修正箇所】1階層目のIDキーを確実に取得できるように修正
      const key = res.path.split('/')[1];
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

// --- ローカルキュー (localStorage) ---
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
  if (!statusBadge || !statusText) return;

  const isSSEOpen = eventSource && (eventSource.readyState === EventSource.OPEN);
  const isConnected = navigator.onLine && isSSEOpen;

  if (isConnected) {
    statusBadge.className = "net-badge online";
    statusText.textContent = "オンライン";
    syncPendingLogs();
  } else {
    statusBadge.className = "net-badge offline";
    statusText.textContent = "オフライン";
  }
  renderData();
}

// 排他制御（ロック）付き未送信データの一括同期
async function syncPendingLogs() {
  if (!navigator.onLine || pendingLogs.length === 0 || isSyncing) return;

  isSyncing = true; // 送信中ロック開始

  try {
    const itemsToSync = [...pendingLogs];
    for (const item of itemsToSync) {
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

      const resData = await res.json();
      
      if (resData && resData.name) {
        if (!remoteLogs.some(r => r.key === resData.name)) {
          remoteLogs.push({
            key: resData.name,
            id: item.id,
            date: item.date,
            amount: item.amount,
            user: item.user,
            timestamp: item.timestamp || Date.now()
          });
        }
      }

      pendingLogs = pendingLogs.filter(p => p.id !== item.id);
      savePendingLogs();
    }
  } catch (err) {
    console.error("送信エラー:", err);
  } finally {
    isSyncing = false; // 送信中ロック解除
    saveCachedRemoteLogs();
    renderData();
  }
}

// --- 記録処理 ---
function recordLog(amount) {
  const userName = document.getElementById('userName').value || "未設定";
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const logItem = {
    // 💡【修正箇所】非推奨の substr(2, 5) を slice(2, 7) に変更
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    date: dateStr,
    amount: amount,
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

// --- 高速画面描画（DocumentFragment 使用） ---
function renderData() {
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;

  const remoteIds = new Set(remoteLogs.map(r => r.id).filter(Boolean));
  const activePendingLogs = pendingLogs.filter(p => !remoteIds.has(p.id));
  const allLogs = [...remoteLogs, ...activePendingLogs.map(p => ({ ...p, isPending: true }))];

  const count = allLogs.length;
  const sum = allLogs.reduce((total, item) => total + Number(item.amount || 0), 0);

  document.getElementById('totalCount').innerHTML = `${count} <span class="unit">件</span>`;
  document.getElementById('totalAmount').innerHTML = `${sum.toLocaleString()} <span class="unit">円</span>`;

  const syncInfo = document.getElementById('syncInfo');
  if (syncInfo) {
    if (!navigator.onLine && activePendingLogs.length > 0) {
      syncInfo.textContent = `未送信: ${activePendingLogs.length}件`;
      syncInfo.style.color = 'var(--cancel-text)';
    } else {
      syncInfo.textContent = "全データ同期完了";
      syncInfo.style.color = 'var(--text-sub)';
    }
  }

  // DocumentFragment による一括挿入（高速化）
  const fragment = document.createDocumentFragment();
  const logsToRender = allLogs.slice().reverse();

  logsToRender.forEach(item => {
    const tr = document.createElement('tr');
    
    const tdDate = document.createElement('td');
    tdDate.textContent = item.date;
    
    const tdAmount = document.createElement('td');
    tdAmount.textContent = item.amount;

    const tdUser = document.createElement('td');
    tdUser.textContent = item.user || "未設定";

    if (item.isPending && !navigator.onLine) {
      const tag = document.createElement('span');
      tag.className = 'pending-tag';
      tag.textContent = '未送信';
      tdUser.appendChild(tag);
    }

    tr.appendChild(tdDate);
    tr.appendChild(tdAmount);
    tr.appendChild(tdUser);
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

// --- 操作機能 ---
async function deleteLastLog() {
  const userName = document.getElementById('userName').value || "未設定";
  const remoteIds = new Set(remoteLogs.map(r => r.id).filter(Boolean));
  const activePendingLogs = pendingLogs.filter(p => !remoteIds.has(p.id));

  // 💡【修正箇所】自分の未送信ログだけを対象にして削除
  const myPendingLogs = activePendingLogs.filter(p => (p.user || "未設定") === userName);
  if (myPendingLogs.length > 0) {
    const lastPending = myPendingLogs[myPendingLogs.length - 1];
    if (confirm(`【未送信データ】${userName}さんの直近の記録を取り消しますか？\n・金額: ${lastPending.amount}円`)) {
      pendingLogs = pendingLogs.filter(p => p.id !== lastPending.id);
      savePendingLogs();
      renderData();
    }
    return;
  }

  // 💡【修正箇所】自分の同期済みログだけを対象にして削除（他人のデータを消さない）
  const myRemoteLogs = remoteLogs.filter(r => (r.user || "未設定") === userName);
  if (myRemoteLogs.length > 0) {
    const lastLog = myRemoteLogs[myRemoteLogs.length - 1];
    if (confirm(`【${userName}さんの直近の記録】を取り消しますか？\n・日時: ${lastLog.date}\n・金額: ${lastLog.amount}円`)) {
      try {
        await fetch(`${DB_URL}/${lastLog.key}.json`, { method: 'DELETE' });
      } catch (err) {
        alert("削除に失敗しました: " + err.message);
      }
    }
    return;
  }

  alert(`${userName}さんの削除可能なデータがありません`);
}

function downloadCSV() {
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

async function deleteAllLogs() {
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

// 💡【修正箇所】const宣言から window オブジェクトへの割り当てに変更（HTMLの onclick から確実に動くように補強）
window.記録 = recordLog;
window.直近1件削除 = deleteLastLog;
window.csvダウンロード = downloadCSV;
window.データ全削除 = deleteAllLogs;
