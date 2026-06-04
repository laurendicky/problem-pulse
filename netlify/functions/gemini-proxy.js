exports.handler = async (event, context) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // This is a Secret Variable
  
  const { contents, systemInstruction, generationConfig } = JSON.parse(event.body);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, systemInstruction, generationConfig })
    });

    const data = await response.json();
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: "Proxy Error" }) };
  }
};
