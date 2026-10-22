# HealthGuard IoT — Dashboard Pemantauan Pasien ESP32 & MAX30102

Dashboard pemantau telemetri medis real-time yang terhubung langsung dengan firmware mikrokontroler ESP32 (`health_monitor.ino`) melalui broker MQTT (Mosquitto) dan WebSocket.

---

## 1. Fitur Utama

- **Otorisasi Sesi Pasien:**
  - Memilih pasien terdaftar dari database (`patient001`, `patient002`).
  - Menerbitkan otorisasi sesi ke topik MQTT `health/device01/session` (`authorized` / `stop`).
  - Menolak dan memvalidasi paket data yang tidak cocok dengan sesi aktif.
- **Telemetri Real-Time (MAX30102):**
  - Pembacaan **Heart Rate (BPM)** dengan indikator bradikardia/takikardia dan animasi detak jantung.
  - Pembacaan **Saturasi Oksigen (SpO2 %)** dengan status normal vs hipoksia.
  - Indikator deteksi jari (*Finger Detection*) visual.
- **Grafik Tren Real-Time:**
  - Grafik garis interaktif Chart.js dengan sinkronisasi ganda (BPM dan SpO2).
- **Integrasi Database:**
  - Riwayat pengukuran tersimpan secara persisten dan dapat diunduh dalam format **CSV**.
- **Simulator ESP32 Bawaan:**
  - Dilengkapi tombol sakelar simulator langsung di dashboard untuk menguji coba visualisasi data sensor tanpa memerlukan perangkat keras fisik.

---

## 2. Cara Menjalankan

### Langkah 1: Masuk ke folder dashboard
```bash
cd dashboard
```

### Langkah 2: Jalankan Server
```bash
node server.js
```

### Langkah 3: Buka Dashboard di Peramban
Buka URL:
```text
http://localhost:3000
```

---

## 3. Konfigurasi Variabel Lingkungan (Opsional)

Jika ingin menyesuaikan alamat broker MQTT atau port server, Anda dapat mengatur environment variables:

| Variabel | Default | Keterangan |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port HTTP & WebSocket dashboard |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Alamat broker MQTT Mosquitto |
| `MQTT_USER` | `nodered` | Username broker MQTT |
| `MQTT_PASS` | `PASSWORD_NODE_RED` | Password broker MQTT |
| `DEFAULT_DEVICE_ID`| `device01` | Device ID target ESP32 |

Contoh menjalankan dengan broker kustom:
```bash
MQTT_BROKER_URL=mqtt://192.168.1.100:1883 node server.js
```

---

## 4. Alur Kerja Pengujian dengan Simulator
1. Buka `http://localhost:3000`.
2. Aktifkan sakelar **"Simulator ESP32"** di pojok kanan atas.
3. Pilih pasien (misal: *Pasien Demo 001*), lalu klik tombol hijau **"Mulai Sesi (Otorisasi)"**.
4. Dashboard akan langsung menerima telemetri denyut jantung dan SpO2 secara real-time setiap 3 detik, grafik mulai bergerak, dan data masuk ke tabel riwayat pengukuran.
5. Klik **"Hentikan Sesi"** untuk menyelesaikan pemeriksaan.
