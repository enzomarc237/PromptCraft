import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import './App.css'
import {
  createId,
  nowIso,
  parseVariables,
  compilePromptTemplate,
  estimateCostUsd,
  diffByLine,
  eventMatchesShortcut,
  normalizeShortcut,
  encryptWithPassword,
  decryptWithPassword,
} from './lib/utils'
import { loadDatabase, persistDatabase } from './lib/storage'
import { discoverModels, executePrompt } from './lib/providers'
import type {
  AppDatabase,
  PromptRecord,
  PromptVersionRecord,
  ProviderId,
  PromptRunRecord,
  SyncChange,
  Hyperparameters,
} from './lib/types'

interface PlaygroundPaneState {
  provider: ProviderId
  model: string
  output: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  loading: boolean
  error: string
}

interface SyncConflict {
  id: string
  promptId: string
  versionNumber: number
  localTemplate: string
  remoteTemplate: string
}

const PROVIDERS: Array<{ id: ProviderId; label: string; defaultEndpoint: string }> = [
  { id: 'openai', label: 'OpenAI', defaultEndpoint: 'https://api.openai.com' },
  { id: 'openrouter', label: 'OpenRouter', defaultEndpoint: 'https://openrouter.ai/api' },
  { id: 'anthropic', label: 'Anthropic', defaultEndpoint: 'https://api.anthropic.com' },
  {
    id: 'gemini',
    label: 'Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
  },
  { id: 'mistral', label: 'Mistral', defaultEndpoint: 'https://api.mistral.ai' },
  { id: 'ollama', label: 'Ollama', defaultEndpoint: 'http://localhost:11434' },
]

const ANTHROPIC_FALLBACK = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
]

const SLASH_COMMANDS = [
  { label: '/date', value: '{{current_date}}' },
  { label: '/time', value: '{{current_time}}' },
  { label: '/system:senior-coder', value: 'Act as a senior software engineer.' },
  { label: '/json', value: 'Output valid JSON only.' },
  { label: '/codeblock', value: '```\n{{code_here}}\n```' },
]

const defaultPane = (provider: ProviderId, model: string): PlaygroundPaneState => ({
  provider,
  model,
  output: '',
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  loading: false,
  error: '',
})

