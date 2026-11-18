import { useState } from 'react'
import { Crosshair, Info } from 'lucide-react'
import { Badge, Button, statusTone } from '@/components/ui'
import { ASSURANCE_LABELS, type Gps, type Validation } from '@/lib/api'

const DATASET_COPY: Record<Validation['dataset']['status'], string> = {
  matched: 'Found in the postcode dataset',
  not_found: 'Not found in the postcode dataset',
  dataset_unavailable: 'No postcode dataset is loaded, so this was not checked',
  not_checked: 'Not checked',
}
const GEO_COPY: Record<Validation['geographic']['status'], string> = {
  consistent: 'Consistent with your state and LGA',
  inconsistent: 'Does not match your state and LGA',
  not_assessable: 'Cannot be assessed with the available data',
}
const GPS_COPY: Record<Validation['gps']['status'], string> = {
  not_provided: 'Not provided',
  confirmed: 'Device fix captured',
  low_accuracy: 'Fix too old, too imprecise or outside Nigeria',
}

export function ValidationPanel({ validation }: { validation: Validation }) {
  const rows: [string, string, string][] = [
    ['Format', validation.format.valid ? `Valid ${validation.format.format === 'digital_11_char' ? 'digital postcode' : '6-digit postcode'}` : (validation.format.reason ?? 'Invalid'), validation.format.valid ? 'valid' : 'invalid'],
    ['Dataset match', validation.dataset.status === 'matched' && validation.dataset.record?.sourceId === 'nipost-validator' ? 'Verified by NIPOST Postcode Validator (test environment)' : DATASET_COPY[validation.dataset.status], validation.dataset.status],
    ['Geographic consistency', validation.geographic.detail && validation.geographic.status !== 'not_assessable' ? validation.geographic.detail : GEO_COPY[validation.geographic.status], validation.geographic.status],
    ['Device location', GPS_COPY[validation.gps.status], validation.gps.status],
  ]
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Validation result</p>
        <Badge tone={validation.assuranceLevel >= 2 ? 'ok' : validation.assuranceLevel === 1 ? 'warn' : 'bad'}>
          Level {validation.assuranceLevel}: {ASSURANCE_LABELS[validation.assuranceLevel]}
        </Badge>
      </div>
      <ul className="divide-y divide-line text-sm">
        {rows.map(([label, text, status]) => (
          <li key={label} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-mute">{label}</span>
            <span className="flex items-center gap-2 sm:text-right">
              <Badge tone={statusTone(status)}>{status.replaceAll('_', ' ')}</Badge>
              <span className="max-w-[16rem] text-xs text-mute">{text}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between py-2">
          <span className="text-mute">Proof of residence</span>
          <Badge>Not established</Badge>
        </li>
      </ul>
      <p className="flex gap-2 text-xs text-mute">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Validation checks the address data. It does not prove that you live here.
      </p>
    </div>
  )
}

export function GpsButton({ onFix, disabled }: { onFix: (gps: Gps) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'asking' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const capture = () => {
    if (!('geolocation' in navigator)) {
      setState('error')
      setMessage('This device or browser cannot share its location.')
      return
    }
    setState('asking')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState('idle')
        onFix({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: Math.round(pos.coords.accuracy),
          capturedAt: new Date(pos.timestamp).toISOString(),
        })
      },
      (err) => {
        setState('error')
        setMessage(err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Nothing was collected.' : 'Your location could not be determined.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-paper p-4">
      <p className="text-sm font-semibold">Confirm with your device location (optional)</p>
      <p className="text-xs text-mute">
        We ask for your location only when you press the button, and never in the background. A fix shows where this device was at one moment. It does not establish legal residence.
      </p>
      <Button type="button" variant="secondary" loading={state === 'asking'} disabled={disabled} onClick={capture}>
        <Crosshair className="h-4 w-4" aria-hidden /> Use my location now
      </Button>
      {state === 'error' && <p role="alert" className="text-xs font-medium text-bad">{message}</p>}
    </div>
  )
}
