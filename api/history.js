/**
 * Vercel Serverless Function - Get Logged-in User's Diary History from Serverless Redis
 * File Path: /api/history.js
 * Endpoint: GET /api/history
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed. Please use GET.' });
    }

    try {
        // 1. Verify User Token via Supabase Client
        const authHeader = req.headers.authorization || req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                error: '로그인이 필요합니다. 인증 토큰이 없습니다.'
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

        // 2. Fetch Strictly Logged-in User's History List from Redis
        const historyList = await fetchUserHistoryFromRedis(userId);

        return res.status(200).json({
            success: true,
            userId: userId,
            userEmail: user.email,
            history: historyList
        });
    } catch (error) {
        console.error('Vercel User History API Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || '히스토리 목록을 가져오는 중 오류가 발생했습니다.'
        });
    }
}

/**
 * Fetch logged-in user's diary records from Serverless Redis (Strictly user-isolated keys)
 */
async function fetchUserHistoryFromRedis(userId) {
    const redisUrl = process.env.REDIS_URL;
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    const listKey = `user:${userId}:diary_list`;
    const scanPattern = `user:${userId}:diary:*`;
    let items = [];

    // 1. Try Upstash REST SDK
    if (restUrl && restToken) {
        try {
            const upstash = new UpstashRedis({ url: restUrl, token: restToken });
            const listKeys = await upstash.lrange(listKey, 0, -1);
            
            if (listKeys && listKeys.length > 0) {
                const rawData = await Promise.all(listKeys.map(k => upstash.get(k)));
                items = rawData.filter(Boolean).map(item => typeof item === 'string' ? JSON.parse(item) : item);
            } else {
                const keys = await upstash.keys(scanPattern);
                if (keys && keys.length > 0) {
                    const rawData = await Promise.all(keys.map(k => upstash.get(k)));
                    items = rawData.filter(Boolean).map(item => typeof item === 'string' ? JSON.parse(item) : item);
                }
            }
            return sortAndDeduplicate(items);
        } catch (e) {
            console.warn('[User Redis History] Upstash REST 조회 실패, REDIS_URL 시도:', e.message);
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

            const listKeys = await redis.lrange(listKey, 0, -1);
            if (listKeys && listKeys.length > 0) {
                const rawValues = await redis.mget(...listKeys);
                items = rawValues.filter(Boolean).map(raw => JSON.parse(raw));
            } else {
                const keys = await redis.keys(scanPattern);
                if (keys && keys.length > 0) {
                    const rawValues = await redis.mget(...keys);
                    items = rawValues.filter(Boolean).map(raw => JSON.parse(raw));
                }
            }
            return sortAndDeduplicate(items);
        } catch (e) {
            console.warn('[User Redis History] ioredis 조회 실패:', e.message);
        } finally {
            if (redis) {
                try {
                    await redis.quit();
                } catch (e) {}
            }
        }
    }

    return [];
}

/**
 * Sort by timestamp descending (newest first) and deduplicate by ID
 */
function sortAndDeduplicate(items) {
    const map = new Map();
    items.forEach(item => {
        if (item && item.id) {
            map.set(item.id, item);
        }
    });
    const uniqueItems = Array.from(map.values());
    
    // Sort descending by timestamp (newest first)
    uniqueItems.sort((a, b) => {
        const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return timeB - timeA;
    });

    return uniqueItems;
}
