/**
 * Steer-echo paste reconcile — the `appendSlotMessage` branch that pairs the
 * server `steer_push` echo with the optimistic steer bubble this tab appended.
 *
 * A large paste in a steered message is rendered as a collapsed
 * `[ Paste #N · M lines ]` chip, backed by `meta.pastes`. The backend stores
 * and echoes only the EXPANDED text (what the LLM saw) with no `pastes`. The
 * reconcile used to overwrite the bubble's token content with that expanded
 * echo, so the row rendered as a chip before the echo and as hundreds of raw
 * lines after — flipping whenever the virtualized transcript remounted the row
 * on scroll. These tests pin the invariant: when the echo is merely the
 * expansion of what we hold, the collapsed content and its pastes survive.
 */
import { describe, it, expect } from 'vitest'
import reducer, { appendMessage, appendSlotMessage } from '../store/chatSlice'
import type { ChatMessage } from '../types'
import { expandAll, formatToken, type PasteBlock } from '../utils/pasteTokens'

const SLOT = 'slot-a'

const PASTE: PasteBlock = {
  id: 'blk1',
  seq: 1,
  lines: 20,
  content: Array.from({ length: 20 }, (_, i) => `line ${i + 1} of pasted content`).join('\n'),
}
// Collapsed content as the composer sends it: a token on its own line.
const COLLAPSED = formatToken(PASTE)
// Expanded content as the backend echoes it back.
const EXPANDED = expandAll(COLLAPSED, [PASTE])

const userRows = (msgs: ChatMessage[]) => msgs.filter(m => m.role === 'user')

/** Store slice holding one optimistic steer bubble whose content is collapsed. */
function withCollapsedSteerBubble(sendId: string, content = COLLAPSED, meta: Record<string, unknown> = {}) {
  let state = reducer(undefined, { type: '@@INIT' })
  state = { ...state, activeSlot: SLOT }
  return reducer(state, appendMessage({
    role: 'user', content, cls: 'msg msg-u',
    ts: new Date('2026-10-01T20:00:00Z').toISOString(),
    meta: { steer: true, optimistic: true, sendId, pastes: [PASTE], ...meta },
  }))
}

/** The server `steer_push` echo: expanded content, no pastes, server ts. */
function steerEcho(sendId: string, content = EXPANDED): ChatMessage {
  return {
    role: 'user', content, cls: 'msg msg-u',
    ts: new Date('2026-10-01T20:00:03Z').toISOString(),
    meta: { steer: true, sendId },
  }
}

describe('appendSlotMessage — steer echo paste reconcile', () => {
  it('keeps the collapsed token content when the echo is its expansion', () => {
    let state = withCollapsedSteerBubble('s1')
    state = reducer(state, appendSlotMessage({ slot: SLOT, message: steerEcho('s1') }))
    const rows = userRows(state.messages)
    expect(rows).toHaveLength(1)
    // Content stays the chip token, not the expanded raw text.
    expect(rows[0].content).toBe(COLLAPSED)
    // Backing blocks survive the server-meta merge so the chip can render.
    expect(rows[0].meta?.pastes).toEqual([PASTE])
    // Reconcile still completed: optimistic cleared, server ts adopted.
    expect(rows[0].meta?.optimistic).toBeUndefined()
    expect(rows[0].ts).toBe(new Date('2026-10-01T20:00:03Z').toISOString())
  })

  it('preserves optimistic file chips the echo omits', () => {
    const files = ['/abs/path/report.pdf']
    let state = withCollapsedSteerBubble('s1', COLLAPSED, { files })
    state = reducer(state, appendSlotMessage({ slot: SLOT, message: steerEcho('s1') }))
    const rows = userRows(state.messages)
    expect(rows[0].content).toBe(COLLAPSED)
    expect(rows[0].meta?.files).toEqual(files)
  })

  it('does not alter content when the echo is NOT the expansion (real redaction)', () => {
    // Server redacted the message to something that is not our paste's
    // expansion — the collapsed form no longer represents it, so the server
    // content must win.
    let state = withCollapsedSteerBubble('s1')
    const redacted = steerEcho('s1', '[redacted by policy]')
    state = reducer(state, appendSlotMessage({ slot: SLOT, message: redacted }))
    const rows = userRows(state.messages)
    expect(rows[0].content).toBe('[redacted by policy]')
  })

  it('still overwrites content for a steer bubble that carried no pastes', () => {
    // A plain steer (no paste) must keep the existing behavior: adopt the echo.
    let state = reducer(undefined, { type: '@@INIT' })
    state = { ...state, activeSlot: SLOT }
    state = reducer(state, appendMessage({
      role: 'user', content: 'change course', cls: 'msg msg-u',
      ts: new Date('2026-10-01T20:00:00Z').toISOString(),
      meta: { steer: true, optimistic: true, sendId: 's1' },
    }))
    state = reducer(state, appendSlotMessage({ slot: SLOT, message: steerEcho('s1', 'change course (server)') }))
    const rows = userRows(state.messages)
    expect(rows[0].content).toBe('change course (server)')
  })
})
