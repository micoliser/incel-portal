DROP DATABASE IF EXISTS incel_portal_db;
DROP USER IF EXISTS 'incel_portal_user'@'localhost';
CREATE DATABASE IF NOT EXISTS incel_portal_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'incel_portal_user'@'localhost' IDENTIFIED BY 'incel_portal_password';
GRANT ALL PRIVILEGES ON incel_portal_db.* TO 'incel_portal_user'@'localhost';
FLUSH PRIVILEGES;