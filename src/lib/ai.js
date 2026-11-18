const MAX_CHARS = 12000;
export function chunkSections(sections) {
  const chunks = []; let current = [];
  let size = 0;
  for (const section of sections) {
    const text = `${section.title}\n${section.text}`;
    if (text.length > MAX_CHARS) {
      if (current.length) { chunks.push(current); current = []; size = 0; }
      for (let i = 0; i < text.length; i += MAX_CHARS) chunks.push([{ ...section, text: text.slice(i, i + MAX_CHARS), title: `${section.title} (part ${Math.floor(i / MAX_CHARS) + 1})` }]);
    } else {
      if (size + text.length > MAX_CHARS && current.length) { chunks.push(current); current = []; size = 0; }
      current.push(section); size += text.length;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export async function generateCards(sections, deckName, onProgress = () => {}) {
  const chunks = chunkSections(sections);
  const output = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress(`Generating cards · batch ${i + 1} of ${chunks.length}`);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch("/api/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckName, sections: chunks[i], retry: attempt > 0 })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "AI generation failed.");
        const cards = Array.isArray(payload.cards) ? payload.cards : JSON.parse(payload.text || "null");
        if (!Array.isArray(cards)) throw new Error("The AI response was not a JSON array.");
        for (const card of cards) {
          if (!["qa", "cloze", "blurt"].includes(card.type) || !card.front?.trim() || !card.back?.trim() || !card.sourceSection) throw new Error("The AI returned a malformed card. Please retry.");
          if (/^(yes|no)[.!]?$/i.test(card.back.trim())) continue;
          output.push(card);
        }
        lastError = null; break;
      } catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
  }
  return output;
}
