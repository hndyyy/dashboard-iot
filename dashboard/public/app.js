/**
 * HealthGuard IoT - Frontend Dashboard Controller
 * Mengelola koneksi real-time (WebSocket / SSE), Chart.js, kontrol sesi, dan telemetri MAX30102.
 */

// State Aplikasi
const state = {
  activeSession: null,
  selectedPatient: 'patient001',
  deviceId: 'device01',
  isSimulatorOn: false,
  timerInterval: null,
  sessionStartTime: null,
  vitalsHistory: [],
  metrics: {
    hr: { min: null, max: null, sum: 0, count: 0 },
    spo2: { min: null, max: null, sum: 0, count: 0 }
  }
};

// Elemen DOM
const el = {
  mqttPill: document.getElementById('mqtt-status-pill'),
  mqttDot: document.getElementById('mqtt-dot'),
  mqttText: document.getElementById('mqtt-text'),

  devicePill: document.getElementById('device-status-pill'),
  deviceDot: document.getElementById('device-dot'),
  deviceText: document.getElementById('device-text'),

  simToggle: document.getElementById('simulator-toggle'),
  patientSelect: document.getElementById('patient-select'),
  deviceIdInput: document.getElementById('device-id-input'),

  btnStart: document.getElementById('btn-start-session'),
  btnStop: document.getElementById('btn-stop-session'),
  sessionBadge: document.getElementById('session-badge'),

  currentSessionId: document.getElementById('current-session-id'),
  currentPatientName: document.getElementById('current-patient-name'),
  sessionTimer: document.getElementById('session-timer'),
  esp32DetailMsg: document.getElementById('esp32-detail-msg'),

  hrValue: document.getElementById('hr-value'),
  hrStatus: document.getElementById('hr-status-label'),
  hrBar: document.getElementById('hr-bar'),
  hrMin: document.getElementById('hr-min'),
  hrAvg: document.getElementById('hr-avg'),
  hrMax: document.getElementById('hr-max'),
  hrValidBadge: document.getElementById('hr-valid-badge'),
  pulseIcon: document.querySelector('.pulse-icon'),

  spo2Value: document.getElementById('spo2-value'),
  spo2Status: document.getElementById('spo2-status-label'),
  spo2Bar: document.getElementById('spo2-bar'),
  spo2Min: document.getElementById('spo2-min'),
  spo2Avg: document.getElementById('spo2-avg'),
  spo2Max: document.getElementById('spo2-max'),
  spo2ValidBadge: document.getElementById('spo2-valid-badge'),

  fingerTag: document.getElementById('finger-tag'),
  fingerIconWrapper: document.getElementById('finger-icon-wrapper'),
  fingerTitle: document.getElementById('finger-status-title'),
  fingerDesc: document.getElementById('finger-status-desc'),
  lastPacketTime: document.getElementById('last-packet-time'),

  historyTbody: document.getElementById('history-tbody'),
  btnClearChart: document.getElementById('btn-clear-chart'),
  btnRefreshHistory: document.getElementById('btn-refresh-history'),
  btnExportCsv: document.getElementById('btn-export-csv')
};

// Inisialisasi Chart.js
let vitalsChart;
function initChart() {
  const ctx = document.getElementById('vitalsChart').getContext('2d');
  vitalsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Heart Rate (BPM)',
          data: [],
          borderColor: '#f43f5e',
          backgroundColor: 'rgba(244, 63, 94, 0.1)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          yAxisID: 'y'
        },
        {
          label: 'SpO2 (%)',
          data: [],
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34, 211, 238, 0.1)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: { color: '#e2e8f0', font: { family: 'Segoe UI' } }
        },
        tooltip: {
          backgroundColor: '#1a1d27',
          titleColor: '#22d3ee',
          bodyColor: '#f1f5f9',
          borderColor: '#2a2e3d',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: '#1e2230' },
          ticks: { color: '#94a3b8', maxRotation: 0 }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 40,
          max: 180,
          grid: { color: '#1e2230' },
          ticks: { color: '#f43f5e' },
          title: { display: true, text: 'BPM', color: '#f43f5e' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          min: 75,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { color: '#22d3ee' },
          title: { display: true, text: 'SpO2 %', color: '#22d3ee' }
        }
      }
    }
  });
}

// Koneksi Real-Time (SSE dengan fallback WebSocket)
function connectRealtime() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  let ws;
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      setMqttStatus(true, 'Terhubung');
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleIncomingMessage(msg);
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };
    ws.onclose = () => {
      setMqttStatus(false, 'Terputus (mencoba ulang...)');
      setTimeout(connectRealtime, 3000);
    };
    ws.onerror = () => {
      setMqttStatus(false, 'Error Koneksi');
    };
  } catch (e) {
    // Fallback SSE
    fallbackSSE();
  }
}

