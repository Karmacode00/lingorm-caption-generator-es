async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Si no hay credenciales de Redis configuradas, omitir la verificación
  if (!url || !token) return { allowed: true };

  const key = `ratelimit:${ip}`;
  const limit = 5; // Máximo 5 peticiones
  const windowSeconds = 60; // Por cada 60 segundos

  try {
    // Incrementar el contador en Redis
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const incrData = await incrRes.json();
    const currentRequests = incrData.result;

    // Si es la primera petición en la ventana de tiempo, definir el tiempo de expiración
    if (currentRequests === 1) {
      await fetch(`${url}/expire/${key}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }

    if (currentRequests > limit) {
      return { allowed: false, currentRequests, limit };
    }

    return { allowed: true, currentRequests, limit };
  } catch (error) {
    console.error("Error en Rate Limiting:", error);
    return { allowed: true }; // Permitir la petición en caso de fallo de Redis
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Obtener IP del cliente desde los encabezados de Vercel
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';

  // 1. Validar Límite de Tasa
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
    return res.status(500).json({ error: 'Falta la API Key en el servidor' });
  }

  try {
    const prompt = `Escribe un caption entusiasta en español para redes sociales (fandom) sobre el evento "${contextEvent}" de las actrices Lingling Kwong y Orm Kornnaphat (LingOrm). Máximo 20 palabras, incluye emojis. Responde ÚNICAMENTE con el texto del caption.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    const caption = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || `¡Increíble momento con Ling y Orm en el ${contextEvent}! 💜`;

    return res.status(200).json({ caption });
  } catch (error) {
    console.error('Error al generar con Gemini:', error);
    return res.status(500).json({ error: 'Error interno al generar el texto' });
  }
}