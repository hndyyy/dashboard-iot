# Node-RED starter (tanpa RFID)

Import `flows.json` dari menu Node-RED. Buka konfigurasi broker Mosquitto dan pastikan username/password sesuai file password broker.

Flow ini hanya menerima `health/+/vitals`, memvalidasi bentuk dasar payload, lalu menampilkan data di Debug sidebar. Flow belum memvalidasi sesi melalui SQLite dan belum menyimpan pengukuran.

Untuk mengaktifkan sesi, backend/operator mengirim pesan ke `health/device01/session`, misalnya:

```json
{"status":"authorized","session_id":"session-demo-001","patient_id":"patient001"}
```

Untuk menghentikan sesi, kirim `{"status":"stop"}` ke topik yang sama. Pada implementasi sesungguhnya, hanya backend yang sudah memvalidasi pasien dan membuat record sesi boleh menerbitkan otorisasi. Jangan membuka hak publish topic session kepada klien umum.

Langkah selanjutnya: tambahkan node SQLite untuk memeriksa `sessions`, pastikan `session_id` aktif dan `device_id` cocok, ambil `patient_id` dari database, lalu insert data valid ke `measurements`. Dashboard dan riwayat belum termasuk dalam flow starter ini.
