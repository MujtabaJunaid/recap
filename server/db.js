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
 * Idempotent schema creation, run at boot.
 *
 * `CREATE TABLE IF NOT EXISTS` is not atomic against a concurrent identical create:
 * both sessions see no table, both proceed, and one fails with 23505 on
 * `pg_type_typname_nsp_index`. That is not hypothetical — it happens whenever two
 * dynos boot together, and it is how this was found.
 *
 * A session-level advisory lock serialises it. The lock id is arbitrary but must be
 * stable across processes.
 */
const MIGRATION_LOCK_ID = 8372019

export async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await runMigration(client)
  } finally {
    // Release before returning the connection, or the next borrower inherits the lock.
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {})
    client.release()
  }
}

async function runMigration(client) {
  try {
    await client.query(`
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

    -- Audio lives in the row rather than object storage. For recordings of this
    -- length that is simpler and has no second set of credentials to leak; past a few
    -- hundred MB it should move to S3 or R2 and keep only the key here.
    CREATE TABLE IF NOT EXISTS recordings (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT 'Untitled recording',
      mime        TEXT NOT NULL,
      bytes       INTEGER NOT NULL,
      duration_s  REAL NOT NULL DEFAULT 0,
      audio       BYTEA NOT NULL,
      transcript  JSONB NOT NULL DEFAULT '[]'::jsonb,
      status      TEXT NOT NULL DEFAULT 'processing',
      error       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS recordings_user_created
      ON recordings (user_id, created_at DESC);

    -- A finished call: its transcript plus the summary generated from it.
    CREATE TABLE IF NOT EXISTS meetings (
      id           BIGSERIAL PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      platform     TEXT NOT NULL DEFAULT 'mock',
      source       TEXT NOT NULL DEFAULT 'simulated',
      duration_s   REAL NOT NULL DEFAULT 0,
      participants JSONB NOT NULL DEFAULT '[]'::jsonb,
      transcript   JSONB NOT NULL DEFAULT '[]'::jsonb,
      summary      JSONB,
      status       TEXT NOT NULL DEFAULT 'processing',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS meetings_user_created
      ON meetings (user_id, created_at DESC);
  `)
  } catch (error) {
    // 23505 (duplicate key on a catalogue index) and 42P07 (relation already exists)
    // both mean another process won the race and the schema is present. Anything else
    // is a real failure.
    if (error?.code !== '23505' && error?.code !== '42P07') throw error
  }
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

// ---------------------------------------------------------------------------
// Recordings
//
// Every query is scoped by user_id as well as id. Checking ownership in the WHERE
// clause rather than after the read means a wrong id simply returns nothing — there is
// no window where the wrong row has been loaded.
// ---------------------------------------------------------------------------

export async function createRecording({ userId, title, mime, audio, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO recordings (user_id, title, mime, bytes, duration_s, audio, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'processing')
     RETURNING id, title, mime, bytes, duration_s, status, created_at`,
    [userId, title, mime, audio.length, durationSeconds, audio],
  )
  return rows[0]
}

export async function setTranscript(id, userId, transcript) {
  await pool.query(
    `UPDATE recordings SET transcript = $1::jsonb, status = 'ready', error = NULL
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(transcript), id, userId],
  )
}

export async function setRecordingFailed(id, userId, reason) {
  await pool.query(
    `UPDATE recordings SET status = 'failed', error = $1 WHERE id = $2 AND user_id = $3`,
    [reason, id, userId],
  )
}

export async function listRecordings(userId) {
  const { rows } = await pool.query(
    `SELECT id, title, mime, bytes, duration_s, status, error, created_at,
            jsonb_array_length(transcript) AS lines
     FROM recordings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  )
  return rows
}

export async function getRecording(id, userId) {
  const { rows } = await pool.query(
    `SELECT id, title, mime, bytes, duration_s, status, error, transcript, created_at
     FROM recordings WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return rows[0] ?? null
}

/** Audio is fetched separately so listing never drags megabytes through the pool. */
export async function getRecordingAudio(id, userId) {
  const { rows } = await pool.query(
    'SELECT mime, audio FROM recordings WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return rows[0] ?? null
}

export async function deleteRecording(id, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM recordings WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return rowCount > 0
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export async function createMeeting({
  userId,
  title,
  platform,
  source,
  durationSeconds,
  participants,
  transcript,
}) {
  const { rows } = await pool.query(
    `INSERT INTO meetings
       (user_id, title, platform, source, duration_s, participants, transcript, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'processing')
     RETURNING id, title, platform, source, duration_s, status, created_at`,
    [
      userId,
      title,
      platform,
      source,
      durationSeconds,
      JSON.stringify(participants ?? []),
      JSON.stringify(transcript ?? []),
    ],
  )
  return rows[0]
}

export async function setMeetingSummary(id, userId, summary, title) {
  await pool.query(
    `UPDATE meetings SET summary = $1::jsonb, title = COALESCE($2, title), status = 'ready'
     WHERE id = $3 AND user_id = $4`,
    [JSON.stringify(summary), title ?? null, id, userId],
  )
}

export async function setMeetingFailed(id, userId) {
  await pool.query("UPDATE meetings SET status = 'failed' WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ])
}

export async function listMeetings(userId) {
  const { rows } = await pool.query(
    `SELECT id, title, platform, source, duration_s, status, participants, summary, created_at,
            jsonb_array_length(transcript) AS lines
     FROM meetings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  )
  return rows
}

export async function getMeetingById(id, userId) {
  const { rows } = await pool.query(
    `SELECT id, title, platform, source, duration_s, status, participants, transcript,
            summary, created_at
     FROM meetings WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return rows[0] ?? null
}

export async function deleteMeeting(id, userId) {
  const { rowCount } = await pool.query('DELETE FROM meetings WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ])
  return rowCount > 0
}
