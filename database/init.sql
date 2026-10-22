-- HealthGuard IoT - Database Schema for MariaDB / MySQL
CREATE DATABASE IF NOT EXISTS healthguard;
USE healthguard;

-- 1. Tabel Pasien (Sesuai schema.sql)
CREATE TABLE IF NOT EXISTS patients (
  patient_id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(128) NOT NULL,
  birth_year INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tabel Sesi Otorisasi Perangkat & Pasien
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  patient_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  status ENUM('authorized','completed','cancelled','expired') NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Tabel Riwayat Pengukuran MAX30102
CREATE TABLE IF NOT EXISTS measurements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  patient_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  heart_rate_bpm INT NULL,
  spo2_percent INT NULL,
  finger_detected TINYINT(1) NOT NULL DEFAULT 0,
  hr_valid TINYINT(1) NOT NULL DEFAULT 0,
  spo2_valid TINYINT(1) NOT NULL DEFAULT 0,
  measured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Inisialisasi Data Pasien Demo
INSERT INTO patients (patient_id, display_name, birth_year)
VALUES 
  ('patient001', 'Pasien Demo 001', 1998),
  ('patient002', 'Pasien Demo 002', 2001)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);