function fallbackSSE() {
  const evtSource = new EventSource('/api/stream');
  evtSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleIncomingMessage(msg);
    } catch (err) {
      console.error(err);
    }
  };
  evtSource.onerror = () => {
    setMqttStatus(false, 'SSE Offline');
  };
}

// Router Pesan Masuk
function handleIncomingMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'vitals':
      updateVitals(msg.data);
      break;
    case 'status':
      updateDeviceStatus(msg.data);
      break;
    case 'session_update':
      updateSessionUI(msg.data);
      break;
    case 'mqtt_status':
      setMqttStatus(msg.connected, msg.message);
      break;
    case 'simulator_status':
      el.simToggle.checked = msg.enabled;
      state.isSimulatorOn = msg.enabled;
      break;
  }
}

// Pembaruan Status MQTT
function setMqttStatus(connected, text) {
  if (connected) {
    el.mqttDot.className = 'status-dot connected';
    el.mqttText.textContent = text || 'Online (Port 1883)';
  } else {
    el.mqttDot.className = 'status-dot disconnected';
    el.mqttText.textContent = text || 'Offline';
  }
}

// Pembaruan Status Perangkat ESP32
function updateDeviceStatus(data) {
  const status = data.status || 'unknown';
  const detail = data.detail || '-';

  el.deviceDot.className = 'status-dot online';
  el.deviceText.textContent = status.toUpperCase();
  el.esp32DetailMsg.textContent = detail;

  if (status === 'finger_not_detected') {
    setFingerDetected(false);
  } else if (status === 'ready_for_measurement') {
    el.esp32DetailMsg.textContent = 'Sesi aktif: silakan tempelkan jari pada sensor MAX30102';
  } else if (status === 'session_stopped') {
    el.esp32DetailMsg.textContent = 'Sesi dihentikan oleh operator';
    setFingerDetected(false);
  }
}

// Pembaruan Telemetri Vitals
function updateVitals(data) {
  const hr = data.heart_rate_bpm;
  const spo2 = data.spo2_percent;
  const hrValid = data.hr_valid;
  const spo2Valid = data.spo2_valid;
  const finger = data.finger_detected;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID');

  el.lastPacketTime.textContent = timeStr;
  setFingerDetected(finger);

  // Heart Rate
  if (finger && hrValid && hr > 0) {
    el.hrValue.textContent = hr;
    el.pulseIcon.classList.add('pulse-active');
    setTimeout(() => el.pulseIcon.classList.remove('pulse-active'), 600);

    // Bar & Status Label
    const hrPct = Math.min(Math.max(((hr - 40) / 140) * 100, 0), 100);
    el.hrBar.style.width = hrPct + '%';

    if (hr < 60) {
      el.hrStatus.innerHTML = '<span style="color: #f59e0b;">Bradikardia (&lt; 60 BPM)</span>';
      el.hrValidBadge.className = 'validity-badge invalid';
      el.hrValidBadge.textContent = 'Rendah';
    } else if (hr > 100) {
      el.hrStatus.innerHTML = '<span style="color: #ef4444;">Takikardia (&gt; 100 BPM)</span>';
      el.hrValidBadge.className = 'validity-badge invalid';
      el.hrValidBadge.textContent = 'Tinggi';
    } else {
      el.hrStatus.innerHTML = '<span style="color: #10b981;">Normal (60 - 100 BPM)</span>';
      el.hrValidBadge.className = 'validity-badge valid';
      el.hrValidBadge.textContent = 'Valid';
    }

    // Hitung Min/Max/Avg
    calcMetric('hr', hr);
  } else {
    el.hrValue.textContent = '--';
    el.hrBar.style.width = '0%';
    el.hrValidBadge.className = 'validity-badge invalid';
    el.hrValidBadge.textContent = finger ? 'Kalkulasi...' : 'Lepas';
    el.hrStatus.textContent = finger ? 'Menstabilkan sensor...' : 'Jari belum diletakkan';
  }

  // SpO2
  if (finger && spo2Valid && spo2 > 0) {
    el.spo2Value.textContent = spo2;
    const spo2Pct = Math.min(Math.max(((spo2 - 75) / 25) * 100, 0), 100);
    el.spo2Bar.style.width = spo2Pct + '%';

    if (spo2 < 90) {
      el.spo2Status.innerHTML = '<span style="color: #ef4444; font-weight: bold;">Hipoksia Kritis (&lt; 90%)</span>';
      el.spo2ValidBadge.className = 'validity-badge invalid';
      el.spo2ValidBadge.textContent = 'Bahaya';
    } else if (spo2 < 95) {
      el.spo2Status.innerHTML = '<span style="color: #f59e0b;">Peringatan (90 - 94%)</span>';
      el.spo2ValidBadge.className = 'validity-badge invalid';
      el.spo2ValidBadge.textContent = 'Waspada';
    } else {
      el.spo2Status.innerHTML = '<span style="color: #10b981;">Optimal (&ge; 95%)</span>';
      el.spo2ValidBadge.className = 'validity-badge valid';
      el.spo2ValidBadge.textContent = 'Optimal';
    }

    calcMetric('spo2', spo2);
  } else {
    el.spo2Value.textContent = '--';
    el.spo2Bar.style.width = '0%';
    el.spo2ValidBadge.className = 'validity-badge invalid';
    el.spo2ValidBadge.textContent = finger ? 'Kalkulasi...' : 'Lepas';
    el.spo2Status.textContent = finger ? 'Menstabilkan sinyal optik...' : 'Jari belum diletakkan';
  }

  // Tambahkan ke Grafik
  if (finger && (hrValid || spo2Valid)) {
    addChartPoint(timeStr, hrValid ? hr : null, spo2Valid ? spo2 : null);
  }

  // Tambahkan ke Tabel Riwayat
  addHistoryRow({
    time: timeStr,
    session_id: data.session_id,
    patient_id: data.patient_id,
    heart_rate_bpm: hrValid ? hr : '-',
    spo2_percent: spo2Valid ? spo2 : '-',
    finger_detected: finger,
    hr_valid: hrValid,
    spo2_valid: spo2Valid
  });
}

