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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGemini({ apiKey, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let response;
  let data = {};

  // Retry transient capacity/server errors. Do not repeatedly retry quota/auth errors.
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: CARD_SCHEMA
        }
      })
    });

    data = await response.json().catch(() => ({}));
    if (response.ok) return { response, data };
    if (![500, 502, 503, 504].includes(response.status) || attempt === 2) {
      return { response, data };
    }
    await sleep(700 * (2 ** attempt));
  }
  return { response, data };
}

function parseCards(data) {
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();

  if (!text) return { error: "The AI returned an empty response. Please try a shorter section of notes." };

  let cards;
  try {
    cards = JSON.parse(text);
  } catch {
    return { error: "The AI response was not valid JSON. Please retry." };
  }

  if (!Array.isArray(cards)) return { error: "The AI response must be a JSON array." };

  const valid = cards.filter((card) =>
    card &&
    ["qa", "cloze", "blurt"].includes(card.type) &&
    typeof card.front === "string" && card.front.trim() &&
    typeof card.back === "string" && card.back.trim() &&
    typeof card.sourceSection === "string" &&
    !/^(yes|no)[.!]?$/i.test(card.back.trim())
  );
  return { cards: valid };
}

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

    const prompt = `Deck: ${String(deckName || "Study deck").slice(0, 100)}
Create active-recall cards from these notes. Follow the system instructions and return only the JSON array.

${content}`;

    // Use free-tier models only. A configured model is tried first, followed by
    // current free-tier alternatives if that model is temporarily overloaded.
    const configured = process.env.GEMINI_MODEL?.trim();
    const models = [...new Set([
      configured,
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash"
    ].filter(Boolean))];

    let lastStatus = 503;
    let lastMessage = "Gemini is temporarily busy. Please try again shortly.";

    for (const model of models) {
      const { response, data } = await callGemini({ apiKey, model, prompt });
      if (response.ok) {
        const parsed = parseCards(data);
        if (parsed.error) return sendError(res, 502, parsed.error);
        return res.status(200).json({ cards: parsed.cards, model });
      }

      lastStatus = response.status;
      lastMessage = data?.error?.message || lastMessage;

      // Auth/key errors apply to the whole project; trying more models won't help.
      if (response.status === 401 || response.status === 403) {
        return sendError(res, response.status, "Gemini rejected the API key. Check GEMINI_API_KEY and confirm the key is enabled for the Gemini API.");
      }

      // Continue to the next model for capacity, rate-limit, or model availability errors.
      if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
    }

    if (lastStatus === 429) {
      return sendError(res, 429, "Gemini's free usage limit appears to have been reached for the available models. Please wait and try again later.");
    }
    if ([500, 502, 503, 504].includes(lastStatus)) {
      return sendError(res, 503, "Gemini's available free models are currently overloaded. Recall tried its backup models and automatic retries, but none responded. Please try again later.");
    }
    return sendError(res, lastStatus, lastMessage);
  } catch (error) {
    return sendError(res, 500, error?.message || "Unexpected server error while generating cards.");
  }
}
