const express = require('express')
const path = require('path')
const cors = require('cors')
const db = require('./db')
const { signToken, requireAuth, hashPassword, verifyPassword } = require('./auth')
const bcrypt = require('bcryptjs')
const multer = require('multer')
const fs = require('fs')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const publicDir = path.join(__dirname, '..', 'public')
const uploadsDir = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)
const reportsDir = path.join(uploadsDir, 'reports')
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir)
const licensesDir = path.join(uploadsDir, 'licenses')
if (!fs.existsSync(licensesDir)) fs.mkdirSync(licensesDir)

app.use('/uploads', (req, res, next) => {
  if (req.path.startsWith('/licenses/')) {
    return res.status(403).send('Access denied');
  }
  next();
}, express.static(uploadsDir));
app.use(express.static(publicDir))

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, reportsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext
    cb(null, name)
  }
})
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } })
const licenseStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, licensesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext
    cb(null, name)
  }
})
const uploadLicense = multer({ storage: licenseStorage, limits: { fileSize: 5 * 1024 * 1024 } })

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/debug/routes', (req, res) => {
  const out = []
  app._router.stack.forEach((m) => {
    if (m.route) {
      const methods = Object.keys(m.route.methods).filter(x=>m.route.methods[x])
      out.push({ path: m.route.path, methods })
    }
  })
  res.json(out)
})

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' })
  const role = 'customer'
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ error: 'Email already registered' })
  const hash = await hashPassword(password)
  const created_at = new Date().toISOString()
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run(name, email, hash, role, created_at)
  const user = { id: info.lastInsertRowid, name, email, role }
  res.json({ user, token: signToken(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body
  if (!email || !password || !role) return res.status(400).json({ error: 'Missing fields' })
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  if (user.role !== role) return res.status(403).json({ error: 'Role mismatch' })
  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token: signToken(user) })
})

app.post('/api/bootstrap', async (req, res) => {
  const count = db.prepare("SELECT COUNT(1) as c FROM users WHERE role='official'").get().c
  if (count > 0) return res.status(403).json({ error: 'Already initialized' })
  const { name, email, password } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' })
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ error: 'Email already exists' })
  const hash = await hashPassword(password)
  const created_at = new Date().toISOString()
  db.prepare('INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run(name, email, hash, 'official', created_at)
  res.json({ ok: true })
})

app.post('/api/admin/create-user', requireAuth('official'), async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' })
  if (!['official','dealer','customer'].includes(role)) return res.status(400).json({ error: 'Invalid role' })
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ error: 'Email already exists' })
  const hash = await hashPassword(password)
  const created_at = new Date().toISOString()
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run(name, email, hash, role, created_at)
  res.json({ id: info.lastInsertRowid })
})

async function handleDealerApply(req, res) {
  const { name, email, password, company } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' })
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existingUser) return res.status(409).json({ error: 'Email already registered' })
  const existingApp = db.prepare("SELECT id FROM dealer_applications WHERE email = ? AND status = 'pending'").get(email)
  if (existingApp) return res.status(409).json({ error: 'Application already pending' })
  const hash = await hashPassword(password)
  const created_at = new Date().toISOString()
  const license_path = req.file ? req.file.filename : null
  const info = db.prepare('INSERT INTO dealer_applications (name,email,password_hash,company,license_path,status,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(name, email, hash, company || null, license_path, 'pending', created_at)
  res.json({ application_id: info.lastInsertRowid })
}
app.post('/api/dealers/apply', uploadLicense.single('license'), handleDealerApply)
app.post('/api/dealers/apply/', uploadLicense.single('license'), handleDealerApply)
app.post('/api/dealer/apply', uploadLicense.single('license'), handleDealerApply)
console.log('Dealer apply route ready')

app.get('/api/dealers/applications', requireAuth('official'), (req, res) => {
  const status = req.query.status || 'pending'
  const rows = db.prepare('SELECT * FROM dealer_applications WHERE status = ? ORDER BY created_at DESC').all(status)
  res.json(rows)
})
console.log('Dealer applications routes ready')

