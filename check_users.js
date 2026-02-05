const db = require('./src/db');
const users = db.prepare("SELECT id, name, email, role, password_hash FROM users WHERE role = 'official'").all();
console.log(JSON.stringify(users, null, 2));
