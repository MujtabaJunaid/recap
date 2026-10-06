#!/usr/bin/env node
/**
 * Creates (or resets) the one labelled demo account.
 *
 * This is an ordinary row in `users` with its own scrypt-hashed password, exactly like
 * every other account. It is NOT a master password: it opens one address and nothing
 * else, and it can be deleted or rotated without touching anyone.
 *
 * It exists so a reviewer can open the public link and get in without registering,
 * which the brief asks for.
 *
 *   DATABASE_URL=... node server/seed-demo-account.mjs '<password>'
 */
import { createUser, findUserByEmail, hashPassword, pool, migrate, close } from './db.js'

const EMAIL = process.env.DEMO_EMAIL || 'demo@recap.app'
const password = process.argv[2]

if (!password || password.length < 10) {
  console.error("Usage: node server/seed-demo-account.mjs '<password of 10+ characters>'")
  process.exit(1)
}

await migrate()

const existing = await findUserByEmail(EMAIL)
if (existing) {
  // Reset rather than refuse, so rotating the demo password is one command.
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    hashPassword(password),
    existing.id,
  ])
  console.log(`reset password for existing demo account ${EMAIL}`)
} else {
  const user = await createUser(EMAIL, 'Demo', password)
  console.log(user ? `created demo account ${EMAIL}` : `could not create ${EMAIL}`)
}

await close()
