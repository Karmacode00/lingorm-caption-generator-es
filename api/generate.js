async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Si no hay credenciales de Upstash, permite la ejecución sin rate limit
  if (!url || !token) return { allowed: true };

  const key = `ratelimit:${ip}`;
  const limit = 5;          // Máximo 5 peticiones
  const windowSeconds = 60; // Ventana de 60 segundos

  try {
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const incrData = await incrRes.json();
    const currentRequests = incrData.result;

    if (currentRequests === 1) {
      await fetch(`${url}/expire/${key}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }

    if (currentRequests > limit) {
      return { allowed: false };
    }

    return { allowed: true };
  } catch (error) {
    console.error("Error en verificación de Rate Limit:", error);
    return { allowed: true };
  }
}

export default async function handler(req, res) {
  // Desactivar caché de Vercel y del navegador
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // 1. Validar límite de peticiones por IP
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
    return res.status(500).json({ error: 'Falta la API Key en las variables de entorno' });
  }

  try {
    // Semilla aleatoria + timestamp para romper la caché del modelo
    const randomSeed = Math.floor(Math.random() * 999999);
    const timestamp = new Date().toISOString();

    const prompt = `Escribe un caption entusiasta y completamente diferente en español para redes sociales (fandom) sobre el evento "${contextEvent}" de las actrices Lingling Kwong y Orm Kornnaphat (LingOrm).
- Redacta una frase con un tono y vocabulario distinto a respuestas anteriores.
- Máximo 20 palabras, incluye emojis.
- Semilla única: ${randomSeed}-${timestamp}.
- Responde ÚNICAMENTE con el texto del caption.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          topP: 0.95
        }
      })
    });

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      return res.status(200).json({ 
        caption: `¡Todo nuestro apoyo para Ling y Orm en el ${contextEvent}! 💜` 
      });
    }

    const caption = data.candidates[0].content?.parts[0]?.text?.trim();

    return res.status(200).json({ 
      caption: caption || `¡Increíble momento con Ling y Orm en el ${contextEvent}! 🌟` 
    });

  } catch (error) {
    console.error('Error al procesar con Gemini:', error);
    return res.status(500).json({ error: 'Error interno al generar la frase.' });
  }
}