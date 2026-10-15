-- Seed Data for MAA Situation Room
USE masupport;

-- Insert 20 LGAs of Bauchi State
INSERT INTO lgas (name, code, latitude, longitude) VALUES
('Alkaleri', 'ALW', 10.2667, 10.3333),
('Bauchi', 'BAU', 10.3158, 9.8442),
('Bogoro', 'BGR', 9.6833, 9.6000),
('Damban', 'DBN', 11.4583, 10.7500),
('Darazo', 'DRZ', 10.9944, 10.4136),
('Dass', 'DSS', 10.0333, 9.5167),
('Gamawa', 'GMW', 12.1333, 10.5333),
('Ganjuwa', 'GNJ', 10.6333, 9.8333),
('Giade', 'GDE', 11.4167, 10.2000),
('Itas/Gadau', 'ITG', 11.9667, 10.0333),
('Jama\'are', 'JMR', 11.6333, 9.9333),
('Katagum', 'KTG', 11.7000, 10.2833),
('Kirfi', 'KRF', 10.4000, 10.6833),
('Misau', 'MSU', 11.3144, 10.4656),
('Ningi', 'NNG', 11.0833, 9.5667),
('Shira', 'SHR', 11.5333, 10.0500),
('Tafawa Balewa', 'TFB', 9.7500, 9.5500),
('Toro', 'TOR', 10.0500, 9.0667),
('Warji', 'WRJ', 11.2167, 9.8167),
('Zaki', 'ZAK', 12.2333, 10.3167);

-- Insert Sample Wards for Bauchi, Toro, Katagum, and Misau
INSERT INTO wards (lga_id, name) VALUES
-- Bauchi LGA Wards (lga_id = 2)
(2, 'Majidadi A'),
(2, 'Majidadi B'),
(2, 'Makama A'),
(2, 'Makama B'),
(2, 'Dankade'),
(2, 'Hardo'),
-- Katagum LGA Wards (lga_id = 12)
(12, 'Azare Madangala'),
(12, 'Azare Bulutu'),
(12, 'Chinade'),
-- Toro LGA Wards (lga_id = 18)
(18, 'Toro Ward'),
(18, 'Tilden Fulani'),
(18, 'Lame'),
-- Misau LGA Wards (lga_id = 14)
(14, 'Misau Town'),
(14, 'Gwaram'),
(14, 'Hardawa');

-- Insert Sample Polling Units
INSERT INTO polling_units (ward_id, name, code, total_voters) VALUES
-- Majidadi A Polling Units
(1, 'Kofar Fada PU 001', '02/02/01/001', 520),
(1, 'Central Primary School PU 002', '02/02/01/002', 450),
-- Majidadi B Polling Units
(2, 'Kofar Dumi PU 001', '02/02/02/001', 600),
-- Makama A Polling Units
(3, 'Jahun Primary School PU 001', '02/02/03/001', 750),
(3, 'Wunti Market PU 002', '02/02/03/002', 480),
-- Azare Madangala Polling Units
(7, 'Azare Post Office PU 001', '12/12/01/001', 650),
(7, 'Low Cost Primary School PU 002', '12/12/01/002', 500),
-- Tilden Fulani Polling Units
(11, 'Tilde Town Hall PU 001', '18/18/02/001', 400),
(11, 'Market Square PU 002', '18/18/02/002', 380);

-- Insert Super Admin (the only pre-seeded user)
-- Email: admin@apmsupport.com | Password: Admin@2026
INSERT INTO users (email, password, fullname, phone, role, status) VALUES
('admin@apmsupport.com', '$2a$10$VNj.hvYM/t6xqk1BwYvVV.LB4hipqaHSPdrmb7rczpxohW/pAYo9a', 'System Administrator', '08031234567', 'SUPER_ADMIN', 'ACTIVE');
