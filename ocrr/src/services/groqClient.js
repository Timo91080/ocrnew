const fetch = require('node-fetch');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function ensureGroqConfig() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY manquant.');
  }

  if (!process.env.GROQ_MODEL) {
    throw new Error('GROQ_MODEL manquant.');
  }
}

function normalizeJsonPayload(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Contenu Groq vide.');
  }

  let payload = raw.trim();

  const fenced = payload.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    payload = fenced[1].trim();
  } else if (payload.startsWith('`') && payload.endsWith('`')) {
    payload = payload.slice(1, -1).trim();
  }

  payload = payload.replace(/^\uFEFF/, '');

  const firstCurly = payload.indexOf('{');
  const firstSquare = payload.indexOf('[');
  const firstAny = Math.min(
    firstCurly === -1 ? Infinity : firstCurly,
    firstSquare === -1 ? Infinity : firstSquare
  );

  if (firstAny !== Infinity) {
    const lastCurly = payload.lastIndexOf('}');
    const lastSquare = payload.lastIndexOf(']');
    const lastAny = Math.max(lastCurly, lastSquare);
    if (lastAny > firstAny) {
      payload = payload.slice(firstAny, lastAny + 1).trim();
    }
  }

  if (/^\s*</.test(payload)) {
    throw new Error(
      `La reponse du service Groq semble etre du HTML (page d'erreur). Premier contenu: ${payload.slice(0, 200)}`
    );
  }

  return payload;
}

async function callGroqJSON({ prompt, temperature = 0, mockResult }) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt Groq invalide.');
  }

  if (process.env.LLM_PROVIDER === 'mock') {
    if (mockResult !== undefined) {
      return { parsed: mockResult, rawText: JSON.stringify(mockResult) };
    }
    throw new Error('LLM_PROVIDER est defini a mock et aucun resultat fictif n\'est fourni.');
  }

  ensureGroqConfig();

  const body = {
    model: process.env.GROQ_MODEL,
    temperature,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    throw new Error(`Erreur Groq (${response.status}) [${contentType}]: ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    const first = Math.min(
      responseText.indexOf('{') === -1 ? Infinity : responseText.indexOf('{'),
      responseText.indexOf('[') === -1 ? Infinity : responseText.indexOf('[')
    );
    const last = Math.max(responseText.lastIndexOf('}'), responseText.lastIndexOf(']'));
    if (first !== Infinity && last > first) {
      const candidate = responseText.slice(first, last + 1);
      try {
        data = JSON.parse(candidate);
      } catch (nestedError) {
        throw new Error(`Reponse Groq non JSON: ${err.message}`);
      }
    } else {
      throw new Error(`Reponse Groq non JSON: ${err.message}`);
    }
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error('Reponse vide du modele Groq.');
  }

  const payload = normalizeJsonPayload(rawContent);

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(`Reponse Groq non JSON: ${error.message}`);
  }

  return { parsed, rawText: rawContent, normalizedPayload: payload };
}

module.exports = {
  callGroqJSON,
};
