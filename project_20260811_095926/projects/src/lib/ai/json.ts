export function parseAiJsonObject(content: string): unknown {
  const withoutFence = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI_JSON_OBJECT_NOT_FOUND');
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}
