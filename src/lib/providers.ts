import { tokenizeApprox } from './utils'
import type { ExecutionRequest, ExecutionResult, ProviderId } from './types'

const json = async <T>(response: Response) => {
  const payload = (await response.json()) as T
  return payload
}

const parseSseLine = (line: string) => {
  if (!line.startsWith('data:')) return null
  const chunk = line.slice(5).trim()
  if (!chunk || chunk === '[DONE]') return null

  try {
    return JSON.parse(chunk) as Record<string, unknown>
  } catch {
    return null
  }
}

const streamReader = async (
  response: Response,
  onChunk: (payload: Record<string, unknown>) => string | null,
  onToken: (token: string) => void,
) => {
  if (!response.body) {
    throw new Error('Provider response missing stream body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let pending = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''

    for (const line of lines) {
      const payload = parseSseLine(line.trim())
      if (!payload) continue
      const token = onChunk(payload)
      if (!token) continue
      output += token
      onToken(token)
    }
  }

  return output
}

const ensureSuccess = async (response: Response) => {
  if (response.ok) return response

  const details = await response.text()
  throw new Error(`Provider request failed (${response.status}): ${details}`)
}

const executeOpenAiCompatible = async (
  request: ExecutionRequest,
  url: string,
): Promise<ExecutionResult> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      stream: true,
      temperature: request.hyperparameters.temperature,
      max_tokens: request.hyperparameters.maxTokens,
      top_p: request.hyperparameters.topP,
      frequency_penalty: request.hyperparameters.frequencyPenalty,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    }),
  })

  await ensureSuccess(response)

  const output = await streamReader(
    response,
    (payload) => {
      const choices = payload.choices as
        | Array<{ delta?: { content?: string | null } }>
        | undefined

      return choices?.[0]?.delta?.content ?? null
    },
    request.onToken,
  )

  return {
    output,
    inputTokens: tokenizeApprox(request.systemPrompt + request.userPrompt),
    outputTokens: tokenizeApprox(output),
  }
}

const executeAnthropic = async (
  request: ExecutionRequest,
): Promise<ExecutionResult> => {
  const endpoint = request.endpoint || 'https://api.anthropic.com'
  const response = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': request.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: request.model,
      system: request.systemPrompt,
      max_tokens: request.hyperparameters.maxTokens,
      temperature: request.hyperparameters.temperature,
      top_p: request.hyperparameters.topP,
      messages: [{ role: 'user', content: request.userPrompt }],
      stream: true,
    }),
  })

  await ensureSuccess(response)

  const output = await streamReader(
    response,
    (payload) => {
      const delta = payload.delta as { text?: string } | undefined
      return delta?.text ?? null
    },
    request.onToken,
  )

  return {
    output,
    inputTokens: tokenizeApprox(request.systemPrompt + request.userPrompt),
    outputTokens: tokenizeApprox(output),
  }
}

const executeGemini = async (request: ExecutionRequest): Promise<ExecutionResult> => {
  const endpoint = request.endpoint || 'https://generativelanguage.googleapis.com'

  const response = await fetch(
    `${endpoint}/v1beta/models/${request.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(request.apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: request.systemPrompt }],
        },
        contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
        generationConfig: {
          temperature: request.hyperparameters.temperature,
          topP: request.hyperparameters.topP,
          maxOutputTokens: request.hyperparameters.maxTokens,
        },
      }),
    },
  )

  await ensureSuccess(response)

  const output = await streamReader(
    response,
    (payload) => {
      const candidates = payload.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined

      return candidates?.[0]?.content?.parts?.[0]?.text ?? null
    },
    request.onToken,
  )

  return {
    output,
    inputTokens: tokenizeApprox(request.systemPrompt + request.userPrompt),
    outputTokens: tokenizeApprox(output),
  }
}

const executeOllama = async (request: ExecutionRequest): Promise<ExecutionResult> => {
  const endpoint = request.endpoint || 'http://localhost:11434'

  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      prompt: `${request.systemPrompt}\n\n${request.userPrompt}`,
      options: {
        temperature: request.hyperparameters.temperature,
        top_p: request.hyperparameters.topP,
        num_predict: request.hyperparameters.maxTokens,
      },
      stream: true,
    }),
  })

  await ensureSuccess(response)

  if (!response.body) {
    throw new Error('Provider response missing stream body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let pending = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const payload = JSON.parse(line) as { response?: string }
        if (!payload.response) continue
        output += payload.response
        request.onToken(payload.response)
      } catch {
        continue
      }
    }
  }

  return {
    output,
    inputTokens: tokenizeApprox(request.systemPrompt + request.userPrompt),
    outputTokens: tokenizeApprox(output),
  }
}

export const executePrompt = async (
  request: ExecutionRequest,
): Promise<ExecutionResult> => {
  switch (request.provider) {
    case 'openai': {
      const endpoint = request.endpoint || 'https://api.openai.com'
      return executeOpenAiCompatible(request, `${endpoint}/v1/chat/completions`)
    }
    case 'openrouter': {
      const endpoint = request.endpoint || 'https://openrouter.ai/api'
      return executeOpenAiCompatible(request, `${endpoint}/v1/chat/completions`)
    }
    case 'mistral': {
      const endpoint = request.endpoint || 'https://api.mistral.ai'
      return executeOpenAiCompatible(request, `${endpoint}/v1/chat/completions`)
    }
    case 'anthropic':
      return executeAnthropic(request)
    case 'gemini':
      return executeGemini(request)
    case 'ollama':
      return executeOllama(request)
    default:
      throw new Error(`Unsupported provider: ${request.provider satisfies never}`)
  }
}

export const discoverModels = async (
  provider: ProviderId,
  apiKey: string,
  endpoint: string,
  anthropicFallback: string[],
) => {
  switch (provider) {
    case 'openai': {
      const response = await ensureSuccess(
        await fetch(`${endpoint || 'https://api.openai.com'}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      )
      const payload = await json<{ data: Array<{ id: string }> }>(response)
      return payload.data.map((entry) => entry.id)
    }
    case 'openrouter': {
      const response = await ensureSuccess(
        await fetch(`${endpoint || 'https://openrouter.ai/api'}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      )
      const payload = await json<{ data: Array<{ id: string }> }>(response)
      return payload.data.map((entry) => entry.id)
    }
    case 'gemini': {
      const base = endpoint || 'https://generativelanguage.googleapis.com'
      const response = await ensureSuccess(
        await fetch(
          `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        ),
      )
      const payload = await json<{
        models: Array<{ name: string; supportedGenerationMethods?: string[] }>
      }>(response)

      return payload.models
        .filter((model) =>
          (model.supportedGenerationMethods ?? []).includes('generateContent'),
        )
        .map((model) => model.name.replace('models/', ''))
    }
    case 'ollama': {
      const response = await ensureSuccess(
        await fetch(`${endpoint || 'http://localhost:11434'}/api/tags`),
      )
      const payload = await json<{ models: Array<{ name: string }> }>(response)
      return payload.models.map((model) => model.name)
    }
    case 'anthropic':
      return anthropicFallback
    case 'mistral': {
      const response = await ensureSuccess(
        await fetch(`${endpoint || 'https://api.mistral.ai'}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      )
      const payload = await json<{ data: Array<{ id: string }> }>(response)
      return payload.data.map((model) => model.id)
    }
    default:
      return []
  }
}
