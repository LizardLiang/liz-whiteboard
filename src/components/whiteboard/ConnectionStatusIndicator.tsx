/**
 * ConnectionStatusIndicator — shows WebSocket connection state as a banner
 * Hidden when connected; amber when connecting/reconnecting; red when disconnected
 */

import type { ConnectionState } from '@/hooks/use-collaboration'

export interface ConnectionStatusIndicatorProps {
  connectionState: ConnectionState
}

export function ConnectionStatusIndicator({
  connectionState,
}: ConnectionStatusIndicatorProps) {
  if (connectionState === 'connected') {
    // No indicator in normal state
    return null
  }

  const isReconnecting = connectionState === 'connecting'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: 500,
        background: isReconnecting ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
        border: `1px solid ${isReconnecting ? '#f59e0b' : '#ef4444'}`,
        color: isReconnecting ? '#b45309' : '#dc2626',
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      {/* Status dot */}
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isReconnecting ? '#f59e0b' : '#ef4444',
          display: 'inline-block',
          flexShrink: 0,
          animation: isReconnecting ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      {isReconnecting
        ? 'Reconnecting — collaborators may not see your changes'
        : 'Disconnected — changes may not sync to collaborators'}
    </div>
  )
}
