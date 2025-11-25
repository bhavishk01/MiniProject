const Database = require('better-sqlite3')
const path = require('path')

const db = new Database(path.join(__dirname, '..', 'data.db'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('official','dealer','customer')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL,
  material TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  location TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(dealer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  photo_path TEXT,
  description TEXT,
  latitude REAL,
  longitude REAL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY(reporter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  dealer_id INTEGER NOT NULL,
  material TEXT NOT NULL,
  quantity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TEXT NOT NULL,
  FOREIGN KEY(customer_id) REFERENCES users(id),
  FOREIGN KEY(dealer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dealer_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  company TEXT,
  license_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`)

try {
  const uploadCols = db.prepare("PRAGMA table_info(uploads)").all()
  if (!uploadCols.find(c => c.name === 'available_quantity')) {
    db.exec('ALTER TABLE uploads ADD COLUMN available_quantity REAL')
    db.exec('UPDATE uploads SET available_quantity = quantity WHERE available_quantity IS NULL')
  }
} catch {}

try {
  const orderCols = db.prepare("PRAGMA table_info(orders)").all()
  if (!orderCols.find(c => c.name === 'upload_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN upload_id INTEGER')
  }
} catch {}

// migrate uploads table if legacy CHECK constraint blocks new materials
try {
  db.prepare("INSERT INTO uploads (dealer_id, material, quantity, unit, location, created_at) VALUES (0, ?, 0, 'unit', 'tmp', ?)")
    .run('__test_material__', new Date().toISOString())
  db.prepare("DELETE FROM uploads WHERE dealer_id = 0 AND material = ?").run('__test_material__')
} catch (e) {
  db.exec('BEGIN')
  db.exec('PRAGMA foreign_keys=off')
  db.exec(`
    CREATE TABLE uploads_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      material TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      location TEXT,
      created_at TEXT NOT NULL,
      available_quantity REAL,
      FOREIGN KEY(dealer_id) REFERENCES users(id)
    );
    INSERT INTO uploads_new (id,dealer_id,material,quantity,unit,location,created_at,available_quantity)
      SELECT id,dealer_id,material,quantity,unit,location,created_at,available_quantity FROM uploads;
    DROP TABLE uploads;
    ALTER TABLE uploads_new RENAME TO uploads;
  `)
  db.exec('PRAGMA foreign_keys=on')
  db.exec('COMMIT')
}

// migrate orders table to remove legacy CHECK constraint
try {
  db.prepare("INSERT INTO orders (customer_id, dealer_id, material, quantity, status, created_at) VALUES (0, 0, ?, 0, 'requested', ?)")
    .run('__test_material__', new Date().toISOString())
  db.prepare("DELETE FROM orders WHERE customer_id = 0 AND dealer_id = 0 AND material = ?").run('__test_material__')
} catch (e) {
  const hasUploadId = db.prepare("PRAGMA table_info(orders)").all().find(c => c.name === 'upload_id')
  db.exec('BEGIN')
  db.exec('PRAGMA foreign_keys=off')
  db.exec(`
    CREATE TABLE orders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      dealer_id INTEGER NOT NULL,
      material TEXT NOT NULL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      created_at TEXT NOT NULL,
      upload_id INTEGER,
      FOREIGN KEY(customer_id) REFERENCES users(id),
      FOREIGN KEY(dealer_id) REFERENCES users(id)
    );
    INSERT INTO orders_new (id,customer_id,dealer_id,material,quantity,status,created_at,upload_id)
      SELECT id,customer_id,dealer_id,material,quantity,status,created_at,${hasUploadId ? 'upload_id' : 'NULL'} FROM orders;
    DROP TABLE orders;
    ALTER TABLE orders_new RENAME TO orders;
  `)
  db.exec('PRAGMA foreign_keys=on')
  db.exec('COMMIT')
}

module.exports = db

