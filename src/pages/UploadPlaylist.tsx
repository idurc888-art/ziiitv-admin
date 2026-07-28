import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, FileUp, Link2, LockKeyhole, Server, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { MAX_PLAYLIST_FILE_BYTES, startPlaylistImport, type PlaylistSource } from '../lib/playlistImports'

type Mode = PlaylistSource['mode']

const MODES: Array<{ mode: Mode; label: string; icon: typeof FileUp; description: string }> = [
  { mode: 'file', label: 'Arquivo M3U', icon: FileUp, description: 'Envio privado para processamento em fila' },
  { mode: 'url', label: 'URL M3U', icon: Link2, description: 'A origem fica criptografada no Vault' },
  { mode: 'xtream', label: 'Xtream API', icon: Server, description: 'Tipos e IDs nativos têm prioridade' },
]

export function UploadPlaylist() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('xtream')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    let source: PlaylistSource
    if (mode === 'file') {
      if (!file) return toast.error('Selecione um arquivo M3U.')
      source = { mode, file }
    } else if (mode === 'url') {
      if (!url.trim()) return toast.error('Informe a URL M3U.')
      source = { mode, url: url.trim() }
    } else {
      if (!baseUrl.trim() || !username.trim() || !password) return toast.error('Preencha host, usuário e senha.')
      source = { mode, baseUrl: baseUrl.trim(), username: username.trim(), password }
    }

    setSubmitting(true)
    try {
      const result = await startPlaylistImport(source)
      setPassword('')
      toast.success('Importação protegida e enfileirada.')
      navigate(`/admin/playlists/${result.playlistId}/imports/${result.importId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao iniciar importação.', { duration: 7000 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <Header title="Nova importação" description="Pipeline QI220 versionado: ingerir, auditar e somente então publicar para a TV." />

      <div className="grid gap-4 lg:grid-cols-3">
        {MODES.map(({ mode: itemMode, label, icon: Icon, description }) => (
          <button key={itemMode} type="button" onClick={() => setMode(itemMode)}
            className={`text-left rounded-card border p-5 transition-colors ${mode === itemMode ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-elevated'}`}>
            <Icon className={`h-5 w-5 ${mode === itemMode ? 'text-accent' : 'text-text-muted'}`} />
            <p className="mt-3 font-semibold text-text-primary">{label}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <div className="space-y-5">
            {mode === 'file' && (
              <label className="block rounded-card border border-dashed border-border bg-elevated/40 p-8 text-center hover:border-accent/60">
                <FileUp className="mx-auto h-8 w-8 text-accent" />
                <span className="mt-3 block text-sm font-semibold text-text-primary">{file?.name || 'Selecionar .m3u ou .m3u8'}</span>
                <span className="mt-1 block text-xs text-text-muted">Até {MAX_PLAYLIST_FILE_BYTES / 1024 / 1024} MB; o navegador não classifica nem lê o arquivo inteiro.</span>
                <input type="file" accept=".m3u,.m3u8,audio/x-mpegurl" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
            )}

            {mode === 'url' && (
              <Field label="URL completa da lista" value={url} onChange={setUrl} placeholder="https://provedor.exemplo/lista.m3u" type="url" />
            )}

            {mode === 'xtream' && (
              <>
                <Field label="Host do servidor" value={baseUrl} onChange={setBaseUrl} placeholder="https://provedor.exemplo:443" type="url" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Usuário" value={username} onChange={setUsername} autoComplete="off" />
                  <Field label="Senha" value={password} onChange={setPassword} type="password" autoComplete="new-password" />
                </div>
              </>
            )}

            <div className="flex items-center justify-between border-t border-border pt-5">
              <p className="max-w-md text-xs leading-5 text-text-muted">Nada será exibido na TV antes da validação e da promoção atômica.</p>
              <Button onClick={submit} loading={submitting} icon={<Database className="h-4 w-4" />}>Iniciar auditoria</Button>
            </div>
          </div>
        </Card>

        <Card className="h-fit border border-border">
          <h2 className="flex items-center gap-2 font-semibold text-text-primary"><ShieldCheck className="h-5 w-5 text-neon" /> Garantias desta importação</h2>
          <ul className="mt-5 space-y-4 text-sm text-text-secondary">
            <Guarantee icon={LockKeyhole} text="Credenciais fora das tabelas públicas e protegidas no Vault." />
            <Guarantee icon={Database} text="Versão nova isolada; o catálogo ativo continua servindo a TV." />
            <Guarantee icon={ShieldCheck} text="Quedas, parse ruim e excesso de desconhecidos bloqueiam publicação." />
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; autoComplete?: string
}) {
  return <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span><input type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} className="w-full rounded-[10px] border border-border bg-elevated px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent" /></label>
}

function Guarantee({ icon: Icon, text }: { icon: typeof ShieldCheck; text: string }) {
  return <li className="flex gap-3"><Icon className="mt-0.5 h-4 w-4 flex-none text-accent" /><span className="leading-5">{text}</span></li>
}
