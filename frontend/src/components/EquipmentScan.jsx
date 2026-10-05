import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { scanEquipment } from '../lib/coach-api.js'
import { mergeScan, MAX_SCAN_PHOTOS } from '../lib/equipment.js'
import { resizePhoto } from '../lib/image-resize.js'
import { Button } from './ui.jsx'

// A refused or failed scan, by the code the server (routes.js) or the phone's own run answers
// with. Anything not listed keeps the message it came with.
const SCAN_ERRORS = {
  timeout: 'The scan took too long — try fewer photos.',
  unusable: 'The AI answered with something the app couldn’t use. Try other photos.',
  provider: 'The AI couldn’t look at the photos — the chosen model may not support images.',
  novision: 'The AI couldn’t look at the photos — the chosen model may not support images.',
  auth: 'The AI provider isn’t set up correctly.',
  missing: 'The AI provider isn’t set up correctly.',
  busy: 'The Coach is already thinking about your training.',
  consent: 'The Coach needs your go-ahead first.'
}

// "Scan my gym": a few photos → the Coach's provider names the equipment in them → it is ticked
// in the profile being edited. Nothing is saved until the sheet's own Save, and the person sees
// exactly what was ticked for them. Shown only where the Coach is (the same predicate as every
// other Coach surface), because it spends the Coach's provider account and its daily runs.
export default function EquipmentScan({ checked, setChecked }) {
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const consent = useStore(s => hasConsent(s.S))
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  if (!coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })) return null

  const toast = m => useUI.getState().toast(m)
  const pick = () => {
    // Consent is checked again by whoever runs the scan; asking here saves the photos the trip.
    if (!consent && !DEMO) { toast(t('Open the Coach once and give it your go-ahead first.')); return }
    input.current?.click()
  }
  const onFiles = async e => {
    const files = [...(e.target.files || [])].filter(f => /^image\//.test(f.type))
    e.target.value = ''   // picking the same photo again must fire change again
    if (!files.length) return
    if (files.length > MAX_SCAN_PHOTOS) toast(t('Only the first {0} photos are used.', MAX_SCAN_PHOTOS))
    setBusy(true); setError(null); setResult(null)
    try {
      const images = await Promise.all(files.slice(0, MAX_SCAN_PHOTOS).map(f => resizePhoto(f)))
      const r = await scanEquipment(images)
      const m = mergeScan(checked, r)
      setChecked(m.next)
      setResult({ added: m.added, maybe: m.maybe, note: r.note || '' })
    } catch (err) {
      const code = err?.data?.code || err?.code
      setError(SCAN_ERRORS[code] ? t(SCAN_ERRORS[code]) : (err?.message || t('The scan failed — try again.')))
    } finally {
      setBusy(false)
    }
  }
  const tick = k => {
    setChecked(s => new Set(s).add(k))
    setResult(r => r && { ...r, added: [...r.added, k], maybe: r.maybe.filter(x => x !== k) })
  }

  return <div style={{ marginBottom: 14 }}>
    <input ref={input} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    <Button variant="ghost" icon="camera" onClick={pick} disabled={busy}>
      {busy ? t('Looking at your photos…') : t('Scan my gym with AI')}
    </Button>
    <div className="dim small" style={{ marginTop: 6 }}>
      {t('Take or pick up to {0} photos of the gym floor. They are sent to the AI provider only to recognise the equipment, and are not stored. Avoid photographing people.', MAX_SCAN_PHOTOS)}
    </div>
    {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 8, whiteSpace: 'pre-line' }}>{error}</div>}
    {result && <div className="small" role="status" style={{ marginTop: 10 }}>
      <div>{result.added.length
        ? t('Ticked from your photos: {0}. Check the list below before you save.', result.added.map(k => t(k)).join(', '))
        : t('Nothing new found in your photos.')}</div>
      {result.maybe.length > 0 && <>
        <div className="dim" style={{ marginTop: 8 }}>{t('Not sure about these — tap the ones you have:')}</div>
        <div className="chips" style={{ marginTop: 6 }}>
          {result.maybe.map(k => <button key={k} className="chip" onClick={() => tick(k)}>{t(k)}</button>)}
        </div>
      </>}
      {result.note && <div className="dim" style={{ marginTop: 8 }}>{result.note}</div>}
    </div>}
  </div>
}
