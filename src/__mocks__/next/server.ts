/**
 * Mock for next/server
 * Provides mock implementations and test helpers for NextRequest and NextResponse
 */

/**
 * Extended URL class with clone() method (Next.js adds this)
 */
class NextURL extends URL {
  clone(): NextURL {
    return new NextURL(this.href);
  }
}

/**
 * Mock NextResponse class
 */
export class NextResponse {
  public status: number;
  public headers: Headers;
  public cookies: Map<string, any>;
  private body: any;

  constructor(body?: any, init?: { status?: number; headers?: HeadersInit }) {
    this.status = init?.status || 200;
    this.headers = new Headers(init?.headers);
    this.cookies = new Map();
    this.body = body;
  }

  static json(data: any, init?: { status?: number; headers?: HeadersInit }) {
    return new NextResponse(JSON.stringify(data), init);
  }

  static redirect(url: string | URL, init?: number | { status?: number; headers?: HeadersInit }) {
    const status = typeof init === 'number' ? init : (init?.status || 307);
    const headers = typeof init === 'object' && 'headers' in init ? init.headers : undefined;

    const response = new NextResponse(null, { status, headers });
    response.headers.set('Location', url.toString());
    return response;
  }

  static next(init?: { headers?: HeadersInit }) {
    return new NextResponse(null, { status: 200, headers: init?.headers });
  }

  json() {
    return JSON.parse(this.body);
  }
}

/**
 * Mock NextRequest class
 */
export class NextRequest {
  public url: string;
  public method: string;
  public headers: Headers;
  public cookies: {
    get: (name: string) => { name: string; value: string } | undefined;
    getAll: () => Array<{ name: string; value: string }>;
    set: (name: string, value: string) => void;
    delete: (name: string) => void;
    has: (name: string) => boolean;
  };
  public nextUrl: NextURL;
  private _body?: any;

  constructor(url: string, init?: RequestInit & { cookies?: Array<{ name: string; value: string }> }) {
    this.url = url;
    this.method = init?.method || 'GET';
    this.headers = new Headers(init?.headers);
    this.nextUrl = new NextURL(url);
    this._body = init?.body;

    // Setup cookies
    const cookieMap = new Map<string, string>();
    if (init?.cookies) {
      init.cookies.forEach(c => cookieMap.set(c.name, c.value));
    }

    this.cookies = {
      get: (name: string) => {
        const value = cookieMap.get(name);
        return value ? { name, value } : undefined;
      },
      getAll: () => {
        return Array.from(cookieMap.entries()).map(([name, value]) => ({ name, value }));
      },
      set: (name: string, value: string) => {
        cookieMap.set(name, value);
      },
      delete: (name: string) => {
        cookieMap.delete(name);
      },
      has: (name: string) => {
        return cookieMap.has(name);
      },
    };
  }

  async json() {
    return JSON.parse(this._body as string);
  }

  async text() {
    return this._body as string;
  }

  async formData() {
    const form = new FormData();
    if (typeof this._body === 'string') {
      const params = new URLSearchParams(this._body);
      params.forEach((value, key) => form.append(key, value));
    }
    return form;
  }
}

/**
 * Test helper to create a mock NextRequest with common options
 * Can be called with just a URL string or with full options object
 */
export function createMockNextRequest(
  urlOrOptions: string | {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    cookies?: Array<{ name: string; value: string }>;
    body?: any;
    searchParams?: Record<string, string>;
  },
  options?: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Array<{ name: string; value: string }>;
    body?: any;
    searchParams?: Record<string, string>;
  }
): NextRequest {
  // Handle both calling patterns
  const config = typeof urlOrOptions === 'string'
    ? { url: urlOrOptions, ...options }
    : urlOrOptions;

  let fullUrl = config.url;

  // Add search params if provided
  if (config.searchParams) {
    const url = new URL(config.url, 'http://localhost:3000');
    Object.entries(config.searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    fullUrl = url.toString();
  }

  return new NextRequest(fullUrl, {
    method: config.method,
    headers: config.headers,
    cookies: config.cookies,
    body: config.body,
  });
}

/**
 * Test helper to create a mock NextResponse
 */
export function createMockNextResponse(options?: {
  status?: number;
  headers?: Record<string, string>;
  body?: any;
}): NextResponse {
  return new NextResponse(options?.body, {
    status: options?.status,
    headers: options?.headers,
  });
}
