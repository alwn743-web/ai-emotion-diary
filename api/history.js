/**
 * Vercel Serverless Function - Get All Saved Diary History from Serverless Redis
 * File Path: /api/history.js
 * Endpoint: GET /api/history
 */

import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

export default async function handler(req, res) {
    // Enable CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed. Please use GET.' });
    }

    try {
        const historyList = await fetchHistoryFromRedis();
        return res.status(200).json({
            success: true,
            history: historyList
        });
    } catch (error) {
        console.error('Vercel History API Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || '히스토리 목록을 가져오는 중 오류가 발생했습니다.'
        });
    }
}

/**
 * Fetch all diary records from Serverless Redis (REDIS_URL or Upstash REST)
 */
async function fetchHistoryFromRedis() {
    const redisUrl = process.env.REDIS_URL;
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    let items = [];

    // 1. Try Upstash REST SDK if REST URL & Token are configured
    if (restUrl && restToken) {
        try {
            const upstash = new UpstashRedis({ url: restUrl, token: restToken });
            const listKeys = await upstash.lrange('diary_list', 0, -1);
            
            if (listKeys && listKeys.length > 0) {
                const rawData = await Promise.all(listKeys.map(k => upstash.get(k)));
                items = rawData.filter(Boolean).map(item => typeof item === 'string' ? JSON.parse(item) : item);
            } else {
                const keys = await upstash.keys('diary:*');
                if (keys && keys.length > 0) {
                    const rawData = await Promise.all(keys.map(k => upstash.get(k)));
                    items = rawData.filter(Boolean).map(item => typeof item === 'string' ? JSON.parse(item) : item);
                }
            }
            return sortAndDeduplicate(items);
        } catch (e) {
            console.warn('[Redis History] Upstash REST 조회 실패, REDIS_URL 시도:', e.message);
        }
    }

    // 2. Fallback to ioredis TCP connection via REDIS_URL
    if (redisUrl) {
        let redis = null;
        try {
            redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 1,
                connectTimeout: 4000,
                enableOfflineQueue: false
            });

            const listKeys = await redis.lrange('diary_list', 0, -1);
            if (listKeys && listKeys.length > 0) {
                const rawValues = await redis.mget(...listKeys);
                items = rawValues.filter(Boolean).map(raw => JSON.parse(raw));
            } else {
                const keys = await redis.keys('diary:*');
                if (keys && keys.length > 0) {
                    const rawValues = await redis.mget(...keys);
                    items = rawValues.filter(Boolean).map(raw => JSON.parse(raw));
                }
            }
            return sortAndDeduplicate(items);
        } catch (e) {
            console.warn('[Redis History] ioredis 조회 실패:', e.message);
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
