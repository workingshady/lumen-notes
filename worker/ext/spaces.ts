import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/** API routes for the "spaces" area. Mounted under /api. Use h.auth as middleware for owner-only routes. */
export default function register(api: Hono<Env>, h: Helpers) {
  void api;
  void h;
}
