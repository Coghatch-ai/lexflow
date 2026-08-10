// api/handler.ts
//
// Lambda entry point. Dispatches:
//   1. OPTIONS preflight → CORS 200
//   2. POST /webhooks/clerk → webhook handler (before tRPC, no auth required)
//   3. anything else → tRPC adapter

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { awsLambdaRequestHandler } from "@trpc/server/adapters/aws-lambda";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";
import { logTrpcError } from "./trpc/log-error";
import { handleWebhookRoutes } from "./routes/webhook-routes";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, svix-id, svix-timestamp, svix-signature",
};

const trpcHandler = awsLambdaRequestHandler({
  router: appRouter,
  createContext,
  onError: logTrpcError,
});

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const { method } = event.requestContext.http;

  // Path normalisation — do NOT use requestContext.http.path directly. The custom domain
  // (api.probius.app) maps to a NAMED stage via a root ApiMapping, so that field arrives as
  // "/prod/webhooks/clerk", while the {proxy+} catch-all exposes the stage-free remainder in
  // pathParameters.proxy ("webhooks/clerk"). Matching the raw field meant POST /webhooks/clerk
  // never equalled "/webhooks/clerk", fell through to tRPC and 404'd — so no user.created event
  // has ever been processed and no users row was ever provisioned (issue #64). Prefer the proxy
  // remainder; fall back to the raw path for non-catch-all invocations.
  const proxy = event.pathParameters?.["proxy"];
  const path = proxy === undefined ? event.requestContext.http.path : `/${proxy}`;

  if (method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const webhookResult = await handleWebhookRoutes(method, path, event.body ?? "", event.headers);
  if (webhookResult) {
    return { ...webhookResult, headers: { ...webhookResult.headers, ...CORS_HEADERS } };
  }

  const response = await trpcHandler(event, context);
  return {
    ...response,
    headers: { ...response.headers, ...CORS_HEADERS },
  };
};

export type AppRouter = typeof appRouter;
