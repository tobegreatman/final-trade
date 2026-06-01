/**
 * AI 综合判断 SSE 客户端
 */

export function fetchAIJudge(payload, { onText, onDone, onError }) {
  const controller = new AbortController()

  fetch('/api/stock-analysis/ai-judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).then(async (res) => {
    const contentType = res.headers.get('content-type') || ''

    // 非 SSE 响应（如 API key 未配置）
    if (contentType.includes('application/json')) {
      const json = await res.json()
      onError(json.error || 'AI 判断请求失败')
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') { onDone(); return }
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'text') onText(parsed.content)
          else if (parsed.type === 'error') onError(parsed.content)
        } catch { /* skip malformed */ }
      }
    }
    onDone()
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err.message)
  })

  return controller
}
