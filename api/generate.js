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
    const currentRequests = incrData.result;

    if (currentRequests === 1) {
      await fetch(`${url}/expire/${key}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
    }

    return { allowed: currentRequests <= limit };
  } catch (error) {
    console.error("Error en Rate Limit:", error);
    return { allowed: true };
  }
}

async function generateWithGroq(prompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 1.0,
        max_tokens: 100
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    return null;
  }
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

  // Lista de tonos e instrucciones de estilo aleatorias para romper la monotonía
  const styles = [
    "Tono: Emotivo y cariñoso. Usa una pregunta retórica o una reflexión sobre su conexión.",
    "Tono: Fan entusiasmado y divertido. Usa modismos de fandom y exageración cómica.",
    "Tono: Poético y elegante. Destaca el brillo, el talento y la elegancia del momento.",
    "Tono: Directo y moderno. Como un tuit casual pero lleno de orgullo y apoyo.",
    "Tono: Épico y celebratorio. Enfócate en el impacto y el éxito de la aparición."
  ];

  const randomStyle = styles[Math.floor(Math.random() * styles.length)];
  const randomSeed = Math.floor(Math.random() * 999999);

  const prompt = `Eres un creador de contenido experto para el fandom de Lingling Kwong y Orm Kornnaphat (LingOrm).
Escribe un caption único en español para redes sociales sobre el evento "${contextEvent}".

Instrucciones de diversidad:
- ESTILO OBLIGATORIO: ${randomStyle}
- NO empieces siempre con "¡LingOrm..." ni uses la estructura típica "¡Nombre + Verbo!".
- NO incluyas hashtags en el texto generado (el usuario ya tiene su propia sección de hashtags).
- Longitud: Entre 10 y 20 palabras.
- Usa de 1 a 3 emojis bien integrados en el texto.
- ID de variación aleatoria: ${randomSeed}.
- Responde ÚNICAMENTE con el texto del caption, sin comillas ni explicaciones.`;

  // 1. Intento con Gemini
  if (geminiKey) {
    try {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { 
            temperature: 1.0,
            topP: 0.95
          }
        })
      });

      const geminiData = await geminiRes.json();

      if (geminiRes.ok && geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        return res.status(200).json({ caption: geminiData.candidates[0].content.parts[0].text.trim() });
      }
    } catch (e) {
      console.error("Error al conectar con Gemini:", e);
    }
  }

  // 2. Fallback a Groq
  const fallbackCaption = await generateWithGroq(prompt);
  if (fallbackCaption) {
    return res.status(200).json({ caption: fallbackCaption });
  }

  // 3. Fallback estático
  return res.status(200).json({ 
    caption: `Incondicional apoyo a Ling y Orm en ${contextEvent} 💜✨` 
  });
}