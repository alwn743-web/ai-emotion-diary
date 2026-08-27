/**
 * Vercel Serverless Function - AI Emotion Analysis & User-Isolated Serverless Redis Persistence
 * File Path: /api/analyze.js
 * Endpoint: POST /api/analyze
 */

import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = "https://wgimzugbofgqvxqityol.supabase.co";
const DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnaW16dWdib2ZncXZ4cWl0eW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDg4MDksImV4cCI6MjEwMzM4NDgwOX0.sinvnUVw0AHwR5vb5VxRREaHgLgusZWQvENjflQdZec";

export default async function handler(req, res) {
    // Enable CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
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
        // 1. Verify User Token via Supabase Client
        const authHeader = req.headers.authorization || req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                error: '로그인이 필요한 서비스입니다. 인증 토큰이 없습니다.'
            });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

        const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false }
        });

        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({
                success: false,
                error: '유효하지 않거나 만료된 인증 토큰입니다. 다시 로그인해 주세요.'
            });
        }

        const userId = user.id;
        const userEmail = user.email || user.id;

        // 2. Parse request body safely
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

        // 3. Generate User-Isolated Entry Payload
        const timestamp = Date.now();
        const entryId = `diary_${timestamp}`;
        const recordPayload = {
            id: entryId,
            userId: userId,
            userEmail: userEmail,
            timestamp: new Date(timestamp).toISOString(),
            originalText: text.trim(),
            aiResponse: replyText
        };

        // Save entry bundle to Serverless Redis with User ID isolation
        await saveUserIsolatedRedis(userId, recordPayload);

        // Return successful analysis response to frontend
        return res.status(200).json({ 
            success: true, 
            id: entryId,
            userId: userId,
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
 * Save diary record to Serverless Redis under user-isolated key
 */
async function saveUserIsolatedRedis(userId, record) {
    const redisUrl = process.env.REDIS_URL;
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    const redisKey = `user:${userId}:diary:${record.id}`;
    const listKey = `user:${userId}:diary_list`;
    const serializedData = JSON.stringify(record);

    // 1. Try Upstash HTTP REST SDK
    if (restUrl && restToken) {
        try {
            const upstash = new UpstashRedis({ url: restUrl, token: restToken });
            await upstash.set(redisKey, serializedData);
            await upstash.lpush(listKey, redisKey);
            console.log(`[User Redis] Upstash REST 저장 성공: ${redisKey}`);
            return;
        } catch (e) {
            console.warn('[User Redis] Upstash REST 저장 실패, REDIS_URL 시도:', e.message);
        }
    }

    // 2. Fallback to ioredis TCP connection
    if (redisUrl) {
        let redis = null;
        try {
            redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 1,
                connectTimeout: 4000,
                enableOfflineQueue: false
            });
            await redis.set(redisKey, serializedData);
            await redis.lpush(listKey, redisKey);
            console.log(`[User Redis] REDIS_URL 저장 성공: ${redisKey}`);
        } catch (e) {
            console.warn('[User Redis] REDIS_URL 저장 실패 경고:', e.message);
        } finally {
            if (redis) {
                try {
                    await redis.quit();
                } catch (e) {}
            }
        }
    } else {
        console.warn('[User Redis] REDIS_URL 환경변수가 설정되지 않아 Redis 저장을 스킵합니다.');
    }
}
