export function ok(data = {}) {
  return { ok: true, ...data };
}

export function fail(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

export async function runMessage(handler, context) {
  try {
    const result = await handler(context);
    return result ?? ok();
  } catch (error) {
    console.error("Background handler error:", error);
    return fail(error);
  }
}
