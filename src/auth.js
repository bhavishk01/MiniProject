const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change'

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' })
}

function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      if (role && payload.role !== role) return res.status(403).json({ error: 'Forbidden' })
      req.user = payload
      next()
    } catch (e) {
      res.status(401).json({ error: 'Unauthorized' })
    }
  }
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

module.exports = { signToken, requireAuth, hashPassword, verifyPassword }

