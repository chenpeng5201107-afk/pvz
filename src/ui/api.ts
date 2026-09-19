export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError('连接不到本地服务，请确认启动窗口仍在运行，然后重试。', 0);
  }
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(result.error ?? '请求失败，请稍后重试。', response.status);
  return result;
}
