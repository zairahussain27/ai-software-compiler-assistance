/**
 * Claude API utility
 * Handles all API calls with:
 * - Automatic JSON extraction and parsing
 * - JSON repair for common malformations
 * - Retry with exponential backoff
 */

const MODEL = 'llama-3.3-70b-versatile';

async function callClaude(systemPrompt, userMessage, options = {}) {
  const { temperature = 0.1, max_tokens = 1500, retries = 2 } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          temperature,
          max_tokens,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userMessage
            }
          ]
        }),
      });
      
      const raw = await response.text();
      console.log("GROQ RESPONSE:", raw);

      if (!response.ok) {
        throw new Error(`Groq Error: ${response.status} ${raw}`);
      }

      const data = JSON.parse(raw);

      const text =
        data.choices?.[0]?.message?.content || '';

      if (!text.trim()) {
        throw new Error('Empty response from Groq');
      }

      return text;}
      catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(300 * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

function parseJSON(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('parseJSON received non-string input');
  }

  // Strategy 1: Direct parse (already clean JSON)
  try {
    return JSON.parse(text.trim());
  } catch (_) {}

  // Strategy 2: Strip markdown code fences
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (_) {}

  // Strategy 3: Extract first {...} block
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonSlice = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSlice);
    } catch (_) {}

    // Strategy 4: Repair common JSON issues
    const repaired = repairJSON(jsonSlice);
    try {
      return JSON.parse(repaired);
    } catch (_) {}
  }

  // Strategy 5: Try to find any valid JSON object in the text
  const jsonPattern = /\{[\s\S]*\}/;
  const match = text.match(jsonPattern);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
    try {
      return JSON.parse(repairJSON(match[0]));
    } catch (_) {}
  }

  throw new Error(`Failed to parse JSON from response. Length: ${text.length}, Preview: ${text.slice(0, 200)}`);
}

function repairJSON(jsonStr) {
  let repaired = jsonStr;

  // Fix trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // Fix unquoted keys
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

  // Fix single quotes used instead of double
  repaired = repaired.replace(/'/g, '"');

  // Fix undefined values
  repaired = repaired.replace(/:\s*undefined/g, ': null');

  // Fix NaN values
  repaired = repaired.replace(/:\s*NaN/g, ': null');

  // Fix Infinity
  repaired = repaired.replace(/:\s*Infinity/g, ': 9999999');

  // Fix newlines inside strings (replace with \\n)
  repaired = repaired.replace(/"([^"]*)\n([^"]*)"/g, '"$1\\n$2"');

  // Attempt to close unclosed brackets/braces
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const char of repaired) {
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') openBraces++;
    else if (char === '}') openBraces--;
    else if (char === '[') openBrackets++;
    else if (char === ']') openBrackets--;
  }

  while (openBrackets > 0) { repaired += ']'; openBrackets--; }
  while (openBraces > 0) { repaired += '}'; openBraces--; }

  return repaired;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { callClaude, parseJSON, repairJSON };
