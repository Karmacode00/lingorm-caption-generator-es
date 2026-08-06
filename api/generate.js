async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Si no se han configurado las variables de Redis, omitimos la restricción
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
      return { allowed: false, currentRequests, limit };
    }

    return { allowed: true };
  } catch (error) {
    console.error("Error en verificación de Rate Limit:", error);
    return { allowed: true }; // En caso de fallo en Redis, permite la petición
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Detectar la IP del cliente en Vercel
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';

  // 1. Validar Rate Limit
  const rateLimit = await checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Has superado el límite de peticiones. Espera un minuto antes de intentar de nuevo.'
    });
  }

  const { eventName } = req.body || {};
  const contextEvent = eventName || 'evento especial de LingOrm';
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Falta la API Key en las variables de entorno' });
  }

  try {
    // Generar un identificador aleatorio para forzar variedad en las respuestas de la IA
    const randomSeed = Math.floor(Math.random() * 100000);

    const prompt = `Escribe un caption entusiasta y ÚNICO en español para redes sociales (fandom) sobre el evento "${contextEvent}" de las actrices Lingling Kwong y Orm Kornnaphat (LingOrm). 
- Usa una estructura totalmente variada y creativa.
- Máximo 20 palabras, incluye emojis acordes.
- Variación id: ${randomSeed}.
- Responde ÚNICAMENTE con el texto del caption.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0 // Alta temperatura para aumentar la diversidad de respuestas
        }
      })
    });

    const data = await response.json();

    // Manejar posibles respuestas bloqueadas o vacías por parte de Gemini
    if (!data.candidates || data.candidates.length === 0) {
      console.error("Respuesta bloqueada o sin candidatos:", JSON.stringify(data));
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