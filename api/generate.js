const SYSTEM = `You create high-quality active-recall study cards from supplied study notes.
Return ONLY a valid JSON array. Every item must have exactly these fields:
{"type":"qa"|"cloze"|"blurt","front":"...","back":"...","sourceSection":"..."}.
Generate a balanced mix of Q&A and cloze cards. One testable fact per card.
Never create a card whose answer is only yes or no. Preserve legal citations, dates,
qualifications and terminology exactly where important. Cloze fronts must use {{c1::answer}}
syntax and backs should explain the hidden fact. Do not invent facts. Avoid duplicates.`;

const CARD_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      type: { type: "STRING", enum: ["qa", "cloze", "blurt"] },
      front: { type: "STRING" },
      back: { type: "STRING" },
      sourceSection: { type: "STRING" }
    },
    required: ["type", "front", "back", "sourceSection"]
  }
};

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed.");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendError(res, 503, "Gemini is not configured. Add GEMINI_API_KEY to your Vercel environment variables, then redeploy.");
  }

  try {
    const { sections, deckName } = req.body || {};
    if (!Array.isArray(sections) || !sections.length) {
      return sendError(res, 400, "No selected note sections were supplied.");
    }

    const content = sections.map((section) => {
      const title = String(section?.title || "Untitled section").slice(0, 200);
      const text = String(section?.text || "").slice(0, 15000);
      return `SECTION: ${title}\n${text}`;
    }).join("\n\n");

    const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{
            role: "user",
            parts: [{
              text: `Deck: ${String(deckName || "Study deck").slice(0, 100)}\nCreate active-recall cards from these notes. Follow the system instructions and return only the JSON array.\n\n${content}`
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: CARD_SCHEMA
          }
        })
      }
    );

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const providerMessage = data?.error?.message;
      if (upstream.status === 429) {
        return sendError(res, 429, "Gemini's free usage limit has been reached for now. Please wait and try again later.");
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return sendError(res, upstream.status, "Gemini rejected the API key. Check that GEMINI_API_KEY is correct and that the key is enabled for the Gemini API.");
      }
      return sendError(res, upstream.status, providerMessage || "Gemini could not generate cards. Please try again.");
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      return sendError(res, 502, reason === "SAFETY"
        ? "Gemini could not process this content. Try a different section of notes."
        : "Gemini returned an empty response. Please try again.");
    }

    let cards;
    try {
      cards = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    } catch {
      return sendError(res, 502, "Gemini's response was not valid JSON. Please retry.");
    }

    if (!Array.isArray(cards)) {
      return sendError(res, 502, "Gemini's response must be a JSON array.");
    }

    const valid = cards.filter((card) =>
      card &&
      ["qa", "cloze", "blurt"].includes(card.type) &&
      typeof card.front === "string" && card.front.trim() &&
      typeof card.back === "string" && card.back.trim() &&
      typeof card.sourceSection === "string" &&
      !/^(yes|no)[.!]?$/i.test(card.back.trim())
    );

    return res.status(200).json({ cards: valid });
  } catch (error) {
    return sendError(res, 500, error?.message || "Unexpected server error while generating cards.");
  }
}
