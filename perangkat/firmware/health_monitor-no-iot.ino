#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"

MAX30105 particleSensor;

const byte RATE_SIZE = 5; // Mengambil rata-rata dari 5 sampel valid terakhir
byte rates[RATE_SIZE]; 
byte rateSpot = 0;
long lastBeat = 0;

float beatsPerMinute = 0;
int beatAvg = 0;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);

  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 tidak ditemukan. Cek kabel!");
    while (1);
  }

  // Konfigurasi daya LED
  particleSensor.setup(0x1F, 4, 2, 200, 411, 4096); 
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);
}

void loop() {
  long irValue = particleSensor.getIR();

  // Filter 1: Cek apakah ada jari yang menempel
  if (irValue < 20000) {
    Serial.println("Tempelkan jari pada sensor...");
    beatsPerMinute = 0;
    beatAvg = 0;
  } else {
    // Deteksi detak jantung
    if (checkForBeat(irValue) == true) {
      long delta = millis() - lastBeat;
      lastBeat = millis();

      float calculatedBpm = 60 / (delta / 1000.0);

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

    // Hanya tampilkan data jika sudah dapat nilai BPM yang wajar
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