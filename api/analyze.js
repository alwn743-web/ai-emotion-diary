/**
 * Vercel Serverless Function - AI Emotion Analysis Backend API
 * File Path: /api/analyze.js
 * Endpoint: POST /api/analyze
 */

export default async function handler(req, res) {
    // Enable CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST method for analysis
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Please use POST.' });
    }

    try {
        const { text } = req.body || {};

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: '분석할 일기 내용(text)을 입력해 주세요.' });
        }

        // Retrieve GEMINI_API_KEY from environment variables
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ 
                error: '서버 환경변수에 GEMINI_API_KEY가 설정되지 않았습니다. Vercel 대시보드에서 환경변수를 등록해 주세요.' 
            });
        }

        // Counselor System Prompt
        const promptText = `너는 심리 상담가야. 사용자가 작성한 일기 내용을 읽고, 사용자의 감정을 한 단어(예: 기쁨, 슬픔, 분노, 불안, 평온)로 요약해줘. 그리고 그 감정에 공감해주고, 따뜻한 응원의 메시지를 2~3문장으로 작성해줘. 답변 형식은 반드시 '감정: [요약된 감정]\n\n[응원 메시지]' 와 같이 줄바꿈을 포함해서 보내줘.\n\n[사용자의 일기 내용]\n${text.trim()}`;

        // Supported Flash Models
        const models = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
        let lastError = null;
        let replyText = null;

        for (const model of models) {
            try {
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: promptText }]
                        }]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (replyText) break;
                } else {
                    const errData = await response.json().catch(() => ({}));
                    lastError = new Error(errData.error?.message || `[${model}] HTTP ${response.status} Error`);
                }
            } catch (err) {
                lastError = err;
            }
        }

        if (!replyText) {
            throw lastError || new Error('Gemini API 응답을 가져오지 못했습니다.');
        }

        // Return successful analysis response
        return res.status(200).json({ 
            success: true, 
            result: replyText 
        });

    } catch (error) {
        console.error('Vercel Serverless Function Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || '서버 내부 오류가 발생했습니다.' 
        });
    }
}
