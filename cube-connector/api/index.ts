/**
 * Vercel entry point. Vercel runs request functions from api/, not a
 * long-running server, so this hands every request to the connector's
 * Web-standard handler. vercel.json sends every path here (/mcp and the
 * OAuth discovery addresses). Local `npm run dev` doesn't use this file.
 */

import server from "../src/server.js";

const handle = (request: Request): Promise<Response> => server.fetch(request);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
