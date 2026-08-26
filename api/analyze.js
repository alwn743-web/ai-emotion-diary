/**
 * Vercel Serverless Function - AI Emotion Analysis & Serverless Redis Persistence API
 * File Path: /api/analyze.js
 * Endpoint: POST /api/analyze
 */

import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

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
        return res.status(405).json({ success: false, error: 'Method Not Allowed. Please use POST.' });
    }

    try {
        // Parse request body safely
        let bodyData = req.body;
        if (typeof req.body === 'string') {
            try {
                bodyData = JSON.parse(req.body);
            } catch (e) {
                bodyData = {};
            }
        }

        const text = bodyData?.text;

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ success: false, error: '분석할 일기 내용(text)을 입력해 주세요.' });
        }

        // Retrieve GEMINI_API_KEY strictly from Vercel Serverless environment variable
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ 
                success: false,
                error: 'Vercel 서버 환경변수에 GEMINI_API_KEY가 설정되지 않았습니다. Vercel 대시보드 Settings -> Environment Variables에서 등록해 주세요.' 
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
            throw lastError || new Error('Gemini API로부터 답변을 응답받지 못했습니다.');
        }

        // Generate unique entry ID based on current timestamp
        const timestamp = Date.now();
        const entryId = `diary_${timestamp}`;
        const recordPayload = {
            id: entryId,
            timestamp: new Date(timestamp).toISOString(),
            originalText: text.trim(),
            aiResponse: replyText
        };

        // Save entry bundle to Serverless Redis (REDIS_URL)
        await saveToServerlessRedis(recordPayload);

        // Return successful analysis response to frontend
        return res.status(200).json({ 
            success: true, 
            id: entryId,
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

/**
 * Save diary input and AI response bundle to Serverless Redis
 */
async function saveToServerlessRedis(record) {
    const redisUrl = process.env.REDIS_URL;
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    const redisKey = `diary:${record.id}`;
    const serializedData = JSON.stringify(record);

    // 1. Try Upstash HTTP REST SDK if REST URL & Token are configured
    if (restUrl && restToken) {
        try {
            const upstash = new UpstashRedis({ url: restUrl, token: restToken });
            await upstash.set(redisKey, serializedData);
            await upstash.lpush('diary_list', redisKey);
            console.log(`[Serverless Redis] Upstash REST 저장 성공: ${redisKey}`);
            return;
        } catch (e) {
            console.warn('[Serverless Redis] Upstash REST 저장 실패, REDIS_URL 시도:', e.message);
        }
    }

    // 2. Fallback to ioredis TCP connection string via REDIS_URL
    if (redisUrl) {
        let redis = null;
        try {
            redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 1,
                connectTimeout: 4000,
                enableOfflineQueue: false
            });
            await redis.set(redisKey, serializedData);
            await redis.lpush('diary_list', redisKey);
            console.log(`[Serverless Redis] REDIS_URL 저장 성공: ${redisKey}`);
        } catch (e) {
            console.warn('[Serverless Redis] REDIS_URL 저장 실패 경고:', e.message);
        } finally {
            if (redis) {
                try {
                    await redis.quit();
                } catch (e) {}
            }
        }
    } else {
        console.warn('[Serverless Redis] REDIS_URL 환경변수가 설정되지 않아 Redis 저장을 스킵합니다.');
    }
}
