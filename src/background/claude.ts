const SYSTEM_PROMPT = `You convert plain-English instructions into browser automation commands.
Return ONLY the command list, one per line. No explanations, no markdown, no blank lines.

Supported commands:
  click "visible text"        — click a button, link, or element by its visible text
  hover "visible text"        — move cursor to element without clicking
  type "value" in "label"    — type into an input (match by label, placeholder, or visible text)
  scroll down [px]            — scroll down by pixels (default 300)
  scroll up [px]              — scroll up by pixels (default 300)
  wait [N]ms                  — pause for N milliseconds

Rules:
- Use the exact visible text from the page for element targets
- One action per line, no comments
- For flows that require multiple steps, output every step in order

Example — "Create a payment link called Summer Sale":
click "+ New Payment Link"
type "Summer Sale" in "Link Title"
click "Create"`;

export async function convertNaturalLanguage(text: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Claude API ${response.status}: ${body.slice(0, 120)}`);
  }

  const data = (await response.json()) as { content?: Array<{ text?: string }> };
  return (data.content?.[0]?.text ?? '').trim();
}