function setFingerDetected(isDetected) {
  if (isDetected) {
    el.fingerTag.className = 'sensor-tag detected';
    el.fingerTag.textContent = 'JARI TERDETEKSI';
    el.fingerIconWrapper.className = 'sensor-icon-wrapper active';
    el.fingerTitle.textContent = 'Sensor Aktif Mengukur';
    el.fingerDesc.textContent = 'Sinyal infra merah & lampu merah diterima baik oleh MAX30102. Pengukuran sedang berlangsung.';
  } else {
    el.fingerTag.className = 'sensor-tag';
    el.fingerTag.textContent = 'JARI BELUM TERDETEKSI';
    el.fingerIconWrapper.className = 'sensor-icon-wrapper';
    el.fingerTitle.textContent = 'Silakan Letakkan Jari';
    el.fingerDesc.textContent = 'Pastikan ujung jari diletakkan menutupi LED merah dan detektor IR MAX30102 dengan tekanan lembut.';
  }
}

function calcMetric(type, val) {
  const m = state.metrics[type];
  if (m.min === null || val < m.min) m.min = val;
  if (m.max === null || val > m.max) m.max = val;
  m.sum += val;
  m.count++;
  const avg = Math.round(m.sum / m.count);

  if (type === 'hr') {
    el.hrMin.textContent = m.min + ' BPM';
    el.hrMax.textContent = m.max + ' BPM';
    el.hrAvg.textContent = avg + ' BPM';
  } else {
    el.spo2Min.textContent = m.min + '%';
    el.spo2Max.textContent = m.max + '%';
    el.spo2Avg.textContent = avg + '%';
  }
}

// Penambahan Titik Grafik
function addChartPoint(time, hr, spo2) {
  if (!vitalsChart) return;
  const labels = vitalsChart.data.labels;
  const hrDataset = vitalsChart.data.datasets[0].data;
  const spo2Dataset = vitalsChart.data.datasets[1].data;

  labels.push(time);
  hrDataset.push(hr);
  spo2Dataset.push(spo2);

  // Batasi 20 titik di grafik agar rapi
  if (labels.length > 20) {
    labels.shift();
    hrDataset.shift();
    spo2Dataset.shift();
  }

  vitalsChart.update('none'); // Update tanpa animasi berat
}

