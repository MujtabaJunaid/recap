#!/usr/bin/env node
/**
 * Agent capture hook.
 *
 * Fires automatically from .claude/settings.json on two Claude Code lifecycle events:
 *
 *   UserPromptSubmit -> this script with mode "prompt"   (the prompt, verbatim)
 *   Stop             -> this script with mode "response" (the final assistant message)
 *
 * Nothing here has to be remembered or run by hand, which is the whole requirement.
 *
 * Both events deliver a JSON payload on stdin. UserPromptSubmit carries the prompt
 * text directly. Stop carries only `transcript_path`, so the final response is read
 * from the end of that JSONL transcript.
 *
 * Captures the prompt and the final response only — no thinking, no tool calls, no
 * intermediate steps.
 *
 *   node .claude/hooks/capture.mjs prompt
 *   node .claude/hooks/capture.mjs response
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]

/**
 * Resolved from this file's own location, not from the working directory.
 *
 * The hook is registered at the Claude Code session root, which is not this repo, so
 * `process.cwd()` pointed somewhere else entirely and the log would have been written
 * outside the project. That is how the first install silently captured nothing.
 */
const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.agent-logs')

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

/** One file per session, named on first write and reused for the rest of it. */
function sessionFile(sessionId, startedAt) {
  mkdirSync(LOG_DIR, { recursive: true })
  const short = sessionId.slice(0, 8)
  const existing = readdirSync(LOG_DIR).find((f) => f.includes(short) && f.endsWith('.md'))
  if (existing) return join(LOG_DIR, existing)

  const stamp = startedAt.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  return join(LOG_DIR, `${stamp}_${short}.md`)
}

function ensureHeader(file, sessionId, model, startedAt) {
  if (existsSync(file)) return
  const short = sessionId.slice(0, 8)
  writeFileSync(
    file,
    `---
session_id: ${sessionId}
date: ${startedAt.toISOString().slice(0, 10)}
author: MujtabaJunaid
model: ${model}
tool: claude-code
project: recap
first_prompt_time: ${startedAt.toISOString()}
---

# Session Log - ${startedAt.toISOString().slice(0, 10)}

Session: \`${short}\` | Project: \`recap\` | Author: \`MujtabaJunaid\`

---

`,
    'utf8',
  )
}

/** Entry numbers are per session and shared by a prompt and its response. */
function nextNumber(file, type) {
  if (!existsSync(file)) return 1
  const content = readFileSync(file, 'utf8')
  const matches = [...content.matchAll(new RegExp(`\\[LOG_ENTRY type=${type} num=(\\d+)`, 'g'))]
  return matches.length === 0 ? 1 : Math.max(...matches.map((m) => Number(m[1]))) + 1
}

function appendEntry(file, { type, num, session, timestamp, model, body }) {
  appendFileSync(
    file,
    `[LOG_ENTRY type=${type} num=${num} session=${session.slice(0, 8)}]\ntimestamp: ${timestamp}\nmodel: ${model}\n\n${body}\n\n\n`,
    'utf8',
  )
}

/**
 * The transcript is JSONL, one event per line. The last assistant message before the
 * turn ended is the final response; everything before it is thinking and tool calls,
 * which are explicitly not wanted.
 */
function finalAssistantMessage(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null

  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    let event
    try {
      event = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (event?.type !== 'assistant') continue

    const content = event.message?.content
    const text = Array.isArray(content)
      ? content
          .filter((part) => part?.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .trim()
      : typeof content === 'string'
        ? content.trim()
        : ''

    if (text) return { text, model: event.message?.model ?? 'unknown' }
  }
  return null
}

const payload = readStdin()
const sessionId = payload.session_id || 'unknown-session'
const now = new Date()
const file = sessionFile(sessionId, now)

try {
  if (mode === 'prompt') {
    const prompt = payload.prompt ?? ''
    if (!prompt.trim()) process.exit(0)
    ensureHeader(file, sessionId, 'claude-opus-5', now)
    appendEntry(file, {
      type: 'PROMPT',
      num: nextNumber(file, 'PROMPT'),
      session: sessionId,
      timestamp: now.toISOString(),
      model: 'claude-opus-5',
      body: prompt,
    })
  } else if (mode === 'response') {
    const final = finalAssistantMessage(payload.transcript_path)
    if (!final) process.exit(0)
    ensureHeader(file, sessionId, final.model, now)
    appendEntry(file, {
      type: 'RESPONSE',
      num: nextNumber(file, 'RESPONSE'),
      session: sessionId,
      timestamp: now.toISOString(),
      model: final.model,
      body: final.text,
    })
  }
} catch (error) {
  // A capture failure must never block the session. Record it and get out of the way.
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(
      join(LOG_DIR, 'capture-errors.log'),
      `${now.toISOString()} ${mode}: ${error.message}\n`,
      'utf8',
    )
  } catch {
    // Nothing further to try.
  }
}

process.exit(0)
