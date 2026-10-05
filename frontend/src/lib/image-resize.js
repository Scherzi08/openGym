// Photos for the equipment scan, made small enough to send.
//
// A phone camera's photo is 3–12 MB; the scan sends up to four to an AI provider through the
// API's 5 MB body limit, and a vision model sees no more in 4000 px than in 1280 px. So each
// photo is redrawn on a canvas, at most MAX_EDGE on its long side, as a JPEG — which also drops
// the EXIF block, GPS position included, before anything leaves the device.

export const MAX_EDGE = 1280
export const JPEG_QUALITY = 0.8

/** The size a w×h image is drawn at so its long edge is at most `max`. Never scales up. */
export function fitWithin(w, h, max = MAX_EDGE) {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 }
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** `data:image/jpeg;base64,…` → `{ mime, data }`, the shape the scan sends. */
export function splitDataUrl(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''))
  return m ? { mime: m[1], data: m[2] } : null
}

async function decode(file) {
  // createImageBitmap honours the EXIF orientation with this option, so a portrait photo is not
  // sent sideways. Older WebViews lack it; an <img> is the fallback (modern engines rotate it too).
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** One picked file → `{ mime: 'image/jpeg', data }`, resized. Throws if it is not an image. */
export async function resizePhoto(file, max = MAX_EDGE, quality = JPEG_QUALITY) {
  const src = await decode(file)
  const { w, h } = fitWithin(src.width || src.naturalWidth, src.height || src.naturalHeight, max)
  if (!w) throw new Error('not an image')
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(src, 0, 0, w, h)
  if (typeof src.close === 'function') src.close()
  const out = splitDataUrl(canvas.toDataURL('image/jpeg', quality))
  if (!out || out.mime !== 'image/jpeg') throw new Error('could not encode the photo')
  return out
}