// Penambahan Baris Riwayat
function addHistoryRow(item) {
  state.vitalsHistory.unshift(item);
  if (state.vitalsHistory.length > 50) state.vitalsHistory.pop();

  const emptyRow = el.historyTbody.querySelector('.text-muted');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  const hrColor = (typeof item.heart_rate_bpm === 'number' && item.heart_rate_bpm >= 60 && item.heart_rate_bpm <= 100) ? '#10b981' : '#f59e0b';
  const spo2Color = (typeof item.spo2_percent === 'number' && item.spo2_percent >= 95) ? '#10b981' : '#f59e0b';

  tr.innerHTML = `
    <td><code>${item.time}</code></td>
    <td><code>${item.session_id ? item.session_id.substring(0, 16) + '...' : '-'}</code></td>
    <td><strong style="color: #22d3ee;">${item.patient_id}</strong></td>
    <td style="color: ${hrColor}; font-weight: bold;">${item.heart_rate_bpm} BPM</td>
    <td style="color: ${spo2Color}; font-weight: bold;">${item.spo2_percent} %</td>
    <td>${item.finger_detected ? '<span class="badge active" style="font-size:0.7rem;">Terdeteksi</span>' : '<span class="badge" style="font-size:0.7rem;">Lepas</span>'}</td>
    <td>${item.hr_valid && item.spo2_valid ? '<span style="color: #10b981;"><i class="fa-solid fa-check"></i> Valid</span>' : '<span style="color: #f59e0b;"><i class="fa-solid fa-clock"></i> Estimasi</span>'}</td>
  `;

  el.historyTbody.insertBefore(tr, el.historyTbody.firstChild);
}

// Timer Sesi
function startTimer() {
  state.sessionStartTime = Date.now();
  if (state.timerInterval) clearInterval(state.timerInterval);

  state.timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - state.sessionStartTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    el.sessionTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// Pembaruan Sesi di UI
function updateSessionUI(session) {
  if (session && session.status === 'authorized') {
    state.activeSession = session;
    el.sessionBadge.className = 'badge active';
    el.sessionBadge.textContent = 'SESI AKTIF';
    el.btnStart.disabled = true;
    el.btnStop.disabled = false;

    el.currentSessionId.textContent = session.session_id;
    el.currentPatientName.textContent = session.patient_id;
    el.esp32DetailMsg.textContent = 'Otorisasi berhasil dikirim ke health/' + (session.device_id || 'device01') + '/session';
    startTimer();
  } else {
    state.activeSession = null;
    el.sessionBadge.className = 'badge';
    el.sessionBadge.textContent = 'TIDAK ADA SESI AKTIF';
    el.btnStart.disabled = false;
    el.btnStop.disabled = true;

    el.currentSessionId.textContent = '-';
    el.currentPatientName.textContent = '-';
    el.esp32DetailMsg.textContent = 'Sesi telah dihentikan';
    stopTimer();
  }
}

// Event Listeners Kontrol Sesi
el.btnStart.addEventListener('click', async () => {
  const patientId = el.patientSelect.value;
  const deviceId = el.deviceIdInput.value.trim() || 'device01';

  try {
    const res = await fetch('/api/sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id: patientId, device_id: deviceId })
    });
    const data = await res.json();
    if (data.success) {
      updateSessionUI(data.session);
    } else {
      alert('Gagal memulai sesi: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    console.error(e);
    alert('Gagal menghubungi backend: ' + e.message);
  }
});

el.btnStop.addEventListener('click', async () => {
  const deviceId = el.deviceIdInput.value.trim() || 'device01';
  try {
    const res = await fetch('/api/sessions/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId })
    });
    const data = await res.json();
    if (data.success) {
      updateSessionUI(null);
    }
  } catch (e) {
    console.error(e);
  }
});

// Event Listener Simulator Switch
el.simToggle.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  try {
    await fetch('/api/simulator/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
  } catch (err) {
    console.error(err);
  }
});

// Bersihkan Grafik
el.btnClearChart.addEventListener('click', () => {
  if (vitalsChart) {
    vitalsChart.data.labels = [];
    vitalsChart.data.datasets[0].data = [];
    vitalsChart.data.datasets[1].data = [];
    vitalsChart.update();
  }
});

// Export CSV
el.btnExportCsv.addEventListener('click', () => {
  if (state.vitalsHistory.length === 0) {
    alert('Belum ada data pengukuran untuk diunduh.');
    return;
  }
  let csv = 'Waktu,ID_Sesi,ID_Pasien,Heart_Rate_BPM,SpO2_Percent,Jari_Terdeteksi,Valid\\n';
  state.vitalsHistory.forEach(r => {
    csv += `"${r.time}","${r.session_id}","${r.patient_id}",${r.heart_rate_bpm},${r.spo2_percent},${r.finger_detected},${r.hr_valid && r.spo2_valid}\\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vitals_measurement_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Inisialisasi saat Halaman Dimuat
window.addEventListener('DOMContentLoaded', () => {
  initChart();
  connectRealtime();
});
