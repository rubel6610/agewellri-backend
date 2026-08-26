import { Request, Response, NextFunction } from "express";
import { MemoryCache } from "../utils/cache";
import { AuthenticatedRequest } from "./auth.middleware";

export interface CacheOptions {
  ttlSeconds?: number;
  tags?: string[];
  isPrivate?: boolean;
}

/**
 * Express middleware for automatic parallel-safe response caching with ETag and 304 Not Modified
 */
export function cacheResponse(options: CacheOptions = {}) {
  const { ttlSeconds = 300, tags = [], isPrivate = false } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET or HEAD requests
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    const authReq = req as AuthenticatedRequest;
    const userScope = authReq.user ? `${authReq.user.role}_${authReq.user.id}` : "anon";
    const cacheKey = `${isPrivate ? userScope : "pub"}:${req.baseUrl}${req.path}:${JSON.stringify(req.query)}`;

    const cached = MemoryCache.get(cacheKey);
    if (cached) {
      const clientEtag = req.headers["if-none-match"];
      if (clientEtag && clientEtag === cached.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("X-Cache", "HIT");
      res.setHeader("ETag", cached.etag);
      res.setHeader(
        "Cache-Control",
        `${isPrivate ? "private" : "public"}, max-age=${ttlSeconds}, stale-while-revalidate=${Math.floor(ttlSeconds / 2)}`
      );
      res.json(cached.data);
      return;
    }

    // Intercept res.json to populate cache
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only cache 2xx successful responses
      if (res.statusCode >= 200 && res.statusCode < 300 && body?.success !== false) {
        const etag = MemoryCache.set(cacheKey, body, ttlSeconds, tags);
        res.setHeader("X-Cache", "MISS");
        res.setHeader("ETag", etag);
        res.setHeader(
          "Cache-Control",
          `${isPrivate ? "private" : "public"}, max-age=${ttlSeconds}, stale-while-revalidate=${Math.floor(ttlSeconds / 2)}`
        );
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Express middleware to invalidate cache tags on write operations (POST, PUT, PATCH, DELETE)
 */
export function invalidateCacheTags(...tags: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    for (const tag of tags) {
      MemoryCache.invalidateByTag(tag);
    }
    next();
  };
}
