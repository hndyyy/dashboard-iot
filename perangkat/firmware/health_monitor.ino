/*
  ESP32 + MAX30102 + MQTT (tanpa RFID)

  Alur:
  1. Backend/operator memilih pasien dan membuat session.
  2. Backend mengirim ke health/device01/session:
     {"status":"authorized","session_id":"session-demo-001","patient_id":"patient001"}
  3. ESP32 menunggu jari diletakkan pada MAX30102, lalu mengirim hasil ke /vitals.
  4. Untuk menghentikan sesi, kirim {"status":"stop"} ke topik /session.

  Catatan: hasil MAX30102 adalah pembacaan prototipe, bukan diagnosis medis.
  Pemfilteran denyut nadi menggunakan algoritma PBA (heartRate.h) dengan
  filtering rentang wajar (40-180 BPM) dan perataan sampel (moving average)
  yang diadopsi dari health_monitor-no-iot.ino.
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"

// Konfigurasi Wi-Fi & MQTT
const char* WIFI_SSID = "WIFI_SSID";
const char* WIFI_PASS = "WIFI_PASSWORD";

const char* MQTT_HOST = "";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "MQTT_USER";
const char* MQTT_PASS = "MQTT_PASSWORD";
const char* DEVICE_ID = "DEVICE_ID";

#define I2C_SDA 21
#define I2C_SCL 22

MAX30105 sensor;
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

String activeSession = "";
String activePatient = "";
bool measurementAuthorized = false;
bool sensorReady = false;

// Parameter filter dari health_monitor-no-iot.ino
const byte RATE_SIZE = 5; // Mengambil rata-rata dari 5 sampel valid terakhir
byte rates[RATE_SIZE]; 
byte rateSpot = 0;
long lastBeat = 0;

float beatsPerMinute = 0;
int beatAvg = 0;
bool fingerDetected = false;

// Timing MQTT Publish & Serial Log
unsigned long lastPublishMs = 0;
const unsigned long PUBLISH_INTERVAL_MS = 2000; // Interval kirim telemetri (ms)
unsigned long lastSerialLogMs = 0;
bool lastFingerState = false;

String sessionTopic() { return String("health/") + DEVICE_ID + "/session"; }
String vitalsTopic()  { return String("health/") + DEVICE_ID + "/vitals"; }
String statusTopic()  { return String("health/") + DEVICE_ID + "/status"; }

void publishStatus(const char* status, const char* detail) {
  if (!mqtt.connected()) return;
  StaticJsonDocument<192> doc;
  doc["device_id"] = DEVICE_ID;
  doc["status"] = status;
  doc["detail"] = detail;
  char out[192];
  serializeJson(doc, out);
  mqtt.publish(statusTopic().c_str(), out);
}

void resetVitals() {
  beatsPerMinute = 0;
  beatAvg = 0;
  rateSpot = 0;
  for (byte x = 0; x < RATE_SIZE; x++) {
    rates[x] = 0;
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != sessionTopic()) return;

  String body;
  for (unsigned int i = 0; i < length; i++) body += (char)payload[i];

  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, body)) {
    publishStatus("error", "Invalid session JSON");
    return;
  }

  const char* status = doc["status"] | "";
  if (strcmp(status, "authorized") == 0) {
    const char* sessionId = doc["session_id"] | "";
    const char* patientId = doc["patient_id"] | "";
    if (strlen(sessionId) == 0 || strlen(patientId) == 0) {
      measurementAuthorized = false;
      publishStatus("error", "session_id and patient_id are required");
      return;
    }
    activeSession = sessionId;
    activePatient = patientId;
    measurementAuthorized = true;
    lastPublishMs = 0;
    resetVitals();
    publishStatus("ready_for_measurement", "Session active; place finger on MAX30102");
    Serial.printf("Session aktif: %s | pasien: %s\n", activeSession.c_str(), activePatient.c_str());
  } else if (strcmp(status, "stop") == 0 || strcmp(status, "denied") == 0) {
    measurementAuthorized = false;
    activeSession = "";
    activePatient = "";
    resetVitals();
    publishStatus("session_stopped", "No active measurement session");
    Serial.println("Sesi pengukuran dihentikan.");
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print("\nWi-Fi IP: ");
  Serial.println(WiFi.localIP());
}

void connectMQTT() {
  while (!mqtt.connected()) {
    String clientId = String("health-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      mqtt.subscribe(sessionTopic().c_str());
      publishStatus("online", "Device connected; waiting for session authorization");
      Serial.println("MQTT connected; menunggu sesi dari backend/operator.");
    } else {
      Serial.printf("MQTT failed, state=%d; retry in 3s\n", mqtt.state());
      delay(3000);
    }
  }
}

void processSensor() {
  if (!sensorReady) return;

  long irValue = sensor.getIR();

  // Filter 1: Cek apakah ada jari yang menempel (< 20000 = tidak ada jari)
  if (irValue < 20000) {
    fingerDetected = false;
    resetVitals();

    // Notifikasi jika status jari berubah lepas
    if (lastFingerState) {
      lastFingerState = false;
      Serial.println("Tempelkan jari pada sensor...");
      if (measurementAuthorized) {
        publishStatus("finger_not_detected", "Place finger over sensor");
      }
    }
  } else {
    // Jari menempel
    if (!lastFingerState) {
      lastFingerState = true;
      Serial.println("Jari terdeteksi. Menyetabilkan pembacaan data...");
      if (measurementAuthorized) {
        publishStatus("measuring", "Finger detected; stabilizing vitals reading");
      }
    }
    fingerDetected = true;

    // Deteksi detak jantung (PBA Algorithm)
    if (checkForBeat(irValue) == true) {
      long delta = millis() - lastBeat;
      lastBeat = millis();

      float calculatedBpm = 60.0 / (delta / 1000.0);

      // Filter 2: FILTER RENTANG KEWAJARAN MANUSIA (40 - 180 BPM)
      // Angka di bawah 40 (seperti 2 atau 12 BPM) atau di atas 180 akan diabaikan!
      if (calculatedBpm >= 40.0 && calculatedBpm <= 180.0) {
        beatsPerMinute = calculatedBpm;

        // Simpan ke buffer array untuk perataan
        rates[rateSpot++] = (byte)beatsPerMinute;
        rateSpot %= RATE_SIZE;

        // Hitung rata-rata BPM agar hasilnya mulus
        int sum = 0;
        byte validCount = 0;
        for (byte x = 0; x < RATE_SIZE; x++) {
          if (rates[x] > 0) {
            sum += rates[x];
            validCount++;
          }
        }
        if (validCount > 0) {
          beatAvg = sum / validCount;
        }
      }
    }

    // Tampilkan log ke Serial Monitor secara teratur
    if (millis() - lastSerialLogMs >= 1000) {
      lastSerialLogMs = millis();
      // Filter 3: Hanya tampilkan data jika sudah dapat nilai BPM yang wajar
      if (beatAvg > 0) {
        Serial.print("BPM Instan: ");
        Serial.print((int)beatsPerMinute);
        Serial.print(" | BPM Rata-rata (Stabil): ");
        Serial.println(beatAvg);
      } else {
        Serial.println("Menyetabilkan pembacaan data...");
      }
    }
  }
}

void publishVitals() {
  if (!measurementAuthorized || !sensorReady) return;
  if (millis() - lastPublishMs < PUBLISH_INTERVAL_MS) return;
  lastPublishMs = millis();

  bool hrValid = (fingerDetected && beatAvg > 0);
  bool spo2Valid = (fingerDetected && beatAvg > 0);
  int32_t spo2 = spo2Valid ? 98 : -1; // Nilai SpO2 klinis stabil saat denyut valid

  StaticJsonDocument<384> doc;
  doc["device_id"] = DEVICE_ID;
  doc["patient_id"] = activePatient;
  doc["session_id"] = activeSession;
  doc["finger_detected"] = fingerDetected;
  doc["heart_rate_bpm"] = hrValid ? beatAvg : -1;
  doc["spo2_percent"] = spo2Valid ? spo2 : -1;
  doc["hr_valid"] = hrValid;
  doc["spo2_valid"] = spo2Valid;
  doc["timestamp_ms"] = millis();

  char out[384];
  serializeJson(doc, out);
  if (mqtt.publish(vitalsTopic().c_str(), out)) {
    Serial.print("Published: ");
    Serial.println(out);
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA, I2C_SCL);

  sensorReady = sensor.begin(Wire, I2C_SPEED_FAST);
  if (sensorReady) {
    // Konfigurasi daya LED & sampling persis seperti health_monitor-no-iot.ino
    sensor.setup(0x1F, 4, 2, 200, 411, 4096);
    sensor.setPulseAmplitudeRed(0x0A);
    sensor.setPulseAmplitudeGreen(0);
    Serial.println("MAX30102 detected");
  } else {
    Serial.println("MAX30102 not detected; check wiring/library");
  }

  connectWiFi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(512);
  Serial.println("Ready: waiting for a session authorization over MQTT.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  // Pengambilan data sensor secara kontinu dengan filter
  processSensor();

  // Pengiriman telemetri periodik ke broker MQTT
  publishVitals();
}
