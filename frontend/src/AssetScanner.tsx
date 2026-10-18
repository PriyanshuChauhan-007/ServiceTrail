import { useEffect, useRef, useState } from 'react'
import type { Asset } from './types'

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type DetectorConstructor = new (options: { formats: string[] }) => Detector

export function assetForLabel(assets: Asset[], raw: string): Asset | undefined {
  // Labels identify equipment only: no location or condition is inferred from a scan.
  const value = raw.trim().toLocaleLowerCase()
  return assets.find(asset => asset.code.toLocaleLowerCase() === value || asset.id.toLocaleLowerCase() === value)
}

export default function AssetScanner({ assets, onSelected }: { assets: Asset[]; onSelected: (asset: Asset) => void }) {
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

  useEffect(() => {
    if (!active) return
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopCamera = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }
    const start = async () => {
      try {
        const Constructor = (window as unknown as { BarcodeDetector: DetectorConstructor }).BarcodeDetector
        const detector = new Constructor({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] })
        const capture = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (closed) { capture.getTracks().forEach(track => track.stop()); return }
        stream.current = capture
        const element = video.current
        if (!element) { stopCamera(); return }
        element.srcObject = capture
        await element.play()
        const scan = async () => {
          if (closed) return
          try {
            if (element.readyState >= 2) {
              const values = await detector.detect(element)
              if (closed) return
              for (const value of values) {
                const asset = assetForLabel(assets, value.rawValue)
                if (asset) {
                  onSelected(asset)
                  setMessage(`Matched ${asset.code} in your site's asset register. Confirm the equipment label before reporting.`)
                  setActive(false)
                  stopCamera()
                  return
                }
              }
              if (values.length) setMessage('Label read, but no exact registered asset matches it. Use the equipment code or ask your administrator to register it.')
            }
            if (!closed) timer = setTimeout(scan, 500)
          } catch {
            setMessage('This browser could not decode the label. Stop the camera and use the registered equipment code.')
            setActive(false)
            stopCamera()
          }
        }
        void scan()
      } catch {
        if (!closed) { setMessage('Camera unavailable or permission denied. Search by the registered code below; no camera data was uploaded.'); setActive(false) }
        stopCamera()
      }
    }
    void start()
    return () => { closed = true; if (timer) clearTimeout(timer); stopCamera() }
  }, [active, assets, onSelected])

  return <div className="asset-scanner">
    {supported ? <button type="button" className="button secondary small" onClick={() => { setMessage(''); setActive(value => !value) }}>{active ? 'Stop camera' : 'Scan equipment QR / barcode'}</button> : <p className="field-help">Camera scanning is not available in this browser. Use the registered equipment code below.</p>}
    {active && <><video ref={video} muted playsInline aria-label="Equipment label camera" /><p className="field-help">Point at a label containing the registered asset code or ID. Frames are processed in this browser, not uploaded.</p></>}
    {message && <p className="notice info" role="status">{message}</p>}
  </div>
}
