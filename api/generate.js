async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return { allowed: true };

  const key = `ratelimit:${ip}`;
  const limit = 5;
  const windowSeconds = 60;

  try {
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    const incrData = await incrRes.json();
    if (incrData.result === 1) {
      await fetch(`${url}/expire/${key}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
    }
    return { allowed: incrData.result <= limit };
  } catch (error) {
    return { allowed: true };
  }
}

// Función auxiliar para llamar a Groq API si Gemini falla
async function generateWithGroq(prompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 100
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const rateLimit = await checkRateLimit(clientIp);
  
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Has superado el límite de peticiones. Por favor, espera un minuto.'
    });
  }

  const { eventName } = req.body || {};
  const contextEvent = eventName || 'evento especial de LingOrm';
  const geminiKey = process.env.GEMINI_API_KEY;

  const randomSeed = Math.floor(Math.random() * 999999);
  const prompt = `Escribe un caption entusiasta y original en español para redes sociales sobre el evento "${contextEvent}" de las actrices Lingling Kwong y Orm Kornnaphat (LingOrm).
- Máximo 20 palabras con emojis.
- Semilla única: ${randomSeed}.
- Responde ÚNICAMENTE con el texto del caption.`;

  // 1. Intento con Gemini
  if (geminiKey) {
    try {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1.0 }
        })
      });

      const geminiData = await geminiRes.json();

      if (geminiRes.ok && geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        return res.status(200).json({ caption: geminiData.candidates[0].content.parts[0].text.trim() });
      }
      console.warn("Gemini falló o devolvió cuota 0, alternando a proveedor secundario...");
    } catch (e) {
      console.error("Error al conectar con Gemini:", e);
    }
  }

  // 2. Fallback automático a Groq
  const fallbackCaption = await generateWithGroq(prompt);
  if (fallbackCaption) {
    return res.status(200).json({ caption: fallbackCaption });
  }

  // 3. Fallback estático final en caso de fallo total de APIs
  return res.status(200).json({ 
    caption: `¡Todo nuestro apoyo para Ling y Orm en ${contextEvent}! 💜✨` 
  });
}