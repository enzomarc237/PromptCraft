import { DEFAULT_HYPERPARAMETERS, createId, createSalt, nowIso } from './utils'
import type { AppDatabase, PromptRecord, PromptVersionRecord } from './types'

const DB_KEY = 'promptcraft-db'

const DEFAULT_DB = (): AppDatabase => {
  const createdAt = nowIso()
  const promptId = createId()
  const versionId = createId()

  const starterPrompt: PromptRecord = {
    id: promptId,
    title: 'PromptCraft Starter',
    description: 'Default starter prompt',
    folderId: null,
    tags: ['starter'],
    createdAt,
    updatedAt: createdAt,
    isDeleted: false,
    version: 1,
  }

  const starterVersion: PromptVersionRecord = {
    id: versionId,
    promptId,
    versionNumber: 1,
    systemPrompt: 'You are a precise and helpful assistant.',
    userPromptTemplate:
      'Summarize the following context for {{audience}} with a {{tone}} tone:\n\n{{context}}',
    hyperparameters: { ...DEFAULT_HYPERPARAMETERS },
    provider: 'openai',
    model: 'gpt-4o-mini',
    commitMessage: 'Initial version',
    createdAt,
  }

  return {
    prompts: [starterPrompt],
    promptVersions: [starterVersion],
    folders: [],
    variables: [
      {
        id: createId(),
        key: 'audience',
        value: 'engineering team',
        description: 'Who should receive the output',
        createdAt,
        updatedAt: createdAt,
        isDeleted: false,
      },
      {
        id: createId(),
        key: 'tone',
        value: 'concise',
        description: 'Desired writing style',
        createdAt,
        updatedAt: createdAt,
        isDeleted: false,
      },
      {
        id: createId(),
        key: 'context',
        value: 'PromptCraft is a local-first prompt management application.',
        description: 'Input context',
        createdAt,
        updatedAt: createdAt,
        isDeleted: false,
      },
    ],
    runs: [],
    syncChanges: [],
    syncMetadata: [
      {
        tableName: 'global',
        lastSyncedRowVersion: 0,
        lastSyncedAt: createdAt,
      },
    ],
    providerCredentials: [],
    settings: {
      defaults: { ...DEFAULT_HYPERPARAMETERS },
      globalSystemPrompt: '',
      theme: {
        mode: 'system',
        colorPreset: 'slate',
        fontFamily: 'system',
        fontSize: 15,
        lineHeight: 1.5,
      },
      layout: {
        leftSidebarVisible: true,
        rightSidebarVisible: true,
        splitRatio: 0.5,
      },
      keybindings: {
        runPrompt: 'ctrl+enter',
        savePrompt: 'ctrl+s',
        commandPalette: 'ctrl+k',
      },
      syncEndpoint: '',
      requireMasterPassword: false,
      salt: createSalt(),
      proxyByProvider: {},
      lastModelRefreshAt: null,
      cachedModels: {},
    },
  }
}

export const loadDatabase = (): AppDatabase => {
  const raw = globalThis.localStorage.getItem(DB_KEY)
  if (!raw) {
    const seeded = DEFAULT_DB()
    persistDatabase(seeded)
    return seeded
  }

  try {
    const parsed = JSON.parse(raw) as AppDatabase
    return parsed
  } catch {
    const seeded = DEFAULT_DB()
    persistDatabase(seeded)
    return seeded
  }
}

export const persistDatabase = (database: AppDatabase) => {
  globalThis.localStorage.setItem(DB_KEY, JSON.stringify(database))
}
