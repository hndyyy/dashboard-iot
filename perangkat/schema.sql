PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  patient_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  birth_year INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('authorized','completed','cancelled','expired')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  heart_rate_bpm INTEGER,
  spo2_percent INTEGER,
  finger_detected INTEGER NOT NULL DEFAULT 0,
  hr_valid INTEGER NOT NULL DEFAULT 0,
  spo2_valid INTEGER NOT NULL DEFAULT 0,
  measured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO patients(patient_id, display_name, birth_year)
VALUES ('patient001', 'Pasien Demo 001', 1998),
       ('patient002', 'Pasien Demo 002', 2001);
