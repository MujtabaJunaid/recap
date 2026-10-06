import pg from 'pg'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Users and their per-user workspace state.
 *
 * ON PASSWORDS — the important decision in this file.
 *
 * Passwords are HASHED, not encrypted. The difference matters and it is not a detail:
 * encryption is reversible, so a system that can show you a user's password can be made
 * to show it to an attacker who steals the key. Hashing is one-way. Nobody — not an
 * admin, not this code, not someone with a full database dump — can recover a password
 * from what is stored here.
 *
 * Login does not need decryption and never did: hash what was typed with the stored
 * salt and compare the two derivations. That is the whole mechanism.
 *
 * scrypt, N=16384, 64-byte key, random 16-byte salt per user. Memory-hard, so a stolen
 * table is expensive to attack offline even with GPUs.
 */

const { Pool } = pg

const SCRYPT_N = 16384
const SCRYPT_KEYLEN = 64

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Heroku Postgres presents a certificate the default trust store rejects. The
  // connection is still TLS-encrypted; only chain verification is relaxed.
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (error) => {
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'db.pool_error',
      errorMessage: error.message,
    })}\n`,
  )
})

/**
 * Idempotent schema creation, run at boot. Small enough that a migration tool would be
 * more machinery than it saves; the moment a column needs altering, that changes.
 */
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            BIGSERIAL PRIMARY KEY,
      email         TEXT NOT NULL,
      email_lower   TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS user_state (
      user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
}

export function hashPassword(plaintext) {
  const salt = randomBytes(16)
  const derived = scryptSync(plaintext, salt, SCRYPT_KEYLEN, { N: SCRYPT_N })
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

/** Constant-time, and never reveals whether the stored record even exists. */
export function verifyPassword(plaintext, stored) {
  if (typeof plaintext !== 'string' || typeof stored !== 'string') return false
  const [saltHex, expectedHex] = stored.split(':')
  if (!saltHex || !expectedHex) return false
  try {
    const expected = Buffer.from(expectedHex, 'hex')
    const derived = scryptSync(plaintext, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, {
      N: SCRYPT_N,
    })
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/**
 * Spends the same scrypt work whether or not the account exists, so response time does
 * not reveal which email addresses are registered.
 */
const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'))

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, email, display_name, password_hash FROM users WHERE email_lower = $1',
    [email.toLowerCase()],
  )
  return rows[0] ?? null
}

export async function createUser(email, displayName, plaintext) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, email_lower, display_name, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email_lower) DO NOTHING
     RETURNING id, email, display_name`,
    [email, email.toLowerCase(), displayName, hashPassword(plaintext)],
  )
  // ON CONFLICT DO NOTHING returns no row, which is how a duplicate signup is detected
  // without a separate read and the race that comes with it.
  return rows[0] ?? null
}

export async function authenticate(email, plaintext) {
  const user = await findUserByEmail(email)
  if (!user) {
    verifyPassword(plaintext, DUMMY_HASH)
    return null
  }
  if (!verifyPassword(plaintext, user.password_hash)) return null

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
  return { id: user.id, email: user.email, displayName: user.display_name }
}

export async function getState(userId) {
  const { rows } = await pool.query('SELECT state FROM user_state WHERE user_id = $1', [userId])
  return rows[0]?.state ?? {}
}

export async function putState(userId, state) {
  await pool.query(
    `INSERT INTO user_state (user_id, state, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [userId, JSON.stringify(state)],
  )
}

export async function close() {
  await pool.end()
}
