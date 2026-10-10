// Minimal Gemini chat call for the agent-reply eval: the rendered Aangan prompt as the system instruction.
const model = () => process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'

export async function agentReply(system: string, turns: { role: 'user' | 'agent'; text: string }[], temperature = 0.8): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)))
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.text }] })),
        // Realistic sampling (the live agent is not run at temperature 0), plus a short reply cap like a phone agent.
        generationConfig: { temperature, maxOutputTokens: 600 },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.ok) {
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
      if (text) return text
      last = 'empty reply'; continue
    }
    last = `Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`
    if (![429, 500, 502, 503, 504].includes(res.status)) break
  }
  throw new Error(last)
}
