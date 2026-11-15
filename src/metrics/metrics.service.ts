import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createServer, type Server } from 'node:http';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

// Seconds. prom-client's defaults start at 5ms, and most requests here take
// under 1ms, so p95 would always read as "somewhere below 5ms". The same
// buckets as importer's.
const LATENCY_BUCKETS = [
  0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
  10,
];

const PROBES = new Set(['/healthz', '/readyz']);

// The route Nest registers last to answer 404 for any path no controller
// matched. Counted as "unmatched", like a request that matched no route at all.
const NOT_FOUND_ROUTE = '{/*splat}';

// Prometheus metrics, served on their own port (METRICS_PORT) so they aren't
// reachable through the Service. Main series:
//
//   http_server_request_duration_seconds   requests by route, method and status
//   nodejs_*, process_*                    Node runtime and process
//
// The label names follow OpenTelemetry's, like importer's, so the same
// dashboard queries work on both.
@Injectable()
export class MetricsService implements OnApplicationShutdown {
  // Own registry instead of prom-client's global one, so tests can build the
  // app more than once.
  readonly registry = new Registry();
  private readonly requestDuration: Histogram<
    'http_request_method' | 'http_route' | 'http_response_status_code'
  >;
  private server?: Server;
  private readonly log = new Logger(MetricsService.name);

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.requestDuration = new Histogram({
      name: 'http_server_request_duration_seconds',
      help: 'Duration of HTTP server requests.',
      labelNames: [
        'http_request_method',
        'http_route',
        'http_response_status_code',
      ],
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });
  }

  // Express middleware recording every request but the probes. The route is
  // the matched pattern (/items/:id), not the path, so IDs don't each become
  // a series; requests no route matched share "unmatched".
  readonly middleware = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (PROBES.has(req.path)) return next();
    const end = this.requestDuration.startTimer();
    res.once('finish', () => {
      const route: unknown = req.route;
      const pattern =
        route &&
        typeof route === 'object' &&
        'path' in route &&
        typeof route.path === 'string' &&
        route.path !== NOT_FOUND_ROUTE
          ? req.baseUrl + route.path
          : 'unmatched';
      end({
        http_request_method: req.method,
        http_route: pattern,
        http_response_status_code: res.statusCode,
      });
    });
    next();
  };

  listen(port: number): Promise<void> {
    this.server = createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      this.registry.metrics().then(
        (body) =>
          res
            .writeHead(200, { 'Content-Type': this.registry.contentType })
            .end(body),
        (err: unknown) => {
          this.log.error(`collecting metrics failed: ${String(err)}`);
          res.writeHead(500).end();
        },
      );
    });
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject).listen(port, () => resolve());
    });
  }

  // Last, after the HTTP server: Prometheus can still scrape a draining pod.
  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
