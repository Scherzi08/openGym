import { describe, it, expect } from 'vitest'
import { fitWithin, splitDataUrl, MAX_EDGE } from './image-resize.js'

describe('fitWithin', () => {
  it('scales the long edge down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ w: MAX_EDGE, h: 960 })
    expect(fitWithin(3024, 4032)).toEqual({ w: 960, h: MAX_EDGE })
  })
  it('never scales a small photo up', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 })
  })
  it('keeps at least one pixel on a very thin image', () => {
    expect(fitWithin(10000, 2, 1000)).toEqual({ w: 1000, h: 1 })
  })
  it('answers zero for something with no size', () => {
    expect(fitWithin(0, 100)).toEqual({ w: 0, h: 0 })
    expect(fitWithin(undefined, undefined)).toEqual({ w: 0, h: 0 })
  })
})

describe('splitDataUrl', () => {
  it('splits a base64 data URL into type and data', () => {
    expect(splitDataUrl('data:image/jpeg;base64,/9j/AAA=')).toEqual({ mime: 'image/jpeg', data: '/9j/AAA=' })
  })
  it('refuses anything else', () => {
    expect(splitDataUrl('data:,hello')).toBe(null)
    expect(splitDataUrl('https://x/y.jpg')).toBe(null)
    expect(splitDataUrl(null)).toBe(null)
  })
})
