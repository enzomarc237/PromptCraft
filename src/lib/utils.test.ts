import { describe, expect, it } from 'vitest'
import {
  compilePromptTemplate,
  diffByLine,
  eventMatchesShortcut,
  normalizeShortcut,
  parseVariables,
} from './utils'

describe('parseVariables', () => {
  it('extracts unique variable keys from template text', () => {
    const variables = parseVariables('Hello {{name}} and {{ company }} and {{name}}')
    expect(variables).toEqual(['name', 'company'])
  })
})

describe('compilePromptTemplate', () => {
  it('compiles template with provided values and empty fallback', () => {
    const output = compilePromptTemplate('A={{a}} B={{b}} C={{c}}', {
      a: '1',
      b: '2',
    })

    expect(output).toBe('A=1 B=2 C=')
  })
})

describe('diffByLine', () => {
  it('marks changed, added and removed lines', () => {
    const diff = diffByLine('one\ntwo\nthree', 'one\nchanged')
    expect(diff[0].state).toBe('same')
    expect(diff[1].state).toBe('changed')
    expect(diff[2].state).toBe('removed')
  })
})

describe('shortcut helpers', () => {
  it('normalizes shortcut ordering and case', () => {
    expect(normalizeShortcut('Enter+CTRL+Shift')).toBe('ctrl+shift+enter')
  })

  it('matches keyboard event against configured shortcut', () => {
    const keyboardEvent = {
      key: 'Enter',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent

    expect(eventMatchesShortcut(keyboardEvent, 'ctrl+enter')).toBe(true)
    expect(eventMatchesShortcut(keyboardEvent, 'meta+enter')).toBe(false)
  })
})
