// Bad fixture: duplicate session_expired socket registration
// Used by TC-ESLINT-07 to test SEC-MODAL-02 cross-file check

declare const socket: { on: (event: string, handler: () => void) => void }

// This file registers session_expired — when combined with a file that also
// registers it, the check should detect the duplicate.
socket.on('session_expired', () => {
  console.log('session expired handler 2')
})