app.patch('/api/dealers/applications/:id/status', requireAuth('official'), (req, res) => {
  const id = Number(req.params.id)
  const { status } = req.body
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  const appRow = db.prepare('SELECT * FROM dealer_applications WHERE id = ?').get(id)
  if (!appRow) return res.status(404).json({ error: 'Application not found' })
  if (status === 'approved') {
    const duplicate = db.prepare('SELECT id FROM users WHERE email = ?').get(appRow.email)
    if (duplicate) return res.status(409).json({ error: 'Email already registered' })
    const created_at = new Date().toISOString()
    db.prepare('INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
      .run(appRow.name, appRow.email, appRow.password_hash, 'dealer', created_at)
  }
  db.prepare('UPDATE dealer_applications SET status = ? WHERE id = ?').run(status, id)
  res.json({ ok: true })
})

app.post('/api/dealer/uploads', requireAuth('dealer'), (req, res) => {
  const { material, quantity, unit, location } = req.body
  if (!material || !quantity || !unit) return res.status(400).json({ error: 'Missing fields' })
  if (!allowedMaterials.includes(material)) return res.status(400).json({ error: 'Invalid material' })
  const created_at = new Date().toISOString()
  const qty = Number(quantity)
  const info = db.prepare('INSERT INTO uploads (dealer_id,material,quantity,unit,location,created_at,available_quantity) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, material, qty, unit, location || null, created_at, qty)
  res.json({ id: info.lastInsertRowid })
})

app.get('/api/dealer/uploads', requireAuth('dealer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM uploads WHERE dealer_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(rows)
})

app.get('/api/market/uploads', (req, res) => {
  const { material, location } = req.query
  let sql = 'SELECT u.*, users.name AS dealer_name FROM uploads u JOIN users ON u.dealer_id = users.id WHERE (u.available_quantity IS NULL OR u.available_quantity > 0)'
  const params = []
  if (material && allowedMaterials.includes(material)) { sql += ' AND u.material = ?'; params.push(material) }
  if (location) { sql += " AND LOWER(IFNULL(u.location, '')) LIKE LOWER(?)"; params.push('%' + location + '%') }
  sql += ' ORDER BY created_at DESC'
  const rows = db.prepare(sql).all(...params)
  res.json(rows)
})

app.post('/api/orders', requireAuth('customer'), (req, res) => {
  const { dealer_id, material, quantity, upload_id } = req.body
  if (!dealer_id || !material || !quantity || !upload_id) return res.status(400).json({ error: 'Missing fields' })
  if (!allowedMaterials.includes(material)) return res.status(400).json({ error: 'Invalid material' })
  const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(Number(upload_id))
  if (!upload) return res.status(404).json({ error: 'Upload not found' })
  if (upload.dealer_id !== Number(dealer_id)) return res.status(400).json({ error: 'Dealer mismatch' })
  const qty = Number(quantity)
  const available = upload.available_quantity ?? upload.quantity
  if (available < qty) return res.status(400).json({ error: 'Insufficient quantity' })
  const created_at = new Date().toISOString()
  const info = db.prepare('INSERT INTO orders (customer_id,dealer_id,material,quantity,status,created_at,upload_id) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, Number(dealer_id), material, qty, 'requested', created_at, Number(upload_id))
  db.prepare('UPDATE uploads SET available_quantity = COALESCE(available_quantity, quantity) - ? WHERE id = ?').run(qty, Number(upload_id))
  res.json({ id: info.lastInsertRowid })
})

app.get('/api/dealer/orders', requireAuth('dealer'), (req, res) => {
  const rows = db.prepare('SELECT o.*, u.name AS customer_name FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.dealer_id = ? ORDER BY o.created_at DESC').all(req.user.id)
  res.json(rows)
})

app.patch('/api/dealer/orders/:id/status', requireAuth('dealer'), (req, res) => {
  const id = Number(req.params.id)
  const { status } = req.body
  const allowed = ['accepted','rejected','completed','canceled']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND dealer_id = ?').get(id, req.user.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id)
  if (status === 'rejected' || status === 'canceled') {
    if (order.upload_id) {
      db.prepare('UPDATE uploads SET available_quantity = COALESCE(available_quantity, quantity) + ? WHERE id = ?').run(order.quantity, order.upload_id)
    }
  }
  res.json({ ok: true })
})

app.post('/api/reports', requireAuth('customer'), upload.single('photo'), (req, res) => {
  const { description, latitude, longitude, location } = req.body
  const photo_path = req.file ? ['uploads','reports',req.file.filename].join('/') : null
  const created_at = new Date().toISOString()
  const info = db.prepare('INSERT INTO reports (reporter_id,photo_path,description,latitude,longitude,location,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.user.id, photo_path, description || null, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null, location || null, 'pending', created_at)
  res.json({ id: info.lastInsertRowid })
})

app.get('/api/reports', requireAuth('official'), (req, res) => {
  const { location } = req.query
  let sql = 'SELECT r.*, u.name AS reporter_name FROM reports r JOIN users u ON r.reporter_id = u.id'
  const params = []
  if (location) { sql += " WHERE LOWER(IFNULL(r.location, '')) LIKE LOWER(?)"; params.push('%' + location + '%') }
  sql += ' ORDER BY created_at DESC'
  res.json(db.prepare(sql).all(...params))
})

app.patch('/api/reports/:id/status', requireAuth('official'), (req, res) => {
  const { status } = req.body
  if (!status) return res.status(400).json({ error: 'Missing status' })
  const valid = ['pending','reviewed','action_taken']
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  const id = Number(req.params.id)
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, id)
  res.json({ ok: true })
})

app.patch('/api/admin/users/:id', requireAuth('official'), async (req, res) => {
  const id = Number(req.params.id)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const { name, email, role, password } = req.body
  if (email) {
    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, id)
    if (dup) return res.status(409).json({ error: 'Email already in use' })
  }
  const updates = []
  const params = []
  if (name) { updates.push('name = ?'); params.push(name) }
  if (email) { updates.push('email = ?'); params.push(email) }
  if (role) {
    if (!['official','dealer','customer'].includes(role)) return res.status(400).json({ error: 'Invalid role' })
    updates.push('role = ?'); params.push(role)
  }
  if (password) {
    const hash = await hashPassword(password)
    updates.push('password_hash = ?'); params.push(hash)
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No changes provided' })
  params.push(id)
  const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  db.prepare(sql).run(...params)
  res.json({ ok: true })
})

app.patch('/api/me/password', requireAuth(), async (req, res) => {
  const { current_password, new_password } = req.body
  if (!current_password || !new_password) return res.status(400).json({ error: 'Missing fields' })
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  const ok = await verifyPassword(current_password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' })
  const hash = await hashPassword(new_password)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id)
  res.json({ ok: true })
})

app.patch('/api/me/email', requireAuth(), (req, res) => {
  const { current_password, new_email } = req.body
  if (!current_password || !new_email) return res.status(400).json({ error: 'Missing fields' })
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  bcrypt.compare(current_password, user.password_hash).then(ok => {
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' })
    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(new_email, req.user.id)
    if (dup) return res.status(409).json({ error: 'Email already in use' })
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(new_email, req.user.id)
    res.json({ ok: true })
  }).catch(() => res.status(500).json({ error: 'Error verifying password' }))
})

app.get('/api/admin/license/:filename', requireAuth('official'), (req, res) => {
  const filename = req.params.filename
  const filepath = path.join(licensesDir, filename)
  if (!filepath.startsWith(licensesDir)) return res.status(403).send('Invalid path')
  if (fs.existsSync(filepath)) {
    res.sendFile(filepath)
  } else {
    res.status(404).send('Not found')
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
const allowedMaterials = [
  'sand',
  'red_laterite_stone',
  'aggregate_stone',
  'red_soil',
  'crushed_aggregate_stone',
  'soil',
  'rock'
]
