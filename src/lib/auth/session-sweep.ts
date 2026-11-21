// src/lib/auth/session-sweep.ts
// Deletes expired login sessions, signup tokens older than 7 days, email
// invites expired for 7 days and invite send-log rows older than 24 h: once at
// boot, then every hour. Mirrors the interval-with-unref pattern of the OAuth
// sweeps (codes.ts, pending-consent.ts). Expired rows are already refused at
// validation time; this keeps these tables from growing forever.

import {
  SIGNUP_TOKEN_CLEANUP_AGE_MS,
  deleteSignupTokensOlderThan,
} from '@/data/signup-token'
import {
  EMAIL_INVITE_CLEANUP_AGE_MS,
  EMAIL_INVITE_SEND_LOG_AGE_MS,
  deleteEmailInviteSendsOlderThan,
  deleteEmailInvitesExpiredBefore,
} from '@/data/project-email-invite'
import { deleteExpiredSessions } from '@/lib/auth/session'

const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000
let sweepTimer: ReturnType<typeof setInterval> | null = null

async function sweepOnce(): Promise<void> {
  try {
    const deleted = await deleteExpiredSessions()
    if (deleted > 0) console.log(`[auth] Deleted ${deleted} expired sessions`)
  } catch (error) {
    console.error('[auth] Failed to delete expired sessions:', error)
  }
  try {
    const swept = deleteSignupTokensOlderThan(SIGNUP_TOKEN_CLEANUP_AGE_MS)
    if (swept > 0) console.log(`[auth] Deleted ${swept} old signup tokens`)
  } catch (error) {
    console.error('[auth] Failed to delete old signup tokens:', error)
  }
  try {
    const swept = deleteEmailInvitesExpiredBefore(EMAIL_INVITE_CLEANUP_AGE_MS)
    if (swept > 0) console.log(`[auth] Deleted ${swept} old email invites`)
  } catch (error) {
    console.error('[auth] Failed to delete old email invites:', error)
  }
  try {
    const swept = deleteEmailInviteSendsOlderThan(EMAIL_INVITE_SEND_LOG_AGE_MS)
    if (swept > 0) console.log(`[auth] Deleted ${swept} old invite send logs`)
  } catch (error) {
    console.error('[auth] Failed to delete old invite send logs:', error)
  }
}

/** Sweep now and on an hourly timer. Safe to call more than once. */
export function startSessionSweep(): void {
  if (sweepTimer) return
  void sweepOnce()
  sweepTimer = setInterval(() => void sweepOnce(), SESSION_SWEEP_INTERVAL_MS)
  // Don't keep Node.js alive just for cleanup.
  sweepTimer.unref()
}

/** Stop the timer. For tests only. */
export function _stopSessionSweepForTests(): void {
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
}
