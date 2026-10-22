/**
 * HealthGuard IoT - Backend Server
 * Menangani koneksi MQTT (Mosquitto), WebSocket Real-time, Validasi Sesi ESP32,
 * Database Pengukuran SQLite, dan Simulator ESP32 bawaan.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const MQTT_USER = process.env.MQTT_USER || 'nodered';
const MQTT_PASS = process.env.MQTT_PASS || 'PASSWORD_NODE_RED';
const DEFAULT_DEVICE_ID = process.env.DEFAULT_DEVICE_ID || 'device01';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Penyimpanan JSON / SQLite Fallback
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'health_records.json');
let db = {
  patients: [
    { patient_id: 'patient001', display_name: 'Pasien Demo 001', birth_year: 1998, created_at: new Date().toISOString() },
    { patient_id: 'patient002', display_name: 'Pasien Demo 002', birth_year: 2001, created_at: new Date().toISOString() }
  ],
  sessions: [],
  measurements: []
};

// Muat database jika sudah ada
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
    console.log('[+] Database lokal berhasil dimuat dari disk.');
  } catch (e) {
    console.warn('[!] Gagal membaca database, menggunakan inisialisasi awal:', e.message);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[!] Gagal menyimpan database:', e.message);
  }
}

// State Aktif Runtime
let activeSession = null; // { session_id, patient_id, device_id, started_at, status: 'authorized' }
let simulatorInterval = null;
let isSimulatorRunning = false;
let mqttClient = null;
let isMqttConnected = false;

// Broadcast ke semua klien WebSocket browser
function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
}

// Inisialisasi Koneksi MQTT
function initMqtt() {
  console.log(`[*] Menghubungkan ke MQTT Broker: ${MQTT_BROKER}...`);

  const options = {
    clientId: `health_dashboard_${Math.random().toString(16).substring(2, 8)}`,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 5000
  };

  if (MQTT_USER && MQTT_USER !== 'CHANGE_ME') {
    options.username = MQTT_USER;
    options.password = MQTT_PASS;
  }

  mqttClient = mqtt.connect(MQTT_BROKER, options);

  mqttClient.on('connect', () => {
    isMqttConnected = true;
    console.log('[+] Terhubung ke MQTT Broker Mosquitto!');
    broadcast('mqtt_status', { connected: true, message: `Terhubung (${MQTT_BROKER})` });

    // Subscribe ke telemetri dan status ESP32 sesuai health_monitor.ino
    mqttClient.subscribe('health/+/vitals', (err) => {
      if (!err) console.log('[+] Subscribed ke: health/+/vitals');
    });

    mqttClient.subscribe('health/+/status', (err) => {
      if (!err) console.log('[+] Subscribed ke: health/+/status');
    });
  });

  mqttClient.on('error', (err) => {
    console.warn('[!] MQTT Connection Warning/Error:', err.message);
    isMqttConnected = false;
    broadcast('mqtt_status', { connected: false, message: `Gagal: ${err.message}` });
  });

  mqttClient.on('offline', () => {
    isMqttConnected = false;
    broadcast('mqtt_status', { connected: false, message: 'Offline (Mencoba ulang...)' });
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const payloadStr = message.toString();
      const data = JSON.parse(payloadStr);

      if (topic.endsWith('/vitals')) {
        handleIncomingVitals(data);
      } else if (topic.endsWith('/status')) {
        handleIncomingStatus(data);
      }
    } catch (e) {
      console.error('[!] Error mem-parsing payload MQTT:', e.message);
    }
  });
}

// Validasi & Simpan Telemetri Vitals (Wajib sesuai aturan validasi)
function handleIncomingVitals(data) {
  // 1. Validasi struktur
  if (!data || !data.session_id || !data.device_id) {
    console.warn('[!] Paket vitals ditolak: session_id atau device_id kosong');
    return;
  }

  // 2. Validasi status sesi aktif di backend (tidak boleh menerima jika tidak authorized)
  if (!activeSession || activeSession.session_id !== data.session_id) {
    console.warn(`[!] Paket vitals ditolak: Sesi '${data.session_id}' tidak aktif atau tidak terotorisasi`);
    return;
  }

  // 3. Gunakan patient_id dari database sesi terdaftar (bukan mempercayai mentah payload)
  const patientId = activeSession.patient_id;

  const hrValid = Boolean(data.hr_valid && data.heart_rate_bpm > 0 && data.heart_rate_bpm < 250);
  const spo2Valid = Boolean(data.spo2_valid && data.spo2_percent >= 0 && data.spo2_percent <= 100);

  const measurement = {
    id: db.measurements.length + 1,
    session_id: data.session_id,
    patient_id: patientId,
    device_id: data.device_id,
    heart_rate_bpm: hrValid ? data.heart_rate_bpm : null,
    spo2_percent: spo2Valid ? data.spo2_percent : null,
    finger_detected: Boolean(data.finger_detected),
    hr_valid: hrValid,
    spo2_valid: spo2Valid,
    measured_at: new Date().toISOString()
  };

  // Simpan hanya jika jari terdeteksi atau ada data valid
  if (data.finger_detected) {
    db.measurements.push(measurement);
    saveDb();
  }

  // Siarkan ke dashboard frontend via WebSocket
  broadcast('vitals', measurement);
}

// Penanganan Status Perangkat ESP32
function handleIncomingStatus(data) {
  console.log(`[i] Status ESP32 [${data.device_id}]: ${data.status} - ${data.detail}`);
  broadcast('status', data);
}

// Kirim Otorisasi Sesi ke ESP32 via MQTT (health/device01/session)
function publishSessionCommand(deviceId, status, sessionId, patientId) {
  const topic = `health/${deviceId}/session`;
  let payload;

  if (status === 'authorized') {
    payload = JSON.stringify({
      status: 'authorized',
      session_id: sessionId,
      patient_id: patientId
    });
  } else {
    payload = JSON.stringify({ status: 'stop' });
  }

  if (mqttClient && isMqttConnected) {
    mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) console.error('[!] Gagal mempublikasikan sesi ke MQTT:', err);
      else console.log(`[+] Pesan sesi '${status}' terkirim ke topik: ${topic}`);
    });
  } else {
    console.log(`[i] [Simulator/Lokal] Pesan sesi '${status}' diproses secara internal.`);
  }
}

// Simulator Hardware ESP32 + MAX30102 Bawaan
function toggleSimulator(enable) {
  if (enable && !isSimulatorRunning) {
    isSimulatorRunning = true;
    console.log('[+] Simulator ESP32 MAX30102 DIAKTIFKAN');

    // Kirim status awal online
    broadcast('status', {
      device_id: DEFAULT_DEVICE_ID,
      status: activeSession ? 'ready_for_measurement' : 'online',
      detail: activeSession ? 'Session active; place finger on MAX30102' : 'Device connected; waiting for session authorization'
    });

    simulatorInterval = setInterval(() => {
      if (!activeSession) return;

      // Simulasi fluktuasi denyut nadi dan SpO2 realistis
      const hr = Math.floor(Math.random() * (84 - 72 + 1)) + 72;
      const spo2 = Math.floor(Math.random() * (99 - 96 + 1)) + 96;

      const simPacket = {
        device_id: activeSession.device_id || DEFAULT_DEVICE_ID,
        patient_id: activeSession.patient_id,
        session_id: activeSession.session_id,
        finger_detected: true,
        heart_rate_bpm: hr,
        spo2_percent: spo2,
        hr_valid: true,
        spo2_valid: true,
        timestamp_ms: Date.now()
      };

      handleIncomingVitals(simPacket);
    }, 3000);
  } else if (!enable && isSimulatorRunning) {
    isSimulatorRunning = false;
    clearInterval(simulatorInterval);
    simulatorInterval = null;
    console.log('[-] Simulator ESP32 DIMATIKAN');
  }

  broadcast('simulator_status', { enabled: isSimulatorRunning });
}

// REST API Endpoints

// 1. Daftar Pasien (Sesuai schema.sql)
app.get('/api/patients', (req, res) => {
  res.json({ success: true, patients: db.patients });
});

// 2. Status Sesi Aktif
app.get('/api/sessions/active', (req, res) => {
  res.json({ success: true, session: activeSession });
});

// 3. Mulai Sesi Baru (Authorize)
app.post('/api/sessions/start', (req, res) => {
  const { patient_id, device_id } = req.body;
  const targetDevice = device_id || DEFAULT_DEVICE_ID;

  // Verifikasi pasien ada di database
  const patient = db.patients.find(p => p.patient_id === patient_id);
  if (!patient) {
    return res.status(400).json({ success: false, error: 'Pasien tidak ditemukan di database' });
  }

  const sessionId = `session-${Date.now()}`;
  activeSession = {
    session_id: sessionId,
    patient_id: patient.patient_id,
    device_id: targetDevice,
    status: 'authorized',
    started_at: new Date().toISOString()
  };

  db.sessions.push(activeSession);
  saveDb();

  // Kirim perintah MQTT ke ESP32
  publishSessionCommand(targetDevice, 'authorized', sessionId, patient.patient_id);

  broadcast('session_update', activeSession);
  res.json({ success: true, session: activeSession });
});

// 4. Hentikan Sesi
app.post('/api/sessions/stop', (req, res) => {
  const { device_id } = req.body;
  const targetDevice = device_id || (activeSession ? activeSession.device_id : DEFAULT_DEVICE_ID);

  if (activeSession) {
    activeSession.status = 'completed';
    activeSession.ended_at = new Date().toISOString();
    saveDb();
  }

  publishSessionCommand(targetDevice, 'stop');

  const oldSession = activeSession;
  activeSession = null;

  broadcast('session_update', null);
  res.json({ success: true, message: 'Sesi dihentikan', previous_session: oldSession });
});

// 5. Riwayat Pengukuran
app.get('/api/measurements', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const list = db.measurements.slice(-limit).reverse();
  res.json({ success: true, count: list.length, measurements: list });
});

// 6. Kontrol Sakelar Simulator
app.post('/api/simulator/toggle', (req, res) => {
  const { enabled } = req.body;
  toggleSimulator(Boolean(enabled));
  res.json({ success: true, simulator_enabled: isSimulatorRunning });
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  // Kirim status awal ke browser yang baru tersambung
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      mqtt_connected: isMqttConnected,
      active_session: activeSession,
      simulator_enabled: isSimulatorRunning
    }
  }));
});

// Jalankan Server
server.listen(PORT, () => {
  console.log('================================================================');
  console.log(`[+] HealthGuard IoT Dashboard berjalan di http://localhost:${PORT}`);
  console.log(`[+] WebSocket Server aktif di ws://localhost:${PORT}/ws`);
  console.log('================================================================');
  initMqtt();
});
