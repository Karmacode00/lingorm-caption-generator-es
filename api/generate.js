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
    return { allowed: incrData.result <= limit };
  } catch (error) {
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
  const contextEvent = eventName ? eventName.trim() : 'evento especial de LingOrm';
  const geminiKey = process.env.GEMINI_API_KEY;

  const styles = [
    "Tono: Emotivo y cariñoso. Usa una reflexión o frase con mucho afecto.",
    "Tono: Fan entusiasmado. Usa energía, orgullo y emoción.",
    "Tono: Poético y elegante. Destaca el talento y la presencia.",
    "Tono: Directo y moderno. Estilo tuit de apoyo."
  ];

  const randomStyle = styles[Math.floor(Math.random() * styles.length)];
  const randomSeed = Math.floor(Math.random() * 999999);

  // Le pedimos a la IA SOLO la frase previa, sin el nombre del evento
  const prompt = `Eres creador de contenido para el fandom de Lingling Kwong y Orm Kornnaphat (LingOrm).
Escribe ÚNICAMENTE una frase corta en español (de 10 a 20 palabras) con emojis para celebrar o apoyar el evento "${contextEvent}".

Reglas estrictas:
- ESTILO: ${randomStyle}
- NO incluyas el nombre del evento "${contextEvent}" dentro de la frase.
- NO agregues hashtags.
- NO agregues emojis.
- NO uses palabras de enlace al final como "en", "para", "de".
- Semilla única: ${randomSeed}.
- Responde ÚNICAMENTE con el texto de la frase.`;

  let phrase = null;

  // 1. Intento con Gemini
  if (geminiKey) {
    try {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1.0, topP: 0.95 }
        })
      });

      const geminiData = await geminiRes.json();

      if (geminiRes.ok && geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        phrase = geminiData.candidates[0].content.parts[0].text.trim();
      }
    } catch (e) {
      console.error("Error al conectar con Gemini:", e);
    }
  }

  // 2. Fallback a Groq
  if (!phrase) {
    phrase = await generateWithGroq(prompt);
  }

  // 3. Fallback estático
  if (!phrase) {
    phrase = "¡Celebrando este momento con todo el corazón! ✨";
  }

  // Limpiar posibles comillas del resultado de la IA
  phrase = phrase.replace(/^["']|["']$/g, '');

  // Formatear el resultado final garantizando SIEMPRE la línea en blanco entre la frase y el contexto
  const finalCaption = `${phrase}\n\n${contextEvent}`;

  return res.status(200).json({ caption: finalCaption });
}