const DB_URL = "https://nf-reception-default-rtdb.asia-southeast1.firebasedatabase.app/moneyLogs";

window.onload = function() {
  const eventSource = new EventSource(`${DB_URL}.json`);

  eventSource.addEventListener('put', (e) => {
    const res = JSON.parse(e.data);
    let count = 0;
    let sum = 0;

    if (res && res.data) {
      const logs = (res.path === '/') 
        ? Object.values(res.data) 
        : [res.data];

      count = logs.length;
      sum = logs.reduce((total, item) => total + Number(item.amount || 0), 0);
    }

    // 表示更新
    document.getElementById('totalCount').innerHTML = `${count} <span class="unit">件</span>`;
    document.getElementById('totalAmount').innerHTML = `${sum.toLocaleString()} <span class="unit">円</span>`;

    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' +
                    String(now.getMinutes()).padStart(2, '0') + ':' +
                    String(now.getSeconds()).padStart(2, '0');
    document.getElementById('lastUpdate').textContent = `最終更新: ${timeStr}`;
  });
};
