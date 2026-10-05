// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The provider and the canvas are the two things a test cannot have; both are stood in for.
const scan = { answer: null, error: null, images: null }
vi.mock('../lib/coach-api.js', () => ({
  scanEquipment: async images => {
    scan.images = images
    if (scan.error) throw scan.error
    return scan.answer
  }
}))
vi.mock('../lib/image-resize.js', () => ({ resizePhoto: async f => ({ mime: 'image/jpeg', data: '/9j/' + f.name }) }))

const { useStore } = await import('../store/useStore.js')
const { default: EquipmentScan } = await import('./EquipmentScan.jsx')

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root, seen

function Harness({ initial = [] }) {
  const [checked, setChecked] = useState(new Set(initial))
  seen = checked
  return <EquipmentScan checked={checked} setChecked={setChecked} />
}
const coachOn = consent => useStore.setState(s => ({
  config: { ...(s.config || {}), coach: { enabled: true } },
  user: { id: 'u1' },
  S: { ...s.S, coach: { ...(s.S.coach || {}), consent: consent ? { agreedAt: '2026-01-01T00:00:00Z', version: 1 } : null } }
}))
const photo = name => new File(['x'], name, { type: 'image/jpeg' })
async function pickFiles(files) {
  const input = container.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => {})
}

beforeEach(() => {
  scan.answer = { equipment: ['cable', 'barbell'], maybe: ['kettlebell'], note: 'One photo was dark.', dropped: 0 }
  scan.error = null; scan.images = null
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('EquipmentScan', () => {
  it('is not there when the Coach is not', async () => {
    useStore.setState({ config: { coach: { enabled: false } }, user: { id: 'u1' } })
    await act(async () => root.render(<Harness />))
    expect(container.querySelector('button')).toBe(null)
  })

  it('ticks what the scan found, offers the unsure ones, and shows the note', async () => {
    coachOn(true)
    await act(async () => root.render(<Harness initial={['dumbbell']} />))
    await pickFiles([photo('a.jpg'), photo('b.jpg')])
    expect(scan.images.map(i => i.data)).toEqual(['/9j/a.jpg', '/9j/b.jpg'])
    expect([...seen].sort()).toEqual(['barbell', 'cable', 'dumbbell'])
    const status = container.querySelector('[role=status]').textContent
    expect(status).toContain('One photo was dark.')
    const maybe = [...container.querySelectorAll('.chip')]
    expect(maybe.map(b => b.textContent)).toEqual(['kettlebell'])
    await act(async () => maybe[0].click())
    expect(seen.has('kettlebell')).toBe(true)
    expect(container.querySelectorAll('.chip')).toHaveLength(0)
  })

  it('sends at most four photos', async () => {
    coachOn(true)
    await act(async () => root.render(<Harness />))
    await pickFiles(['1', '2', '3', '4', '5', '6'].map(n => photo(n + '.jpg')))
    expect(scan.images).toHaveLength(4)
  })

  it('shows a refusal by its code and changes nothing', async () => {
    coachOn(true)
    scan.error = Object.assign(new Error('the Coach is resting'), { data: { code: 'timeout' } })
    await act(async () => root.render(<Harness initial={['dumbbell']} />))
    await pickFiles([photo('a.jpg')])
    expect(container.querySelector('[role=alert]').textContent).toMatch(/too long/)
    expect([...seen]).toEqual(['dumbbell'])
  })

  it('without consent, does not open the picker', async () => {
    coachOn(false)
    await act(async () => root.render(<Harness />))
    const input = container.querySelector('input[type=file]')
    const click = vi.spyOn(input, 'click')
    await act(async () => container.querySelector('button').click())
    expect(click).not.toHaveBeenCalled()
  })
})
