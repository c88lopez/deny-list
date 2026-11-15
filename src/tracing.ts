// OpenTelemetry tracing. It must load before anything it instruments, so it
// isn't imported by main.ts: node runs it first with
// `node --import ./dist/tracing.js dist/main.js`.
//
// Off when OTEL_EXPORTER_OTLP_ENDPOINT is unset. In the cluster it's Alloy
// (k8s/api/10-configmap.yaml), which forwards to Tempo. The SDK reads the
// standard OTEL_* variables too (OTEL_SERVICE_NAME, OTEL_TRACES_SAMPLER...).
import { register } from 'node:module';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { NodeSDK } from '@opentelemetry/sdk-node';

const PROBES = new Set(['/healthz', '/readyz']);

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // The app is ESM: this hook lets the instrumentations patch modules loaded
  // with `import`, not only `require`.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'deny-list',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        // The kubelet's probes would be most of the traces.
        ignoreIncomingRequestHook: (req) => PROBES.has(req.url ?? ''),
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      // Adds trace_id and span_id to log lines written inside a span.
      new PinoInstrumentation(),
    ],
  });
  sdk.start();

  // Flush the spans still buffered. It runs alongside Nest's shutdown, and
  // the process exits when both are done.
  process.once('SIGTERM', () => {
    sdk.shutdown().catch((err: unknown) => {
      console.error('tracing shutdown failed', err);
    });
  });
}
