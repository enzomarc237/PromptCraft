export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'ollama'

export interface Hyperparameters {
  temperature: number
  topP: number
  frequencyPenalty: number
  maxTokens: number
}

export interface PromptRecord {
  id: string
  title: string
  description: string
  folderId: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  version: number
}

export interface PromptVersionRecord {
  id: string
  promptId: string
  versionNumber: number
  systemPrompt: string
  userPromptTemplate: string
  hyperparameters: Hyperparameters
  provider: ProviderId
  model: string
  commitMessage: string
  createdAt: string
}

export interface FolderRecord {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface VariableRecord {
  id: string
  key: string
  value: string
  description: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface PromptRunRecord {
  id: string
  promptId: string
  promptVersionId: string
  provider: ProviderId
  model: string
  variables: Record<string, string>
  compiledPrompt: string
  output: string
  createdAt: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface SyncChange {
  id: string
  entity:
    | 'prompts'
    | 'promptVersions'
    | 'folders'
    | 'variables'
    | 'runs'
    | 'settings'
  entityId: string
  operation: 'insert' | 'update' | 'delete'
  payload: unknown
  timestamp: string
  version: number
}

export interface SyncMetadataRecord {
  tableName: string
  lastSyncedRowVersion: number
  lastSyncedAt: string
}

export interface ProviderCredential {
  provider: ProviderId
  encryptedKey: string
  keyIv: string
  endpoint: string
  customModelId: string
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'system'
  colorPreset: 'slate' | 'emerald' | 'violet' | 'amber'
  fontFamily: 'system' | 'fira' | 'jetbrains' | 'sf-pro'
  fontSize: number
  lineHeight: number
}

export interface LayoutSettings {
  leftSidebarVisible: boolean
  rightSidebarVisible: boolean
  splitRatio: number
}

export interface Keybindings {
  runPrompt: string
  savePrompt: string
  commandPalette: string
}

export interface AppSettings {
  defaults: Hyperparameters
  globalSystemPrompt: string
  theme: ThemeSettings
  layout: LayoutSettings
  keybindings: Keybindings
  syncEndpoint: string
  requireMasterPassword: boolean
  salt: string
  proxyByProvider: Partial<Record<ProviderId, string>>
  lastModelRefreshAt: string | null
  cachedModels: Partial<Record<ProviderId, string[]>>
}

export interface AppDatabase {
  prompts: PromptRecord[]
  promptVersions: PromptVersionRecord[]
  folders: FolderRecord[]
  variables: VariableRecord[]
  runs: PromptRunRecord[]
  syncChanges: SyncChange[]
  syncMetadata: SyncMetadataRecord[]
  providerCredentials: ProviderCredential[]
  settings: AppSettings
}

export interface ExecutionRequest {
  provider: ProviderId
  model: string
  apiKey: string
  endpoint: string
  systemPrompt: string
  userPrompt: string
  hyperparameters: Hyperparameters
  onToken: (token: string) => void
}

export interface ExecutionResult {
  output: string
  inputTokens: number
  outputTokens: number
}