function App() {
  const [db, setDb] = useState<AppDatabase>(() => loadDatabase())
  const [selectedPromptId, setSelectedPromptId] = useState(() => {
    const open = loadDatabase().prompts.find((entry) => !entry.isDeleted)
    return open?.id ?? ''
  })
  const [selectedVersionId, setSelectedVersionId] = useState(() => {
    const seeded = loadDatabase()
    const open = seeded.prompts.find((entry) => !entry.isDeleted)
    const version = seeded.promptVersions.find((entry) => entry.promptId === open?.id)
    return version?.id ?? ''
  })
  const [commitMessage, setCommitMessage] = useState('')
  const [activeTab, setActiveTab] = useState<'playground' | 'history' | 'settings'>('playground')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashRange, setSlashRange] = useState({ start: 0, end: 0 })
  const [slashQuery, setSlashQuery] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [syncStatus, setSyncStatus] = useState('Idle')
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([])

  const [leftPane, setLeftPane] = useState<PlaygroundPaneState>(
    defaultPane('openai', 'gpt-4o-mini'),
  )
  const [rightPane, setRightPane] = useState<PlaygroundPaneState>(
    defaultPane('anthropic', 'claude-3-5-sonnet-20241022'),
  )

  const [leftVariables, setLeftVariables] = useState<Record<string, string>>({})
  const [rightVariables, setRightVariables] = useState<Record<string, string>>({})

  useEffect(() => {
    persistDatabase(db)
  }, [db])

  useEffect(() => {
    const online = () => setIsOffline(false)
    const offline = () => setIsOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  useEffect(() => {
    const classList = document.documentElement.classList
    classList.remove(
      'theme-light',
      'theme-dark',
      'preset-slate',
      'preset-emerald',
      'preset-violet',
      'preset-amber',
    )

    const mode = db.settings.theme.mode
    const resolved =
      mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode

    classList.add(`theme-${resolved}`)
    classList.add(`preset-${db.settings.theme.colorPreset}`)

    document.documentElement.style.setProperty('--app-font-size', `${db.settings.theme.fontSize}px`)
    document.documentElement.style.setProperty('--app-line-height', `${db.settings.theme.lineHeight}`)

    const family =
      db.settings.theme.fontFamily === 'fira'
        ? `'Fira Code', monospace`
        : db.settings.theme.fontFamily === 'jetbrains'
          ? `'JetBrains Mono', monospace`
          : db.settings.theme.fontFamily === 'sf-pro'
            ? `'SF Pro Text', 'SF Pro Display', sans-serif`
            : `Inter, system-ui, sans-serif`

    document.documentElement.style.setProperty('--app-font-family', family)
  }, [db.settings.theme])

  const applyMutation = (mutator: (draft: AppDatabase) => void, change?: SyncChange) => {
    setDb((previous) => {
      const draft = structuredClone(previous)
      mutator(draft)
      if (change) {
        draft.syncChanges.push(change)
      }
      return draft
    })
  }

  const updateSettings = (mutator: (settings: AppDatabase['settings']) => void) => {
    applyMutation(
      (draft) => {
        mutator(draft.settings)
      },
      {
        id: createId(),
        entity: 'settings',
        entityId: 'settings',
        operation: 'update',
        payload: { timestamp: nowIso() },
        timestamp: nowIso(),
        version: Date.now(),
      },
    )
  }

  const activePrompt = useMemo(
    () => db.prompts.find((entry) => entry.id === selectedPromptId && !entry.isDeleted) ?? null,
    [db.prompts, selectedPromptId],
  )

  const promptVersions = useMemo(
    () =>
      db.promptVersions
        .filter((entry) => entry.promptId === selectedPromptId)
        .sort((a, b) => b.versionNumber - a.versionNumber),
    [db.promptVersions, selectedPromptId],
  )

  const activeVersion = useMemo(() => {
    const explicit = db.promptVersions.find((entry) => entry.id === selectedVersionId)
    return explicit ?? promptVersions[0] ?? null
  }, [db.promptVersions, promptVersions, selectedVersionId])

  useEffect(() => {
    if (!activeVersion) return
    setLeftPane((previous) => ({ ...previous, provider: activeVersion.provider, model: activeVersion.model }))
  }, [activeVersion])

  const detectedVariables = useMemo(
    () => parseVariables(activeVersion?.userPromptTemplate ?? ''),
    [activeVersion?.userPromptTemplate],
  )

  const runDiff = useMemo(() => diffByLine(leftPane.output, rightPane.output), [leftPane.output, rightPane.output])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (eventMatchesShortcut(event, db.settings.keybindings.commandPalette)) {
        event.preventDefault()
        setCommandPaletteOpen((open) => !open)
        return
      }

      if (eventMatchesShortcut(event, db.settings.keybindings.savePrompt)) {
        event.preventDefault()
        saveVersion()
        return
      }

      if (eventMatchesShortcut(event, db.settings.keybindings.runPrompt)) {
        event.preventDefault()
        void runBothPanes()
      }
    }

    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })

  const filteredCommands = useMemo(() => {
    const fixedActions = [
      { label: 'Create prompt', action: () => createPrompt() },
      {
        label: 'Toggle theme',
        action: () =>
          updateSettings((settings) => {
            settings.theme.mode = settings.theme.mode === 'dark' ? 'light' : 'dark'
          }),
      },
      { label: 'Run prompt', action: () => void runBothPanes() },
      { label: 'Sync now', action: () => void syncNow() },
    ]

    const promptActions = db.prompts
      .filter((entry) => !entry.isDeleted)
      .map((entry) => ({
        label: `Open prompt: ${entry.title}`,
        action: () => {
          setSelectedPromptId(entry.id)
          const latest = db.promptVersions
            .filter((version) => version.promptId === entry.id)
            .sort((a, b) => b.versionNumber - a.versionNumber)[0]
          setSelectedVersionId(latest?.id ?? '')
        },
      }))

    return [...fixedActions, ...promptActions].filter((entry) =>
      entry.label.toLowerCase().includes(commandQuery.toLowerCase().trim()),
    )
  }, [commandQuery, db.promptVersions, db.prompts])

  const updateActivePrompt = (mutator: (prompt: PromptRecord) => void) => {
    if (!activePrompt) return

    applyMutation(
      (draft) => {
        const target = draft.prompts.find((entry) => entry.id === activePrompt.id)
        if (!target) return
        mutator(target)
        target.updatedAt = nowIso()
      },
      {
        id: createId(),
        entity: 'prompts',
        entityId: activePrompt.id,
        operation: 'update',
        payload: { updatedAt: nowIso() },
        timestamp: nowIso(),
        version: Date.now(),
      },
    )
  }

  const updateActiveVersion = (mutator: (version: PromptVersionRecord) => void) => {
    if (!activeVersion) return

    applyMutation(
      (draft) => {
        const target = draft.promptVersions.find((entry) => entry.id === activeVersion.id)
        if (!target) return
        mutator(target)
      },
      {
        id: createId(),
        entity: 'promptVersions',
        entityId: activeVersion.id,
        operation: 'update',
        payload: { timestamp: nowIso() },
        timestamp: nowIso(),
        version: Date.now(),
      },
    )
  }

  const createPrompt = () => {
    const timestamp = nowIso()
    const promptId = createId()
    const versionId = createId()

    const prompt: PromptRecord = {
      id: promptId,
      title: `Untitled Prompt ${db.prompts.length + 1}`,
      description: '',
      folderId: null,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
      version: 1,
    }

    const version: PromptVersionRecord = {
      id: versionId,
      promptId,
      versionNumber: 1,
      systemPrompt: db.settings.globalSystemPrompt,
      userPromptTemplate: 'Summarize {{context}} for {{audience}} in {{tone}} tone.',
      hyperparameters: { ...db.settings.defaults },
      provider: 'openai',
      model: 'gpt-4o-mini',
      commitMessage: 'Initial version',
      createdAt: timestamp,
    }

    applyMutation(
      (draft) => {
        draft.prompts.push(prompt)
        draft.promptVersions.push(version)
      },
      {
        id: createId(),
        entity: 'prompts',
        entityId: promptId,
        operation: 'insert',
        payload: prompt,
        timestamp,
        version: Date.now(),
      },
    )

    setSelectedPromptId(promptId)
    setSelectedVersionId(versionId)
    setActiveTab('playground')
  }

  const saveVersion = () => {
    if (!activePrompt || !activeVersion) return

    const timestamp = nowIso()
    const next =
      Math.max(
        ...db.promptVersions
          .filter((entry) => entry.promptId === activePrompt.id)
          .map((entry) => entry.versionNumber),
      ) + 1

    const version: PromptVersionRecord = {
      ...activeVersion,
      id: createId(),
      versionNumber: next,
      commitMessage: commitMessage.trim() || `Version ${next}`,
      createdAt: timestamp,
    }

    applyMutation(
      (draft) => {
        const prompt = draft.prompts.find((entry) => entry.id === activePrompt.id)
        if (prompt) {
          prompt.version = next
          prompt.updatedAt = timestamp
        }
        draft.promptVersions.push(version)
      },
      {
        id: createId(),
        entity: 'promptVersions',
        entityId: version.id,
        operation: 'insert',
        payload: version,
        timestamp,
        version: Date.now(),
      },
    )

    setSelectedVersionId(version.id)
    setCommitMessage('')
  }

  const rollbackToVersion = (version: PromptVersionRecord) => {
    if (!activePrompt || !activeVersion) return
    const timestamp = nowIso()
    const next =
      Math.max(
        ...db.promptVersions
          .filter((entry) => entry.promptId === activePrompt.id)
          .map((entry) => entry.versionNumber),
      ) + 1

    const rollback: PromptVersionRecord = {
      ...version,
      id: createId(),
      versionNumber: next,
      commitMessage: `Rollback to v${version.versionNumber}`,
      createdAt: timestamp,
    }

    applyMutation(
      (draft) => {
        const prompt = draft.prompts.find((entry) => entry.id === activePrompt.id)
        if (prompt) {
          prompt.version = next
          prompt.updatedAt = timestamp
        }
        draft.promptVersions.push(rollback)
      },
      {
        id: createId(),
        entity: 'promptVersions',
        entityId: rollback.id,
        operation: 'insert',
        payload: rollback,
        timestamp,
        version: Date.now(),
      },
    )

    setSelectedVersionId(rollback.id)
  }

  const saveCredential = async (
    provider: ProviderId,
    key: string,
    endpoint: string,
    customModelId: string,
  ) => {
    if (provider !== 'ollama' && !key.trim()) {
      throw new Error('API key required for this provider')
    }
    if (!masterPassword.trim()) {
      throw new Error('Master password required to encrypt keys')
    }

    const encrypted = await encryptWithPassword(key, masterPassword, db.settings.salt)

    applyMutation(
      (draft) => {
        const existing = draft.providerCredentials.find((entry) => entry.provider === provider)
        if (existing) {
          existing.encryptedKey = encrypted.encrypted
          existing.keyIv = encrypted.iv
          existing.endpoint = endpoint
          existing.customModelId = customModelId
          return
        }

        draft.providerCredentials.push({
          provider,
          encryptedKey: encrypted.encrypted,
          keyIv: encrypted.iv,
          endpoint,
          customModelId,
        })
      },
      {
        id: createId(),
        entity: 'settings',
        entityId: provider,
        operation: 'update',
        payload: { provider },
        timestamp: nowIso(),
        version: Date.now(),
      },
    )
  }

  const getApiKey = async (provider: ProviderId) => {
    if (provider === 'ollama') return ''

    const credential = db.providerCredentials.find((entry) => entry.provider === provider)
    if (!credential) {
      throw new Error(`No API key configured for ${provider}`)
    }

    if (!masterPassword.trim()) {
      throw new Error('Enter master password to decrypt provider keys')
    }

    return decryptWithPassword(
      credential.encryptedKey,
      credential.keyIv,
      masterPassword,
      db.settings.salt,
    )
  }

  const runPane = async (
    side: 'left' | 'right',
    pane: PlaygroundPaneState,
    setPane: Dispatch<SetStateAction<PlaygroundPaneState>>,
    paneVars: Record<string, string>,
  ) => {
    if (!activePrompt || !activeVersion) return

    const mergedVars: Record<string, string> = {}
    for (const key of detectedVariables) {
      const globalValue = db.variables.find((entry) => entry.key === key && !entry.isDeleted)?.value ?? ''
      mergedVars[key] = paneVars[key] ?? globalValue
    }

    if (!mergedVars.current_date) mergedVars.current_date = new Date().toISOString().slice(0, 10)
    if (!mergedVars.current_time) mergedVars.current_time = new Date().toLocaleTimeString()

    const userPrompt = compilePromptTemplate(activeVersion.userPromptTemplate, mergedVars)
    const systemPrompt = activeVersion.systemPrompt || db.settings.globalSystemPrompt || 'You are a helpful assistant.'

    const credential = db.providerCredentials.find((entry) => entry.provider === pane.provider)
    const endpoint =
      db.settings.proxyByProvider[pane.provider] ||
      credential?.endpoint ||
      PROVIDERS.find((entry) => entry.id === pane.provider)?.defaultEndpoint ||
      ''

    setPane((previous) => ({ ...previous, loading: true, output: '', error: '' }))

    try {
      const apiKey = await getApiKey(pane.provider)
      const result = await executePrompt({
        provider: pane.provider,
        model: pane.model,
        apiKey,
        endpoint,
        systemPrompt,
        userPrompt,
        hyperparameters: activeVersion.hyperparameters,
        onToken: (token) => {
          setPane((previous) => ({ ...previous, output: previous.output + token }))
        },
      })

      const costUsd = estimateCostUsd(pane.provider, pane.model, result.inputTokens, result.outputTokens)
      setPane((previous) => ({
        ...previous,
        output: result.output,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
      }))

      const run: PromptRunRecord = {
        id: createId(),
        promptId: activePrompt.id,
        promptVersionId: activeVersion.id,
        provider: pane.provider,
        model: pane.model,
        variables: mergedVars,
        compiledPrompt: userPrompt,
        output: result.output,
        createdAt: nowIso(),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
      }

      applyMutation(
        (draft) => {
          draft.runs.unshift(run)
        },
        {
          id: createId(),
          entity: 'runs',
          entityId: run.id,
          operation: 'insert',
          payload: { side, runId: run.id },
          timestamp: nowIso(),
          version: Date.now(),
        },
      )
    } catch (error) {
      setPane((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : 'Execution failed',
      }))
    } finally {
      setPane((previous) => ({ ...previous, loading: false }))
    }
  }

  const runBothPanes = async () => {
    await Promise.all([
      runPane('left', leftPane, setLeftPane, leftVariables),
      runPane('right', rightPane, setRightPane, rightVariables),
    ])
  }

  const refreshModels = async (provider: ProviderId) => {
    const credential = db.providerCredentials.find((entry) => entry.provider === provider)
    const endpoint =
      db.settings.proxyByProvider[provider] ||
      credential?.endpoint ||
      PROVIDERS.find((entry) => entry.id === provider)?.defaultEndpoint ||
      ''

    const apiKey = provider === 'ollama' ? '' : await getApiKey(provider)
    const fallback = [...ANTHROPIC_FALLBACK, ...(credential?.customModelId ? [credential.customModelId] : [])]
    const models = await discoverModels(provider, apiKey, endpoint, fallback)

    updateSettings((settings) => {
      settings.cachedModels[provider] = models
      settings.lastModelRefreshAt = nowIso()
    })
  }

  const syncNow = async () => {
    if (isOffline) {
      setSyncStatus('Offline. Sync paused.')
      return
    }

    if (!db.settings.syncEndpoint.trim()) {
      setSyncStatus('Sync endpoint missing.')
      return
    }

    if (!masterPassword.trim()) {
      setSyncStatus('Master password required for E2EE sync.')
      return
    }

    setSyncStatus('Syncing...')

    try {
      const encryptedPayload = await encryptWithPassword(
        JSON.stringify({ changes: db.syncChanges }),
        masterPassword,
        db.settings.salt,
      )

      const push = await fetch(`${db.settings.syncEndpoint}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(encryptedPayload),
      })

      if (!push.ok) throw new Error(await push.text())

      const pull = await fetch(`${db.settings.syncEndpoint}/pull`)
      if (!pull.ok) throw new Error(await pull.text())

      const remote = (await pull.json()) as { encrypted: string; iv: string }
      const decrypted = await decryptWithPassword(
        remote.encrypted,
        remote.iv,
        masterPassword,
        db.settings.salt,
      )

      const payload = JSON.parse(decrypted) as { promptVersions?: PromptVersionRecord[] }
      const conflicts: SyncConflict[] = []

      applyMutation((draft) => {
        for (const incoming of payload.promptVersions ?? []) {
          const existing = draft.promptVersions.find(
            (entry) =>
              entry.promptId === incoming.promptId && entry.versionNumber === incoming.versionNumber,
          )

          if (!existing) {
            draft.promptVersions.push(incoming)
            continue
          }

          if (existing.userPromptTemplate !== incoming.userPromptTemplate) {
            conflicts.push({
              id: createId(),
              promptId: incoming.promptId,
              versionNumber: incoming.versionNumber,
              localTemplate: existing.userPromptTemplate,
              remoteTemplate: incoming.userPromptTemplate,
            })
          }
        }

        draft.syncChanges = []
        draft.syncMetadata[0] = {
          tableName: 'global',
          lastSyncedRowVersion: Date.now(),
          lastSyncedAt: nowIso(),
        }
      })

      setSyncConflicts(conflicts)
      setSyncStatus('Sync complete')
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Sync failed')
    }
  }

  const resolveConflict = (conflict: SyncConflict, strategy: 'local' | 'remote' | 'merged') => {
    const template =
      strategy === 'local'
        ? conflict.localTemplate
        : strategy === 'remote'
          ? conflict.remoteTemplate
          : `${conflict.localTemplate}\n\n${conflict.remoteTemplate}`

    applyMutation((draft) => {
      const versions = draft.promptVersions.filter((entry) => entry.promptId === conflict.promptId)
      const current = Math.max(...versions.map((entry) => entry.versionNumber))
      const source = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0]
      const hyperparameters: Hyperparameters = source?.hyperparameters ?? db.settings.defaults

      draft.promptVersions.push({
        id: createId(),
        promptId: conflict.promptId,
        versionNumber: current + 1,
        systemPrompt: source?.systemPrompt ?? '',
        userPromptTemplate: template,
        hyperparameters,
        provider: source?.provider ?? 'openai',
        model: source?.model ?? 'gpt-4o-mini',
        commitMessage: `Conflict resolution (${strategy})`,
        createdAt: nowIso(),
      })
    })

    setSyncConflicts((previous) => previous.filter((entry) => entry.id !== conflict.id))
  }

  const onTemplateKeyUp = (value: string, cursor: number) => {
    const before = value.slice(0, cursor)
    const slashStart = before.lastIndexOf('/')
    if (slashStart === -1) {
      setSlashOpen(false)
      return
    }

    const candidate = before.slice(slashStart)
    if (/\s/.test(candidate)) {
      setSlashOpen(false)
      return
    }

    setSlashRange({ start: slashStart, end: cursor })
    setSlashQuery(candidate.slice(1))
    setSlashOpen(true)
  }

  const visibleSlashCommands = SLASH_COMMANDS.filter((entry) =>
    entry.label.toLowerCase().includes(`/${slashQuery.toLowerCase()}`),
  )

  const insertSlashCommand = (snippet: string) => {
    if (!activeVersion) return
    const template = activeVersion.userPromptTemplate
    const merged = `${template.slice(0, slashRange.start)}${snippet}${template.slice(slashRange.end)}`

    updateActiveVersion((version) => {
      version.userPromptTemplate = merged
    })

    setSlashOpen(false)
    setSlashQuery('')
  }

  const createFolder = () => {
    const name = window.prompt('Folder name')?.trim()
    if (!name) return
    const timestamp = nowIso()

    const folder = {
      id: createId(),
      name,
      parentId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    }

    applyMutation(
      (draft) => {
        draft.folders.push(folder)
      },
      {
        id: createId(),
        entity: 'folders',
        entityId: folder.id,
        operation: 'insert',
        payload: folder,
        timestamp,
        version: Date.now(),
      },
    )
  }

  const createVariable = () => {
    const key = window.prompt('Variable key')?.trim()
    if (!key) return
    const value = window.prompt('Variable value') ?? ''
    const timestamp = nowIso()

    const variable = {
      id: createId(),
      key,
      value,
      description: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    }

    applyMutation(
      (draft) => {
        draft.variables.push(variable)
      },
      {
        id: createId(),
        entity: 'variables',
        entityId: variable.id,
        operation: 'insert',
        payload: variable,
        timestamp,
        version: Date.now(),
      },
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>PromptCraft</h1>
          <p className="subtitle">
            Local-first prompt workspace · {isOffline ? 'Offline' : 'Online'} · {syncStatus}
          </p>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={createPrompt}>
            New Prompt
          </button>
          <button type="button" onClick={() => setCommandPaletteOpen(true)}>
            Command Palette ({normalizeShortcut(db.settings.keybindings.commandPalette)})
          </button>
          <button type="button" onClick={() => void syncNow()}>
            Sync
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar left">
          <h2>Prompts</h2>
          <ul className="list">
            {db.prompts
              .filter((entry) => !entry.isDeleted)
              .map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={entry.id === selectedPromptId ? 'active' : ''}
                    onClick={() => {
                      setSelectedPromptId(entry.id)
                      const latest = db.promptVersions
                        .filter((version) => version.promptId === entry.id)
                        .sort((a, b) => b.versionNumber - a.versionNumber)[0]
                      setSelectedVersionId(latest?.id ?? '')
                    }}
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
          </ul>

          <h3>Folders</h3>
          <ul className="list compact">
            {db.folders.filter((entry) => !entry.isDeleted).map((entry) => (
              <li key={entry.id}>{entry.name}</li>
            ))}
          </ul>
          <button type="button" onClick={createFolder}>
            Add Folder
          </button>
        </aside>

        <main className="content">
          <section className="tabs">
            {(['playground', 'history', 'settings'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={activeTab === tab ? 'active' : ''}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </section>

          {activePrompt && activeVersion ? (
            <>
              <section className="editor-card">
                <input
                  className="input title"
                  value={activePrompt.title}
                  onChange={(event) => updateActivePrompt((prompt) => (prompt.title = event.target.value))}
                />
                <textarea
                  className="input"
                  rows={2}
                  value={activePrompt.description}
                  placeholder="Description"
                  onChange={(event) =>
                    updateActivePrompt((prompt) => {
                      prompt.description = event.target.value
                    })
                  }
                />
                <div className="grid two">
                  <textarea
                    className="input"
                    rows={4}
                    value={activeVersion.systemPrompt}
                    placeholder="System prompt"
                    onChange={(event) =>
                      updateActiveVersion((version) => {
                        version.systemPrompt = event.target.value
                      })
                    }
                  />
                  <textarea
                    className="input"
                    rows={6}
                    value={activeVersion.userPromptTemplate}
                    placeholder="Prompt template with {{variables}}"
                    onChange={(event) =>
                      updateActiveVersion((version) => {
                        version.userPromptTemplate = event.target.value
                      })
                    }
                    onKeyUp={(event) =>
                      onTemplateKeyUp(event.currentTarget.value, event.currentTarget.selectionStart)
                    }
                  />
                </div>

                {slashOpen && visibleSlashCommands.length > 0 ? (
                  <div className="slash-menu">
                    {visibleSlashCommands.map((entry) => (
                      <button key={entry.label} type="button" onClick={() => insertSlashCommand(entry.value)}>
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="grid four">
                  <label>
                    Temperature
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={activeVersion.hyperparameters.temperature}
                      onChange={(event) =>
                        updateActiveVersion((version) => {
                          version.hyperparameters.temperature = Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label>
                    Top-P
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={activeVersion.hyperparameters.topP}
                      onChange={(event) =>
                        updateActiveVersion((version) => {
                          version.hyperparameters.topP = Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label>
                    Frequency Penalty
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={activeVersion.hyperparameters.frequencyPenalty}
                      onChange={(event) =>
                        updateActiveVersion((version) => {
                          version.hyperparameters.frequencyPenalty = Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label>
                    Max Tokens
                    <input
                      className="input"
                      type="number"
                      step="1"
                      value={activeVersion.hyperparameters.maxTokens}
                      onChange={(event) =>
                        updateActiveVersion((version) => {
                          version.hyperparameters.maxTokens = Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>

                <div className="commit-row">
                  <input
                    className="input"
                    placeholder="Commit message"
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                  />
                  <button type="button" onClick={saveVersion}>
                    Save Version ({normalizeShortcut(db.settings.keybindings.savePrompt)})
                  </button>
                </div>
              </section>

              {activeTab === 'playground' ? (
                <section className="playground">
                  <div
                    className="split"
                    style={{
                      gridTemplateColumns: `${db.settings.layout.splitRatio * 100}% ${(1 - db.settings.layout.splitRatio) * 100}%`,
                    }}
                  >
                    <PlaygroundPane
                      title="Left Run"
                      pane={leftPane}
                      setPane={setLeftPane}
                      variables={leftVariables}
                      onVariablesChange={setLeftVariables}
                      detectedVariables={detectedVariables}
                      globalVariables={db.variables}
                      cachedModels={db.settings.cachedModels}
                    />
                    <PlaygroundPane
                      title="Right Run"
                      pane={rightPane}
                      setPane={setRightPane}
                      variables={rightVariables}
                      onVariablesChange={setRightVariables}
                      detectedVariables={detectedVariables}
                      globalVariables={db.variables}
                      cachedModels={db.settings.cachedModels}
                    />
                  </div>
                  <button className="run-button" type="button" onClick={() => void runBothPanes()}>
                    Run Both ({normalizeShortcut(db.settings.keybindings.runPrompt)})
                  </button>
                  <section className="diff-card">
                    <h3>Output Diff</h3>
                    <div className="diff-grid">
                      {runDiff.map((line, index) => (
                        <div className={`diff-line ${line.state}`} key={index}>
                          <div>{line.left}</div>
                          <div>{line.right}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                </section>
              ) : null}

              {activeTab === 'history' ? (
                <section className="history">
                  <h3>Version History</h3>
                  <ul className="list">
                    {promptVersions.map((version) => (
                      <li key={version.id}>
                        <button
                          type="button"
                          className={version.id === activeVersion.id ? 'active' : ''}
                          onClick={() => setSelectedVersionId(version.id)}
                        >
                          v{version.versionNumber} · {version.commitMessage} ·{' '}
                          {new Date(version.createdAt).toLocaleString()}
                        </button>
                        <button type="button" onClick={() => rollbackToVersion(version)}>
                          Rollback
                        </button>
                      </li>
                    ))}
                  </ul>

                  <h3>Run History</h3>
                  <ul className="list">
                    {db.runs
                      .filter((entry) => entry.promptId === activePrompt.id)
                      .map((entry) => (
                        <li key={entry.id}>
                          <article>
                            <strong>
                              {entry.provider}/{entry.model}
                            </strong>
                            <p>{new Date(entry.createdAt).toLocaleString()}</p>
                            <p>
                              in: {entry.inputTokens} · out: {entry.outputTokens} · ${entry.costUsd}
                            </p>
                          </article>
                        </li>
                      ))}
                  </ul>
                </section>
              ) : null}

              {activeTab === 'settings' ? (
                <section className="settings">
                  <h3>Credentials</h3>
                  <label>
                    Master Password (in-memory)
                    <input
                      type="password"
                      className="input"
                      value={masterPassword}
                      onChange={(event) => setMasterPassword(event.target.value)}
                    />
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={db.settings.requireMasterPassword}
                      onChange={(event) =>
                        updateSettings((settings) => {
                          settings.requireMasterPassword = event.target.checked
                        })
                      }
                    />
                    Require master password on startup
                  </label>

                  <div className="provider-grid">
                    {PROVIDERS.map((provider) => {
                      const credential = db.providerCredentials.find((entry) => entry.provider === provider.id)
                      return (
                        <ProviderCard
                          key={provider.id}
                          provider={provider.id}
                          title={provider.label}
                          defaultEndpoint={provider.defaultEndpoint}
                          existingEndpoint={credential?.endpoint ?? ''}
                          customModelId={credential?.customModelId ?? ''}
                          onSave={saveCredential}
                          onRefreshModels={refreshModels}
                          cachedModels={db.settings.cachedModels[provider.id] ?? []}
                          onProxyUpdate={(value) =>
                            updateSettings((settings) => {
                              settings.proxyByProvider[provider.id] = value
                            })
                          }
                          proxyValue={db.settings.proxyByProvider[provider.id] ?? ''}
                        />
                      )
                    })}
                  </div>

                  <h3>Theme & Layout</h3>
                  <div className="grid four">
                    <label>
                      Theme
                      <select
                        className="input"
                        value={db.settings.theme.mode}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.theme.mode = event.target.value as 'light' | 'dark' | 'system'
                          })
                        }
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="system">System</option>
                      </select>
                    </label>
                    <label>
                      Preset
                      <select
                        className="input"
                        value={db.settings.theme.colorPreset}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.theme.colorPreset = event.target.value as
                              | 'slate'
                              | 'emerald'
                              | 'violet'
                              | 'amber'
                          })
                        }
                      >
                        <option value="slate">Slate</option>
                        <option value="emerald">Emerald</option>
                        <option value="violet">Violet</option>
                        <option value="amber">Amber</option>
                      </select>
                    </label>
                    <label>
                      Font Family
                      <select
                        className="input"
                        value={db.settings.theme.fontFamily}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.theme.fontFamily = event.target.value as
                              | 'system'
                              | 'fira'
                              | 'jetbrains'
                              | 'sf-pro'
                          })
                        }
                      >
                        <option value="system">System</option>
                        <option value="fira">Fira Code</option>
                        <option value="jetbrains">JetBrains Mono</option>
                        <option value="sf-pro">SF Pro</option>
                      </select>
                    </label>
                    <label>
                      Split Ratio
                      <input
                        className="input"
                        type="number"
                        min={0.2}
                        max={0.8}
                        step={0.05}
                        value={db.settings.layout.splitRatio}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.layout.splitRatio = Number(event.target.value)
                          })
                        }
                      />
                    </label>
                  </div>

                  <h3>Keybindings</h3>
                  <div className="grid three">
                    <label>
                      Run
                      <input
                        className="input"
                        value={db.settings.keybindings.runPrompt}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.keybindings.runPrompt = normalizeShortcut(event.target.value)
                          })
                        }
                      />
                    </label>
                    <label>
                      Save
                      <input
                        className="input"
                        value={db.settings.keybindings.savePrompt}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.keybindings.savePrompt = normalizeShortcut(event.target.value)
                          })
                        }
                      />
                    </label>
                    <label>
                      Palette
                      <input
                        className="input"
                        value={db.settings.keybindings.commandPalette}
                        onChange={(event) =>
                          updateSettings((settings) => {
                            settings.keybindings.commandPalette = normalizeShortcut(event.target.value)
                          })
                        }
                      />
                    </label>
                  </div>

                  <h3>Sync</h3>
                  <label>
                    Sync Endpoint
                    <input
                      className="input"
                      value={db.settings.syncEndpoint}
                      onChange={(event) =>
                        updateSettings((settings) => {
                          settings.syncEndpoint = event.target.value
                        })
                      }
                    />
                  </label>

                  {syncConflicts.length > 0 ? (
                    <section className="conflicts">
                      <h4>Sync Conflicts</h4>
                      {syncConflicts.map((conflict) => (
                        <article key={conflict.id}>
                          <p>
                            Prompt {conflict.promptId} v{conflict.versionNumber}
                          </p>
                          <div className="conflict-content">
                            <pre>{conflict.localTemplate}</pre>
                            <pre>{conflict.remoteTemplate}</pre>
                          </div>
                          <div className="toolbar-actions">
                            <button type="button" onClick={() => resolveConflict(conflict, 'local')}>
                              Keep Local
                            </button>
                            <button type="button" onClick={() => resolveConflict(conflict, 'remote')}>
                              Keep Remote
                            </button>
                            <button type="button" onClick={() => resolveConflict(conflict, 'merged')}>
                              Merge
                            </button>
                          </div>
                        </article>
                      ))}
                    </section>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : (
            <section className="empty">
              <p>No prompt selected.</p>
              <button type="button" onClick={createPrompt}>
                Create Prompt
              </button>
            </section>
          )}
        </main>

        <aside className="sidebar right">
          <h2>Global Variables</h2>
          <ul className="list compact">
            {db.variables.filter((entry) => !entry.isDeleted).map((entry) => (
              <li key={entry.id}>
                <strong>{entry.key}</strong>
                <textarea
                  className="input"
                  rows={2}
                  value={entry.value}
                  onChange={(event) => {
                    const value = event.target.value
                    applyMutation(
                      (draft) => {
                        const target = draft.variables.find((item) => item.id === entry.id)
                        if (!target) return
                        target.value = value
                        target.updatedAt = nowIso()
                      },
                      {
                        id: createId(),
                        entity: 'variables',
                        entityId: entry.id,
                        operation: 'update',
                        payload: { key: entry.key },
                        timestamp: nowIso(),
                        version: Date.now(),
                      },
                    )
                  }}
                />
              </li>
            ))}
          </ul>
          <button type="button" onClick={createVariable}>
            Add Variable
          </button>
        </aside>
      </div>

      {commandPaletteOpen ? (
        <div className="palette-overlay" onClick={() => setCommandPaletteOpen(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              className="input"
              placeholder="Search commands"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
            />
            <ul className="list">
              {filteredCommands.map((entry) => (
                <li key={entry.label}>
                  <button
                    type="button"
                    onClick={() => {
                      entry.action()
                      setCommandPaletteOpen(false)
                    }}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface PlaygroundPaneProps {
  title: string
  pane: PlaygroundPaneState
  setPane: Dispatch<SetStateAction<PlaygroundPaneState>>
  variables: Record<string, string>
  onVariablesChange: Dispatch<SetStateAction<Record<string, string>>>
  detectedVariables: string[]
  globalVariables: AppDatabase['variables']
  cachedModels: AppDatabase['settings']['cachedModels']
}

function PlaygroundPane({
  title,
  pane,
  setPane,
  variables,
  onVariablesChange,
  detectedVariables,
  globalVariables,
  cachedModels,
}: PlaygroundPaneProps) {
  const modelOptions = [...(cachedModels[pane.provider] ?? []), pane.model].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  )

  return (
    <article className="pane">
      <h3>{title}</h3>
      <div className="grid two">
        <label>
          Provider
          <select
            className="input"
            value={pane.provider}
            onChange={(event) =>
              setPane((previous) => ({ ...previous, provider: event.target.value as ProviderId }))
            }
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input
            className="input"
            list={`${title}-models`}
            value={pane.model}
            onChange={(event) => setPane((previous) => ({ ...previous, model: event.target.value }))}
          />
          <datalist id={`${title}-models`}>
            {modelOptions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
      </div>
      <h4>Variables</h4>
      <div className="vars">
        {detectedVariables.map((variable) => {
          const globalValue = globalVariables.find((entry) => entry.key === variable && !entry.isDeleted)?.value ?? ''
          const value = variables[variable] ?? globalValue
          return (
            <label key={variable}>
              {variable}
              <textarea
                className="input"
                rows={2}
                value={value}
                onChange={(event) =>
                  onVariablesChange((previous) => ({ ...previous, [variable]: event.target.value }))
                }
              />
            </label>
          )
        })}
      </div>
      <h4>Output</h4>
      <pre className="output">{pane.output}</pre>
      {pane.error ? <p className="error">{pane.error}</p> : null}
      <p className="metrics">
        Status: {pane.loading ? 'Running...' : 'Idle'} · input: {pane.inputTokens} · output:{' '}
        {pane.outputTokens} · cost: ${pane.costUsd}
      </p>
    </article>
  )
}

interface ProviderCardProps {
  provider: ProviderId
  title: string
  defaultEndpoint: string
  existingEndpoint: string
  customModelId: string
  proxyValue: string
  onSave: (
    provider: ProviderId,
    key: string,
    endpoint: string,
    customModelId: string,
  ) => Promise<void>
  onRefreshModels: (provider: ProviderId) => Promise<void>
  cachedModels: string[]
  onProxyUpdate: (value: string) => void
}

function ProviderCard({
  provider,
  title,
  defaultEndpoint,
  existingEndpoint,
  customModelId,
  onSave,
  onRefreshModels,
  cachedModels,
  onProxyUpdate,
  proxyValue,
}: ProviderCardProps) {
  const [key, setKey] = useState('')
  const [endpoint, setEndpoint] = useState(existingEndpoint || defaultEndpoint)
  const [customModel, setCustomModel] = useState(customModelId)
  const [status, setStatus] = useState('')

  return (
    <article className="provider-card">
      <h4>{title}</h4>
      <label>
        API Key
        <input
          className="input"
          type="password"
          placeholder={provider === 'ollama' ? '(optional)' : 'Required'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <label>
        Endpoint
        <input className="input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
      </label>
      <label>
        Custom Model
        <input
          className="input"
          value={customModel}
          onChange={(event) => setCustomModel(event.target.value)}
        />
      </label>
      <label>
        Proxy Endpoint
        <input
          className="input"
          value={proxyValue}
          onChange={(event) => onProxyUpdate(event.target.value)}
        />
      </label>
      <div className="toolbar-actions">
        <button
          type="button"
          onClick={async () => {
            try {
              await onSave(provider, key, endpoint, customModel)
              setStatus('Saved')
              setKey('')
            } catch (error) {
              setStatus(error instanceof Error ? error.message : 'Save failed')
            }
          }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await onRefreshModels(provider)
              setStatus('Model list refreshed')
            } catch (error) {
              setStatus(error instanceof Error ? error.message : 'Refresh failed')
            }
          }}
        >
          Refresh Models
        </button>
      </div>
      <p>{status}</p>
      {cachedModels.length > 0 ? (
        <ul className="list compact">
          {cachedModels.slice(0, 10).map((model) => (
            <li key={model}>{model}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

export default App
