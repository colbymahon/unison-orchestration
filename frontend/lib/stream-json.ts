/**
 * Lightweight JSON body parse — single text decode + one parse pass (no streaming tree walks).
 */
export async function parseJsonResponseBody<T = unknown>(res: Response): Promise<T> {
  const raw = await res.text();
  if (!raw.length) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}
