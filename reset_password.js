const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

// Connect to the database
const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

async function resetPassword(email, newPassword) {
  try {
    console.log(`Resetting password for ${email}...`);
    
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    
    // Update the user in the database
    const info = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
      .run(hash, email);
      
    if (info.changes > 0) {
      console.log('Password successfully updated!');
    } else {
      console.log('User not found with that email.');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node reset_password.js <email> <new_password>');
  console.log('Example: node reset_password.js official@earthlink.local myNewPassword123');
  process.exit(1);
}

resetPassword(args[0], args[1]);
