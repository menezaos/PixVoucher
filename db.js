// db.js
const mysql = require("mysql2/promise");

console.info("[DB] Configurando pool de conexão com MariaDB...");
const db = mysql.createPool(process.env.DATABASE_URL);

module.exports = db;
