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

    if (currentRequests > limit) {
      return { allowed: false };
    }

    return { allowed: true };
  } catch (error) {
    console.error("Error en Rate Limit:", error);
    return { allowed: true };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const rateLimit = await checkRateLimit(clientIp);
  
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Has superado el límite de peticiones. Por favor, espera un minuto antes de intentar de nuevo.'
    });
  }

  const { eventName } = req.body || {};
  const contextEvent = eventName || 'evento especial de LingOrm';
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Error: No se encontró GEMINI_API_KEY en Vercel.' });
  }

  try {
    const randomSeed = Math.floor(Math.random() * 999999);
    const timestamp = Date.now();

    const prompt = `Escribe un caption entusiasta y totalmente original en español para redes sociales sobre el evento "${contextEvent}" de las actrices Lingling Kwong y Orm Kornnaphat (LingOrm). 
- Usa palabras y estructura distintas a cualquier intento anterior.
- Máximo 20 palabras con emojis.
- Semilla única: ${randomSeed}-${timestamp}.
- Responde ÚNICAMENTE con el texto del caption.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store', // Evita que Vercel guarde en caché la llamada a Google
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          topP: 0.95
        }
      })
    });

    const data = await response.json();

    // Si la API de Google devuelve un error (ej. API Key inválida o cuota superada)
    if (data.error) {
      console.error("Error devuelto por Gemini API:", data.error);
      return res.status(500).json({ 
        error: `Error de Gemini API: ${data.error.message || 'Error en la solicitud'}` 
      });
    }

    if (!data.candidates || data.candidates.length === 0) {
      return res.status(200).json({ 
        caption: `¡Todo nuestro apoyo para Ling y Orm en el ${contextEvent}! 💜 (S: ${randomSeed})` 
      });
    }

    const caption = data.candidates[0].content?.parts[0]?.text?.trim();

    return res.status(200).json({ 
      caption: caption 
    });

  } catch (error) {
    console.error('Error procesando la solicitud:', error);
    return res.status(500).json({ error: `Error interno: ${error.message}` });
  }
}