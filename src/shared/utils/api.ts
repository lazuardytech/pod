/**
 * API utility functions for making HTTP requests
 */

type RequestOptions = Omit<RequestInit, "body" | "method"> & { headers?: Record<string, string> };

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function handleResponse<T = unknown>(response: Response): Promise<T> {
  const data = (await response.json()) as unknown;

  if (!response.ok) {
    const errorMessage =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "An error occurred";
    const error = new ApiError(errorMessage, response.status, data);
    throw error;
  }

  return data as T;
}

export async function get<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse<T>(response);
}

export async function post<T = unknown>(url: string, data: unknown, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse<T>(response);
}

export async function put<T = unknown>(url: string, data: unknown, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse<T>(response);
}

export async function del<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse<T>(response);
}

const api = { get, post, put, del };
export default api;
