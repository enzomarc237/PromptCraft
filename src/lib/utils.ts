import type { Hyperparameters } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const DEFAULT_HYPERPARAMETERS: Hyperparameters = {
  temperature: 0.7,
  topP: 1,
  frequencyPenalty: 0,
  maxTokens: 1000,
}

export const nowIso = () => new Date().toISOString()

export const createId = () => {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return random
}

export const parseVariables = (template: string): string[] => {
  const matches = template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)
  const unique = new Set<string>()

  for (const match of matches) {
    if (match[1]) {
      unique.add(match[1])
    }
  }

  return [...unique]
}

export const compilePromptTemplate = (
  template: string,
  variables: Record<string, string>,
) => {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return variables[key] ?? ''
  })
}

export const tokenizeApprox = (input: string) => Math.ceil(input.length / 4)

export const estimateCostUsd = (
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
) => {
  const normalized = `${provider}:${model}`.toLowerCase()

  const rate = (() => {
    if (normalized.includes('gpt-4') || normalized.includes('claude-opus')) {
      return { in: 0.01 / 1000, out: 0.03 / 1000 }
    }

    if (normalized.includes('sonnet') || normalized.includes('gpt-4o')) {
      return { in: 0.003 / 1000, out: 0.015 / 1000 }
    }

    return { in: 0.0015 / 1000, out: 0.002 / 1000 }
  })()

  return Number((inputTokens * rate.in + outputTokens * rate.out).toFixed(6))
}

export const diffByLine = (leftText: string, rightText: string) => {
  const left = leftText.split('\n')
  const right = rightText.split('\n')
  const max = Math.max(left.length, right.length)

  return Array.from({ length: max }, (_, index) => {
    const l = left[index] ?? ''
    const r = right[index] ?? ''

    return {
      left: l,
      right: r,
      state: l === r ? 'same' : l === '' ? 'added' : r === '' ? 'removed' : 'changed',
    }
  })
}

export const bufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

export const base64ToBuffer = (value: string) => {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

export const createSalt = () => {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return bufferToBase64(salt.buffer)
}

const deriveAesKey = async (password: string, saltBase64: string) => {
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(base64ToBuffer(saltBase64)),
      iterations: 250000,
      hash: 'SHA-256',
    },
    material,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

export const encryptWithPassword = async (
  rawText: string,
  password: string,
  salt: string,
) => {
  const key = await deriveAesKey(password, salt)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(rawText),
  )

  return {
    encrypted: bufferToBase64(encrypted),
    iv: bufferToBase64(iv.buffer),
  }
}

export const decryptWithPassword = async (
  encryptedText: string,
  ivBase64: string,
  password: string,
  salt: string,
) => {
  const key = await deriveAesKey(password, salt)
  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(base64ToBuffer(ivBase64)),
    },
    key,
    base64ToBuffer(encryptedText),
  )

  return decoder.decode(decrypted)
}

export const normalizeShortcut = (value: string) => {
  const sanitized = value
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)

  const ordered = [
    ...sanitized.filter((part) => ['ctrl', 'meta', 'shift', 'alt'].includes(part)),
    ...sanitized.filter((part) => !['ctrl', 'meta', 'shift', 'alt'].includes(part)),
  ]

  return ordered.join('+')
}

export const eventMatchesShortcut = (event: KeyboardEvent, shortcut: string) => {
  const normalized = normalizeShortcut(shortcut)
  if (!normalized) return false

  const parts = normalized.split('+')
  const key = parts.at(-1)

  if (!key) return false

  const requiresCtrl = parts.includes('ctrl')
  const requiresMeta = parts.includes('meta')
  const requiresShift = parts.includes('shift')
  const requiresAlt = parts.includes('alt')

  if (requiresCtrl !== event.ctrlKey) return false
  if (requiresMeta !== event.metaKey) return false
  if (requiresShift !== event.shiftKey) return false
  if (requiresAlt !== event.altKey) return false

  return event.key.toLowerCase() === key.toLowerCase()
}
