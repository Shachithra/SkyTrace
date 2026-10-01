import type { VisibilityStatus } from '../astronomy/visibility.ts';
import { STATUS_TEXT } from '../astronomy/visibility.ts';
import { h } from './dom.ts';

/** Visibility status — always text + a distinct glyph, never colour alone. */
export function visibilityIndicator(status: VisibilityStatus, compact = false): HTMLElement {
  const glyph = status === 'LIKELY_VISIBLE' ? '◆' : status === 'POSSIBLY_VISIBLE' ? '◇' : '○';
  const text = compact ? STATUS_TEXT[status].replace('NOT EXPECTED TO BE VISIBLE', 'NOT EXPECTED') : STATUS_TEXT[status];
  return h('span', { class: 'vis', 'data-status': status }, h('span', { class: 'vis-glyph', 'aria-hidden': 'true' }, glyph), text);
}
