// Created by Nils Boman (nboman@fastly.com) but without any support on the code. 
// Changes are free to be made without feedback or anything. 

import { CacheOverride } from "fastly:cache-override";
import { Logger } from "fastly:logger";

// Initialize logger
const logger = new Logger("motorcasino-edge-app");

// Initialize BigQuery logger for real-time logging
const bigqueryLogger = new Logger("bigquery_logs");

// AWS S3 credentials (placeholder values - replace with actual credentials)
const AWS_ACCESS_KEY_ID = "YOUR_AWS_ACCESS_KEY_ID";
const AWS_SECRET_ACCESS_KEY = "YOUR_AWS_SECRET_ACCESS_KEY";
const AWS_REGION = "us-east-1";
const S3_BUCKET_NAME = "your-bucket-name";

// Cache TTL in seconds
const CACHE_TTL = 800;

/**
 * Main entry point for the Fastly Compute function
 */
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Handle incoming requests
 * @param {Request} request - The incoming request
 * @returns {Promise<Response>} The response to send back
 */
async function handleRequest(request) {
  const startTime = Date.now();
  let s3Response = null;
  
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Extract request information for logging
    const requestInfo = await extractRequestInfo(request, path);
    
    logger.log(`Processing request for path: ${path}`);
    
    // Check cache first
    const cacheKey = `s3-object:${path}`;
    const cachedResponse = await getCachedResponse(cacheKey);
    
    if (cachedResponse) {
      logger.log(`Cache hit for path: ${path}`);
      
      // Log cache hit to BigQuery
      await logToBigQuery({
        ...requestInfo,
        cacheStatus: 'HIT',
        responseTime: Date.now() - startTime,
        s3ResponseHeaders: null,
        eventType: 'cache_hit'
      });
      
      return cachedResponse;
    }
    
    logger.log(`Cache miss for path: ${path}, fetching from S3`);
    
    // Fetch from S3 backend
    s3Response = await fetchFromS3(path);
    
    if (!s3Response.ok) {
      logger.log(`S3 fetch failed for path: ${path}, status: ${s3Response.status}`);
      
      // Log failed request to BigQuery
      await logToBigQuery({
        ...requestInfo,
        cacheStatus: 'MISS',
        responseTime: Date.now() - startTime,
        s3ResponseHeaders: extractResponseHeaders(s3Response),
        error: `S3 fetch failed with status: ${s3Response.status}`,
        eventType: 's3_error'
      });
      
      return new Response("Not Found", { status: 404 });
    }
    
    // Clone the response for caching
    const responseToCache = s3Response.clone();
    
    // Cache the response
    await cacheResponse(cacheKey, responseToCache);
    
    logger.log(`Successfully fetched and cached response for path: ${path}`);
    
    // Log successful request to BigQuery
    await logToBigQuery({
      ...requestInfo,
      cacheStatus: 'MISS',
      responseTime: Date.now() - startTime,
      s3ResponseHeaders: extractResponseHeaders(s3Response),
      eventType: 'success'
    });
    
    return s3Response;
    
  } catch (error) {
    logger.log(`Error processing request: ${error.message}`);
    
    // Log error to BigQuery
    await logToBigQuery({
      ...(await extractRequestInfo(request, new URL(request.url).pathname)),
      cacheStatus: 'ERROR',
      responseTime: Date.now() - startTime,
      s3ResponseHeaders: s3Response ? extractResponseHeaders(s3Response) : null,
      error: error.message,
      eventType: 'error'
    });
    
    return new Response("Internal Server Error", { status: 500 });
  }
}

/**
 * Fetch object from S3 backend
 * @param {string} path - The path to fetch from S3
 * @returns {Promise<Response>} The response from S3
 */
async function fetchFromS3(path) {
  // Remove leading slash if present
  const objectKey = path.startsWith('/') ? path.slice(1) : path;
  
  // Construct S3 URL
  const s3Url = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${objectKey}`;
  
  // Create headers for S3 request
  const headers = new Headers();
  headers.set('Host', `${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com`);
  
  // Add AWS authentication headers (simplified for demo - in production use proper AWS signature)
  headers.set('Authorization', `AWS ${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`);
  
  // Create request to S3
  const s3Request = new Request(s3Url, {
    method: 'GET',
    headers: headers,
    backend: 's3_backend'
  });
  
  return await fetch(s3Request);
}

/**
 * Get cached response
 * @param {string} cacheKey - The cache key
 * @returns {Promise<Response|null>} The cached response or null
 */
async function getCachedResponse(cacheKey) {
  try {
    const cacheRequest = new Request(`https://cache/${cacheKey}`);
    const cacheResponse = await fetch(cacheRequest, {
      cacheOverride: new CacheOverride("miss")
    });
    
    if (cacheResponse.status === 200) {
      return cacheResponse;
    }
    
    return null;
  } catch (error) {
    logger.log(`Cache read error: ${error.message}`);
    return null;
  }
}

/**
 * Cache a response
 * @param {string} cacheKey - The cache key
 * @param {Response} response - The response to cache
 */
async function cacheResponse(cacheKey, response) {
  try {
    const cacheRequest = new Request(`https://cache/${cacheKey}`, {
      method: 'PUT',
      body: await response.clone().arrayBuffer(),
      headers: response.headers
    });
    
    await fetch(cacheRequest, {
      cacheOverride: new CacheOverride("override", {
        ttl: CACHE_TTL,
        swr: 0
      })
    });
    
    logger.log(`Response cached with key: ${cacheKey}, TTL: ${CACHE_TTL}s`);
  } catch (error) {
    logger.log(`Cache write error: ${error.message}`);
  }
}

/**
 * Extract comprehensive request information for logging
 * @param {Request} request - The incoming request
 * @param {string} path - The request path
 * @returns {Promise<Object>} Request information object
 */
async function extractRequestInfo(request, path) {
  const url = new URL(request.url);
  const headers = {};
  
  // Extract all request headers
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }
  
  // Get client IP
  const clientIP = request.headers.get('fastly-client-ip') || 
                   request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';
  
  return {
    timestamp: new Date().toISOString(),
    ip: clientIP,
    domain: url.hostname,
    path: path,
    method: request.method,
    userAgent: request.headers.get('user-agent') || 'unknown',
    referer: request.headers.get('referer') || null,
    requestHeaders: headers,
    url: request.url
  };
}

/**
 * Extract response headers as JSON object
 * @param {Response} response - The response object
 * @returns {Object} Response headers object
 */
function extractResponseHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }
  return headers;
}

/**
 * Log data to Google BigQuery using Fastly's real-time logging
 * @param {Object} logData - The data to log
 */
async function logToBigQuery(logData) {
  try {
    const logEntry = {
      service: 'motorcasino-edge-app',
      version: '1.0.0',
      ...logData
    };
    
    // Convert request headers to JSON string
    if (logEntry.requestHeaders) {
      logEntry.requestHeadersJson = JSON.stringify(logEntry.requestHeaders);
    }
    
    // Convert S3 response headers to JSON string
    if (logEntry.s3ResponseHeaders) {
      logEntry.s3ResponseHeadersJson = JSON.stringify(logEntry.s3ResponseHeaders);
    }
    
    // Log to BigQuery via Fastly's real-time logging
    bigqueryLogger.log(JSON.stringify(logEntry));
    
    // Also log to standard logger for debugging
    logger.log(`BigQuery log entry: ${JSON.stringify(logEntry)}`);
    
  } catch (error) {
    logger.log(`BigQuery logging error: ${error.message}`);
  }
}
