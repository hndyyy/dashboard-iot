# IoT Health Monitoring Starter — tanpa RFID

Prototipe ESP32 + MAX30102 + Mosquitto + Node-RED + SQLite. Identitas pasien dipilih oleh aplikasi/operator/backend, lalu backend mengirim otorisasi sesi ke ESP32 melalui MQTT. Firmware tidak memakai RC522 atau pembacaan kartu.

## Alur
1. Operator memilih pasien dari aplikasi/backend.
2. Backend membuat record sesi di tabel `sessions` dan menerbitkan pesan otorisasi ke `health/device01/session`.
3. ESP32 menerima sesi aktif dan menunggu jari diletakkan pada MAX30102.
4. ESP32 mengirim data ke `health/device01/vitals` dengan `session_id` dan `patient_id`.
5. Backend wajib memvalidasi sesi terhadap database sebelum menyimpan hasil dan menampilkan riwayat.

> Catatan: flow Node-RED yang disertakan masih berupa starter/debug. Validasi sesi dan penyimpanan SQLite belum diimplementasikan. Jangan menganggap data sudah tersimpan hanya karena terlihat di Debug sidebar.

## 1. Stack
- Mosquitto: MQTT broker pada port 1883 untuk pengembangan lokal saja
- Node-RED: http://localhost:1880
- Database: SQLite, skema di `schema.sql`
- Firmware: `firmware/health_monitor.ino`

## 2. Buat kredensial Mosquitto
Jalankan dari direktori proyek:

```bash
docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -c /mosquitto/config/passwords iot_device

docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd /mosquitto/config/passwords nodered

docker compose up -d
docker compose logs -f
```

## 3. Database
Jalankan `schema.sql` pada database SQLite yang digunakan Node-RED. File ini membuat tabel `patients`, `sessions`, dan `measurements`, dengan dua pasien demo. Data pasien demo bukan data nyata.

## 4. Library Arduino IDE
Install:
- PubSubClient
- ArduinoJson
- SparkFun MAX3010x Pulse and Proximity Sensor Library

Header `spo2_algorithm.h` dan implementasinya juga harus tersedia dari implementasi algoritme yang cocok. Pastikan sumber/library dan versinya konsisten.

## 5. Wiring ESP32 DevKit V1 — MAX30102 saja
- SDA -> GPIO 21
- SCL -> GPIO 22
- VIN/VCC -> 3V3 jika sesuai spesifikasi breakout
- GND -> GND

RC522 tidak digunakan dan tidak perlu dipasang.

## 6. Konfigurasi firmware
Ubah `MQTT_HOST`, `MQTT_USER`, dan `MQTT_PASS` sesuai broker. `Wokwi-GUEST` adalah konfigurasi Wi-Fi untuk simulasi Wokwi; ganti SSID/password jika memakai Wi-Fi lokal. `localhost` tidak bisa dipakai sebagai alamat broker dari ESP32, karena akan menunjuk ke perangkat ESP32 itu sendiri.

## 7. Mulai/hentikan sesi melalui MQTT
Setelah backend/operator memilih pasien, backend perlu memvalidasi pasien dan membuat sesi di database. Untuk uji coba lokal, contoh pesan start:

```json
{"status":"authorized","session_id":"session-demo-001","patient_id":"patient001"}
```

Kirim ke topik `health/device01/session` menggunakan MQTT client yang terautentikasi. Untuk menghentikan sesi, kirim:

```json
{"status":"stop"}
```

ke topik yang sama. Contoh CLI (sesuaikan host dan kredensial):

```bash
mosquitto_pub -h localhost -p 1883 -u nodered -P 'PASSWORD_NODE_RED' \
  -t health/device01/session \
  -m '{"status":"authorized","session_id":"session-demo-001","patient_id":"patient001"}'
```

Contoh tersebut hanya untuk pengujian. Pada aplikasi sebenarnya, pesan `authorized` harus diterbitkan backend setelah memeriksa pasien dan membuat sesi di database. Jangan mengizinkan pengguna MQTT biasa membuat sesi sembarangan.

## 8. MQTT topics
- `health/device01/session` — backend/operator mengaktifkan atau menghentikan sesi
- `health/device01/vitals` — ESP32 menerbitkan hasil sensor
- `health/device01/status` — status perangkat dan sensor

## 9. Validasi dan penyimpanan wajib
Sebelum produksi, implementasikan di backend:
1. Validasi `session_id` dan status sesi pada database.
2. Pastikan `device_id` cocok dengan perangkat yang diberi izin.
3. Ambil `patient_id` dari record sesi di database, bukan mempercayai `patient_id` dalam payload ESP32.
4. Simpan pengukuran ke `measurements` dan tampilkan dashboard/riwayat hanya setelah validasi berhasil.
5. Terapkan batas waktu sesi, autentikasi, ACL topic, TLS/MQTTS, dan firewall.

## 10. Privasi dan keselamatan
- Pembacaan MAX30102 merupakan prototipe dan bukan diagnosis medis.
- Gunakan data pasien dummy saat pengujian.
- Jangan mengirim NIK, nama lengkap, alamat, atau data identitas sensitif melalui MQTT.
- Jangan membuka Node-RED editor atau broker MQTT tanpa autentikasi ke internet.
