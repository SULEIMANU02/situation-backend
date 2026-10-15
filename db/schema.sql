-- APM Situation Room Database Schema
-- Designed for Hon. Yakubu Adamu PhD (Bauchi APM Governorship Campaign)

CREATE DATABASE IF NOT EXISTS masupport;
USE masupport;

-- LGAs of Bauchi State
CREATE TABLE IF NOT EXISTS lgas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(10) NOT NULL UNIQUE,
    latitude DECIMAL(9,6) DEFAULT NULL,
    longitude DECIMAL(9,6) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wards within LGAs
CREATE TABLE IF NOT EXISTS wards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lga_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    FOREIGN KEY (lga_id) REFERENCES lgas(id) ON DELETE CASCADE,
    UNIQUE KEY unique_lga_ward (lga_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Polling Units within Wards
CREATE TABLE IF NOT EXISTS polling_units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ward_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    total_voters INT DEFAULT 0,
    FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users (Super Admin, LGA Coordinators, Ward Coordinators, Polling Agents)
-- Login via email + password. Hierarchical onboarding tracked via created_by.
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    fullname VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    role ENUM('SUPER_ADMIN', 'LGA_COORDINATOR', 'WARD_COORDINATOR', 'POLLING_AGENT') NOT NULL,
    lga_id INT DEFAULT NULL,
    ward_id INT DEFAULT NULL,
    polling_unit_id INT DEFAULT NULL,
    created_by INT DEFAULT NULL,
    status ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lga_id) REFERENCES lgas(id) ON DELETE SET NULL,
    FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE SET NULL,
    FOREIGN KEY (polling_unit_id) REFERENCES polling_units(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Election Incident Reports
CREATE TABLE IF NOT EXISTS incidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category ENUM('VOTE_BUYING', 'VIOLENCE', 'EQUIPMENT_FAILURE', 'DELAY', 'OPPONENT_ACTIVITY', 'OTHER') NOT NULL,
    lga_id INT NOT NULL,
    ward_id INT DEFAULT NULL,
    polling_unit_id INT DEFAULT NULL,
    reported_by INT NOT NULL,
    image_url VARCHAR(255) DEFAULT NULL,
    status ENUM('PENDING', 'VERIFIED', 'RESOLVED', 'REJECTED') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lga_id) REFERENCES lgas(id) ON DELETE CASCADE,
    FOREIGN KEY (ward_id) REFERENCES wards(id) ON DELETE SET NULL,
    FOREIGN KEY (polling_unit_id) REFERENCES polling_units(id) ON DELETE SET NULL,
    FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Election Results submissions
CREATE TABLE IF NOT EXISTS election_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    polling_unit_id INT NOT NULL UNIQUE,
    apm_votes INT DEFAULT 0,
    apc_votes INT DEFAULT 0,
    pdp_votes INT DEFAULT 0,
    prp_votes INT DEFAULT 0,
    adc_votes INT DEFAULT 0,
    invalid_votes INT DEFAULT 0,
    total_votes INT DEFAULT 0,
    result_sheet_url VARCHAR(255) DEFAULT NULL,
    submitted_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (polling_unit_id) REFERENCES polling_units(id) ON DELETE CASCADE,
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Campaign activities reports
CREATE TABLE IF NOT EXISTS campaign_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    activity_type ENUM('RALLY', 'TOWN_HALL', 'DOOR_TO_DOOR', 'MEDIA_APPEARANCE', 'OTHER') NOT NULL,
    lga_id INT NOT NULL,
    attendee_count INT DEFAULT 0,
    sentiment ENUM('POSITIVE', 'NEUTRAL', 'NEGATIVE') DEFAULT 'NEUTRAL',
    reported_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lga_id) REFERENCES lgas(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
