import { useEffect, useState, type ReactNode } from 'react'
import type { CharacterDefinition } from '../../shared/types'
import { useThumb } from './thumbs'

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}): ReactNode {
  const { label, value, min, max, step = 1, format, onChange, disabled } = props
  // Local echo keeps the thumb smooth while the state round-trips through main.
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const pct = ((local - min) / (max - min)) * 100
  return (
    <label className={`slider${disabled ? ' disabled' : ''}`}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => {
          const v = Number(e.target.value)
          setLocal(v)
          onChange(v)
        }}
      />
      <span className="slider-value">{format ? format(local) : local}</span>
    </label>
  )
}

export function Toggle(props: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): ReactNode {
  return (
    <label className={`toggle-row${props.disabled ? ' disabled' : ''}`}>
      <span>
        <span className="toggle-label">{props.label}</span>
        {props.hint && <span className="hint">{props.hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label?: string }): ReactNode {
  return (
    <div className="segmented-wrap">
      {props.label && <span className="field-label">{props.label}</span>}
      <div className="segmented" role="radiogroup">
        {props.options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={o.value === props.value}
            className={o.value === props.value ? 'on' : ''}
            disabled={o.disabled}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Section(props: { title: string; description?: string; children: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <section className="section">
      <header className="section-head">
        <div>
          <h3>{props.title}</h3>
          {props.description && <p className="muted">{props.description}</p>}
        </div>
        {props.actions}
      </header>
      <div className="section-body">{props.children}</div>
    </section>
  )
}

export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }): ReactNode {
  return (
    <header className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="row gap">{props.actions}</div>}
    </header>
  )
}

export function Thumb({ def, size = 64, fill }: { def: CharacterDefinition | undefined; size?: number; fill?: boolean }): ReactNode {
  const url = useThumb(def)
  return (
    <div className={`thumb${fill ? ' fill' : ''}`} style={fill ? undefined : { width: size, height: size }}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-empty" />}
    </div>
  )
}

export function Empty(props: { title: string; body: string; action?: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden>
        🐾
      </div>
      <h3>{props.title}</h3>
      <p className="muted">{props.body}</p>
      {props.action}
    </div>
  )
}

export function Icon({ name }: { name: 'home' | 'library' | 'studio' | 'active' | 'presets' | 'settings' | 'pause' | 'play' | 'eye' | 'eyeoff' | 'plus' | 'trash' | 'copy' | 'edit' | 'export' | 'import' | 'reset' }): ReactNode {
  const p: Record<string, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    library: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
    studio: <><path d="m14.5 4.5 5 5L9 20H4v-5z" /><path d="m12.5 6.5 5 5" /></>,
    active: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6" /></>,
    presets: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
    play: <path d="M7 4.5v15l12-7.5z" />,
    eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    eyeoff: <><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /></>,
    export: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 14v6h16v-6" /></>,
    import: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 14v6h16v-6" /></>,
    reset: <><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v4h4" /></>
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {p[name]}
    </svg>
  )
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`
