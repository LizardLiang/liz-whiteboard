// src/components/canvas/card-role-labels.ts
// Translated role names for the card chip. The canvas draws outside React, so
// callers hand these strings to the renderer and the exporter.

import type { CardRoleLabels } from '@/lib/canvas-engine/render'
import type { TFunction } from '@/lib/i18n/translate'

export function cardRoleLabelsOf(t: TFunction): CardRoleLabels {
  return {
    none: t('canvas.card.roles.none'),
    trigger: t('canvas.card.roles.trigger'),
    action: t('canvas.card.roles.action'),
    system: t('canvas.card.roles.system'),
    data: t('canvas.card.roles.data'),
    note: t('canvas.card.roles.note'),
  }
}
