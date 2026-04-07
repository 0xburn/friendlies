const START_GG_ENDPOINT = 'https://api.start.gg/gql/alpha';

export interface StartGgGraphqlResult<T> {
  data: T | null;
  errors?: { message: string }[];
}

/** Reads START_GG_TOKEN from the environment (main process only). Never log the token. */
export function getStartGgToken(): string | null {
  const t = process.env.START_GG_TOKEN?.trim();
  return t || null;
}

let _lastTokenSource: 'oauth' | 'env' | 'none' = 'none';
export function getLastTokenSource() { return _lastTokenSource; }

export async function startGgGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string,
  userToken?: string | null,
): Promise<StartGgGraphqlResult<T>> {
  const token = userToken || getStartGgToken();
  _lastTokenSource = userToken ? 'oauth' : token ? 'env' : 'none';
  if (!token) {
    console.warn(`[startgg-gql] ${operationName ?? 'query'}: NO TOKEN AVAILABLE`);
    return { data: null, errors: [{ message: 'No start.gg token available (link your start.gg account or set START_GG_TOKEN)' }] };
  }

  try {
    const res = await fetch(START_GG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: variables ?? {},
        ...(operationName ? { operationName } : {}),
      }),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { data: null, errors: [{ message: 'Invalid JSON from start.gg' }] };
    }

    if (!res.ok) {
      return {
        data: null,
        errors: [{ message: json?.message || `HTTP ${res.status}` }],
      };
    }

    return {
      data: json.data ?? null,
      errors: json.errors,
    };
  } catch (e: any) {
    return { data: null, errors: [{ message: e?.message || 'Network error' }] };
  }
}
