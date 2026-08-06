export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Falta GEMINI_API_KEY en Vercel' });
  }

  try {
    // Consulta directa a la lista oficial de modelos
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error });
    }

    // Filtrar solo los modelos que soportan generación de texto (generateContent)
    const availableModels = data.models
      ?.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name) || [];

    return res.status(200).json({
      total: availableModels.length,
      models: availableModels
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}