import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Loader2, Search, Building2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { modules } from '../lib/modules'

interface CompanyHit { id: string; legal_name: string; trade_name: string | null }
interface DocumentHit { id: string; storage_path: string; metadata: Record<string, unknown> | null }
interface Results { companies: CompanyHit[]; documents: DocumentHit[]; navigation: typeof modules }
const empty: Results = { companies: [], documents: [], navigation: [] }

function sanitize(value: string): string {
  return value.replace(/[,%()]/g, ' ').trim()
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Results>(empty)
  const boxRef = useRef<HTMLDivElement>(null)
  const trimmed = sanitize(query)

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    if (trimmed.length < 2) { setResults(empty); return }
    setBusy(true)
    const handle = setTimeout(() => {
      const pattern = `%${trimmed}%`
      void Promise.all([
        supabase!.from('companies').select('id,legal_name,trade_name')
          .or(`legal_name.ilike.${pattern},trade_name.ilike.${pattern}`).limit(5),
        supabase!.from('documents').select('id,storage_path,metadata')
          .or(`storage_path.ilike.${pattern},metadata->>title.ilike.${pattern}`).limit(5),
      ]).then(([companies, documents]) => {
        setResults({
          companies: (companies.data ?? []) as CompanyHit[],
          documents: (documents.data ?? []) as DocumentHit[],
          navigation: modules.filter(module => module.id !== 'dashboard' && module.label.toLowerCase().includes(trimmed.toLowerCase())),
        })
        setBusy(false)
      }).catch(() => setBusy(false))
    }, 250)
    return () => clearTimeout(handle)
  }, [trimmed])

  const hasResults = results.companies.length > 0 || results.documents.length > 0 || results.navigation.length > 0
  return <div className="search-box" ref={boxRef}>
    <div className="search-future">
      <Search size={17} />
      <input
        value={query}
        onChange={event => { setQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Rechercher dans EBI-IMT"
        aria-label="Recherche globale"
      />
      {busy && <Loader2 size={14} className="search-busy" />}
    </div>
    {open && trimmed.length >= 2 && <div className="search-menu" role="listbox" aria-label="Résultats de recherche">
      {hasResults ? <>
        {results.navigation.length > 0 && <div className="search-group">
          <span>Navigation</span>
          {results.navigation.map(module => <button type="button" key={module.id} onClick={() => { setOpen(false); navigate(module.path) }}>
            <module.icon size={16} /> {module.label}
          </button>)}
        </div>}
        {results.companies.length > 0 && <div className="search-group">
          <span>Sociétés</span>
          {results.companies.map(company => <button type="button" key={company.id} onClick={() => { setOpen(false); navigate(`/societes/${company.id}`) }}>
            <Building2 size={16} /> {company.trade_name ?? company.legal_name}
          </button>)}
        </div>}
        {results.documents.length > 0 && <div className="search-group">
          <span>Documents</span>
          {results.documents.map(document => <button type="button" key={document.id} onClick={() => { setOpen(false); navigate(`/bibliotheque?doc=${document.id}`) }}>
            <FileText size={16} /> {typeof document.metadata?.title === 'string' && document.metadata.title ? document.metadata.title : document.storage_path.split('/').pop()}
          </button>)}
        </div>}
      </> : <div className="search-empty">{busy ? 'Recherche en cours…' : 'Aucun résultat pour cette recherche.'}</div>}
      <button type="button" className="search-all" onClick={() => { setOpen(false); navigate('/societes') }}>
        Parcourir le référentiel <ArrowRight size={14} />
      </button>
    </div>}
  </div>
}
