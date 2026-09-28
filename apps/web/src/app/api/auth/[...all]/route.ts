/**
 * ⚠ ANYTHING PLATFORM — DO NOT REWRITE THIS FILE ⚠
 *
 * Shipped v2 better-auth catch-all. `toNextJsHandler(auth)` wires up every
 * better-auth endpoint (/sign-up/email, /sign-in/email, /get-session, ...).
 * Do not hand-roll your own routes for these paths; it will conflict with
 * this handler and break signup/signin/session lookup.
 */
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";

const handler = toNextJsHandler(auth);

/**
 * OBSERVABILITY FIX (defect: unlogged signup 500).
 *
 * `toNextJsHandler` swallows upstream errors, so a failure inside better-auth
 * surfaced only as a bare `500` with an HTML body and NOTHING in the server log.
 * That is how a real, reproducible signup failure went undiagnosed across
 * several probe runs: there was no error to read.
 *
 * The auth endpoints are the most important ones in the product - a silent 500
 * on sign-up is indistinguishable, from the outside, from "the app is broken".
 * Failures are now logged with the path and the underlying message, and the
 * client still receives a generic body (no internal detail is disclosed).
 */
function instrument(name: "GET" | "POST", fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const res = await fn(req);
      // better-auth reports its own failures as a 5xx RESPONSE rather than a
      // thrown error, so a try/catch alone logs nothing. Both are covered:
      // without this, an upstream failure is invisible and reads as "the app
      // is broken" with no diagnostic.
      if (res.status >= 500) {
        const body = await res.clone().text().catch(() => '');
        console.error(
          `[auth] ${name} ${new URL(req.url).pathname} -> ${res.status}: ${body.slice(0, 400)}`
        );
      }
      return res;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[auth] ${name} ${new URL(req.url).pathname} failed:`, message);
      if (error instanceof Error && error.stack) console.error(error.stack);
      return NextResponse.json(
        { error: "Authentication service unavailable" },
        { status: 500 }
      );
    }
  };
}

export const GET = instrument("GET", handler.GET as (req: Request) => Promise<Response>);
export const POST = instrument("POST", handler.POST as (req: Request) => Promise<Response>);
