import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const blocked: RequestHandler = async () =>
  json({ error: "This endpoint is server-only" }, { status: 404 });

export const GET = blocked;
export const HEAD = blocked;
export const OPTIONS = blocked;
export const POST = blocked;
export const PUT = blocked;
export const PATCH = blocked;
export const DELETE = blocked;
