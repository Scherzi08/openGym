import { describe, it, expect } from 'vitest'
import { mergeScan, ALL_EQUIPMENT } from './equipment.js'

describe('mergeScan', () => {
  it('ticks what the scan saw and reports only what is new', () => {
    const r = mergeScan(new Set(['dumbbell']), { equipment: ['dumbbell', 'cable', 'barbell'], maybe: [] })
    expect([...r.next].sort()).toEqual(['barbell', 'cable', 'dumbbell'])
    expect(r.added).toEqual(['cable', 'barbell'])
  })
  it('never unticks what the person already had', () => {
    const r = mergeScan(['kettlebell', 'band'], { equipment: ['cable'] })
    expect(r.next.has('kettlebell')).toBe(true)
    expect(r.next.has('band')).toBe(true)
  })
  it('offers the unsure ones without ticking them, unless already ticked', () => {
    const r = mergeScan(['ez barbell'], { equipment: ['dumbbell'], maybe: ['ez barbell', 'kettlebell'] })
    expect(r.next.has('kettlebell')).toBe(false)
    expect(r.maybe).toEqual(['kettlebell'])
  })
  it('drops values outside the catalogue and body weight', () => {
    expect(ALL_EQUIPMENT).toContain('body weight')
    const r = mergeScan([], { equipment: ['laser cannon', 'body weight', 'cable'], maybe: ['unicorn', 'body weight'] })
    expect([...r.next]).toEqual(['cable'])
    expect(r.maybe).toEqual([])
  })
  it('copes with no answer at all', () => {
    const r = mergeScan(['cable'], null)
    expect([...r.next]).toEqual(['cable'])
    expect(r.added).toEqual([])
    expect(r.maybe).toEqual([])
  })
})

describe('the scan photo limit', () => {
  it('is the server’s', async () => {
    const { MAX_SCAN_PHOTOS } = await import('./equipment.js')
    const { MAX_SCAN_IMAGES } = await import('../../../api/coach/core/scan.js')
    expect(MAX_SCAN_PHOTOS).toBe(MAX_SCAN_IMAGES)
  })
})
