exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    try {
        const { embeddingPayload } = JSON.parse(event.body || '{}');
        if (!embeddingPayload) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing embeddingPayload' }) };
        }
        const resp = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(embeddingPayload)
        });
        const data = await resp.json();
        if (!resp.ok) {
            return { statusCode: resp.status, headers, body: JSON.stringify({ error: data }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ embeddingResponse: data }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
