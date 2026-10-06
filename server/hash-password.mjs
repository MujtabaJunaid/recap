#!/usr/bin/env node
/**
 * Produces the PASSWORD_HASH value for `heroku config:set`.
 *
 * The plaintext is read from argv and never written anywhere. Only the derivation is
 * printed, and a derivation cannot be reversed into the password.
 *
 *   node server/hash-password.mjs 'the password'
 */
import { randomBytes, scryptSync } from 'node:crypto'

const plaintext = process.argv[2]
if (!plaintext || plaintext.length < 10) {
  console.error('Usage: node server/hash-password.mjs <password of at least 10 characters>')
  process.exit(1)
}

const salt = randomBytes(16)
const derived = scryptSync(plaintext, salt, 64, { N: 16384 })
console.log(`${salt.toString('hex')}:${derived.toString('hex')}`)
