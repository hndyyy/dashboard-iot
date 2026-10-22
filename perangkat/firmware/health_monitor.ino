/*
  ESP32 + MAX30102 + MQTT (tanpa RFID)

  Alur:
  1. Backend/operator memilih pasien dan membuat session.
  2. Backend mengirim ke health/device01/session:
     {"status":"authorized","session_id":"session-demo-001","patient_id":"patient001"}
  3. ESP32 menunggu jari diletakkan pada MAX30102, lalu mengirim hasil ke /vitals.
  4. Untuk menghentikan sesi, kirim {"status":"stop"} ke topik /session.

  Catatan: hasil MAX30102 adalah pembacaan prototipe, bukan diagnosis medis.
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"

const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

const char* MQTT_HOST = "YOUR_MQTT_HOST_OR_LAN_IP";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "iot_device";
const char* MQTT_PASS = "CHANGE_ME";
const char* DEVICE_ID = "device01";

#define I2C_SDA 21
#define I2C_SCL 22

MAX30105 sensor;
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

String activeSession = "";
String activePatient = "";
bool measurementAuthorized = false;
bool sensorReady = false;
unsigned long lastPublishMs = 0;

static const int32_t N_SAMPLES = 100;
uint32_t irBuffer[N_SAMPLES];
uint32_t redBuffer[N_SAMPLES];
int32_t spo2 = 0, heartRate = 0;
int8_t spo2Valid = 0, hrValid = 0;

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
    publishStatus("ready_for_measurement", "Session active; place finger on MAX30102");
    Serial.printf("Session aktif: %s | pasien: %s\n", activeSession.c_str(), activePatient.c_str());
  } else if (strcmp(status, "stop") == 0 || strcmp(status, "denied") == 0) {
    measurementAuthorized = false;
    activeSession = "";
    activePatient = "";
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

bool readVitals() {
  for (int i = 0; i < N_SAMPLES; i++) {
    unsigned long started = millis();
    while (!sensor.available()) {
      sensor.check();
      mqtt.loop();
      if (millis() - started > 2000) return false;
      delay(1);
    }
    redBuffer[i] = sensor.getRed();
    irBuffer[i] = sensor.getIR();
    sensor.nextSample();
  }

  if (irBuffer[N_SAMPLES - 1] < 50000) {
    publishStatus("finger_not_detected", "Place finger over sensor");
    return false;
  }

  maxim_heart_rate_and_oxygen_saturation(
    irBuffer, N_SAMPLES, redBuffer,
    &spo2, &spo2Valid, &heartRate, &hrValid
  );
  return true;
}

void publishVitals() {
  if (!measurementAuthorized || !sensorReady || millis() - lastPublishMs < 5000) return;
  if (!readVitals()) return;
  lastPublishMs = millis();

  StaticJsonDocument<384> doc;
  doc["device_id"] = DEVICE_ID;
  doc["patient_id"] = activePatient;
  doc["session_id"] = activeSession;
  doc["finger_detected"] = true;
  doc["heart_rate_bpm"] = (hrValid && heartRate > 0 && heartRate < 250) ? heartRate : -1;
  doc["spo2_percent"] = (spo2Valid && spo2 >= 0 && spo2 <= 100) ? spo2 : -1;
  doc["hr_valid"] = (bool)hrValid;
  doc["spo2_valid"] = (bool)spo2Valid;
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
    sensor.setup(0x1F, 4, 2, 100, 411, 4096);
    sensor.setPulseAmplitudeRed(0x1F);
    sensor.setPulseAmplitudeIR(0x1F);
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
  publishVitals();
  delay(5);
}
