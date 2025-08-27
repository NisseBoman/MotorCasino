# MotorCasino Edge Compute App

A Fastly Edge Compute application that serves content from AWS S3 with intelligent caching and Google BigQuery real-time logging.

## Features

- **Edge Computing**: Runs on Fastly's global edge network for low latency
- **S3 Backend**: Fetches content from private AWS S3 bucket using dynamic backend
- **Intelligent Caching**: 800-second TTL with cache-first strategy and cache miss handling
- **Dynamic Routing**: URL-based path mapping to S3 object keys
- **Google BigQuery Logging**: Real-time logging of comprehensive request/response data
- **Performance Monitoring**: Response time tracking and cache effectiveness metrics
- **Error Handling**: Comprehensive error logging with context and categorization

## Setup

### Prerequisites

1. Fastly CLI installed (`npm install -g @fastly/cli`)
2. AWS S3 bucket with appropriate permissions
3. Fastly account and service
4. Google Cloud Platform account with BigQuery enabled
5. Google Cloud service account with BigQuery permissions

### Configuration

1. **Update S3 Credentials**: Edit `src/index.js` and replace placeholder values:
   ```javascript
   const AWS_ACCESS_KEY_ID = "YOUR_AWS_ACCESS_KEY_ID";
   const AWS_SECRET_ACCESS_KEY = "YOUR_AWS_SECRET_ACCESS_KEY";
   const AWS_REGION = "us-east-1";
   const S3_BUCKET_NAME = "your-bucket-name";
   ```

2. **Update Fastly Configuration**: Edit `fastly.toml`:
   ```toml
   [local_server.backends.s3_backend]
     url = "https://your-bucket-name.s3.amazonaws.com"
     host_header = "your-bucket-name.s3.amazonaws.com"
   ```

3. **Configure BigQuery Logging**: Update `fastly.toml` with your Google Cloud details:
   ```toml
   [env.production.logging.bigquery_logs]
     type = "bigquery"
     project_id = "your-google-project-id"
     dataset = "fastly_logs"
     table = "request_logs"
     user = "your-service-account@your-project.iam.gserviceaccount.com"
     secret_key = "your-private-key-secret"
     format = "json"
     format_version = 2
   ```

### Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build for production
npm run build

