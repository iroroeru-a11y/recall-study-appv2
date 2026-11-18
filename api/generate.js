const SYSTEM = `You create high-quality active-recall study cards from supplied study notes.
Return ONLY valid JSON: an array of objects with exactly these fields:
{"type":"qa"|"cloze"|"blurt","front":"...","back":"...","sourceSection":"..."}.
Generate a balanced mix of Q&A and cloze cards. One testable fact per card.
Never create a card whose answer is only yes or no. Preserve legal citations, dates,
qualifications and terminology exactly where important. Cloze fronts must use {{c1::answer}}
syntax and backs should explain the hidden fact. Do not invent facts. Avoid duplicates.`;
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI is not configured. Add ANTHROPIC_API_KEY to your serverless environment." });
  try {
    const { sections, deckName } = req.body || {};
    if (!Array.isArray(sections) || !sections.length) return res.status(400).json({ error: "No selected note sections were supplied." });
    const content = sections.map(s => `SECTION: ${String(s.title).slice(0,200)}\n${String(s.text).slice(0,15000)}`).join("\n\n");
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 5000, system: SYSTEM,
        messages: [{ role: "user", content: `Deck: ${String(deckName || "Study deck").slice(0,100)}\nCreate cards from these notes:\n\n${content}` }]
      })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || "The AI provider returned an error." });
    const text = (data.content || []).filter(x => x.type === "text").map(x => x.text).join("\n").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let cards;
    try { cards = JSON.parse(text); } catch { return res.status(502).json({ error: "The AI response was not valid JSON. Please retry." }); }
    if (!Array.isArray(cards)) return res.status(502).json({ error: "The AI response must be a JSON array." });
    const valid = cards.filter(c => c && ["qa","cloze","blurt"].includes(c.type) && typeof c.front === "string" && c.front.trim() && typeof c.back === "string" && c.back.trim() && typeof c.sourceSection === "string" && !/^(yes|no)[.!]?$/i.test(c.back.trim()));
    return res.status(200).json({ cards: valid });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected server error." });
  }
}