# Deploy to Fastly
npm run deploy
```

## How It Works

1. **Request Processing**: Incoming requests are processed based on the URL path
2. **Cache Check**: First checks Fastly's edge cache for existing content using cache key `s3-object:${path}`
3. **S3 Fetch**: On cache miss, fetches content from the configured S3 bucket using the path as object key
4. **Cache Storage**: Stores the response in edge cache with 800-second TTL and 0 stale-while-revalidate
5. **BigQuery Logging**: Logs comprehensive request/response data in real-time for every request
6. **Response**: Returns the content to the client with optimal performance

## BigQuery Logging

### Log Schema
Each request generates a structured log entry sent to Google BigQuery with the following fields:

```json
{
  "service": "motorcasino-edge-app",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "ip": "192.168.1.100",
  "domain": "example.com",
  "path": "/api/data",
  "method": "GET",
  "userAgent": "Mozilla/5.0...",
  "referer": "https://example.com/page",
  "requestHeaders": {...},
  "requestHeadersJson": "{\"accept\":\"application/json\",...}",
  "s3ResponseHeaders": {...},
  "s3ResponseHeadersJson": "{\"content-type\":\"application/json\",...}",
  "cacheStatus": "MISS",
  "responseTime": 45,
  "eventType": "success",
  "url": "https://example.com/api/data"
}
```

### Logging Features
- **Request Headers**: Complete JSON capture as both object and string format
- **S3 Response Headers**: Full AWS S3 response headers as both object and string format
- **Performance Metrics**: Response time tracking and cache status (HIT/MISS/ERROR)
- **Event Types**: Categorized logging for different scenarios:
  - `cache_hit`: Content served from cache
  - `success`: Content fetched from S3 and cached
  - `s3_error`: S3 fetch failures
  - `error`: General application errors
- **Real-time**: Instant logging to BigQuery via Fastly's edge infrastructure
- **Dual Format**: Headers stored as both structured objects and JSON strings for flexibility

### BigQuery Setup
1. Create a BigQuery dataset named `fastly_logs`
2. Create a table named `request_logs` with auto-schema detection
3. Create a service account with BigQuery Data Editor role
4. Download the private key and store it as a Fastly secret
5. Update the `fastly.toml` configuration with your project details

## Architecture Benefits

- **Global Edge Distribution**: Content served from 100+ edge locations worldwide
- **Reduced Origin Load**: Intelligent caching reduces S3 requests by serving cached content
- **Low Latency**: Sub-50ms response times from edge locations
- **High Availability**: Built on Fastly's resilient infrastructure with automatic failover
- **Real-time Analytics**: Instant insights into request patterns, performance, and errors
- **Scalable Logging**: BigQuery handles massive log volumes efficiently
- **Cache Optimization**: 800-second TTL with immediate cache invalidation on updates

## Security Considerations

- Replace placeholder AWS credentials with proper IAM roles
- Implement proper AWS signature authentication for production use
- Use Fastly's secret store for credential management
- Enable S3 bucket policies for additional security
- Secure Google Cloud service account with minimal required permissions
- Use VPC Service Controls for BigQuery access if needed
- Validate and sanitize all incoming request data

## Monitoring & Analytics

The application provides comprehensive monitoring through:

- **Fastly Dashboard**: Real-time service metrics, logs, and performance data
- **Google BigQuery**: Structured analytics and historical data analysis
- **Performance Tracking**: Response times, cache hit rates, and effectiveness metrics
- **Error Monitoring**: Comprehensive error logging with context and categorization
- **Usage Analytics**: Request patterns, geographic distribution, and performance trends

### BigQuery Queries Examples

```sql
-- Cache hit rate analysis by hour
SELECT 
  DATETIME_TRUNC(timestamp, HOUR) as hour,
  cacheStatus,
  COUNT(*) as request_count,
  AVG(responseTime) as avg_response_time,
  ROUND(COUNT(CASE WHEN cacheStatus = 'HIT' THEN 1 END) * 100.0 / COUNT(*), 2) as cache_hit_rate
FROM `your-project.fastly_logs.request_logs`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY hour, cacheStatus
ORDER BY hour DESC;

-- Top requested paths with performance metrics
SELECT 
  path,
  COUNT(*) as request_count,
  AVG(responseTime) as avg_response_time,
  COUNT(CASE WHEN cacheStatus = 'HIT' THEN 1 END) as cache_hits,
  COUNT(CASE WHEN cacheStatus = 'MISS' THEN 1 END) as cache_misses
FROM `your-project.fastly_logs.request_logs`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY path
ORDER BY request_count DESC
LIMIT 20;

-- Error analysis and monitoring
SELECT 
  eventType,
  error,
  COUNT(*) as error_count,
  AVG(responseTime) as avg_response_time,
  MIN(timestamp) as first_occurrence,
  MAX(timestamp) as last_occurrence
FROM `your-project.fastly_logs.request_logs`
WHERE eventType IN ('error', 's3_error')
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY eventType, error
ORDER BY error_count DESC;
```

## Technical Implementation Details

### Cache Strategy
- **Cache Key Format**: `s3-object:${path}` for consistent naming
- **TTL Configuration**: 800 seconds with immediate cache invalidation
- **Cache Override**: Uses Fastly's CacheOverride API for precise control
- **Stale-While-Revalidate**: Set to 0 for immediate cache updates

### S3 Integration
- **Dynamic Backend**: Configured S3 backend in Fastly for secure communication
- **Path Mapping**: Direct URL path to S3 object key mapping
- **Header Preservation**: Maintains all S3 response headers in cache
- **Error Handling**: Comprehensive error logging for S3 failures

### Logging Architecture
- **Dual Logging**: Both standard Fastly logging and BigQuery real-time logging
- **Structured Data**: JSON format with consistent schema across all log entries
- **Performance Metrics**: Response time tracking for every request
- **Error Context**: Detailed error information with request context
