import type { Variable } from "./variables";
export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string | ArrayBuffer;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;
export type Properties = Record<string, unknown[]>;

export function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid OnceMarked endpoint URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/micropub"
  ) {
    throw new Error(
      "Use an HTTPS /micropub endpoint without credentials, query parameters or a fragment.",
    );
  }
  return url.href;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("OnceMarked returned an invalid JSON response.");
  }
  if (!object(value))
    throw new Error("OnceMarked returned an unexpected response.");
  return value;
}
function header(response: HttpResponse, name: string): string | undefined {
  return Object.entries(response.headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

export class MicropubError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfter?: string,
  ) {
    super(
      status === 401
        ? "The app token is missing or revoked."
        : status === 403
          ? "This app token does not permit this action."
          : status === 409
            ? "This request needs reconciliation before retrying."
            : status === 429
              ? "OnceMarked has reached a request limit. Try again later."
              : `OnceMarked could not complete the request (HTTP ${status}).`,
    );
  }
}

/** No implicit retries. The caller must persist keys and reconcile uncertain writes. */
export class MicropubClient {
  private readonly endpoint: string;
  constructor(
    endpoint: string,
    private readonly token: string,
    private readonly transport: Transport,
  ) {
    this.endpoint = validateEndpoint(endpoint);
    if (!token.trim() || /[\r\n]/.test(token))
      throw new Error("Select a valid app token.");
  }

  private async send(
    url: string,
    body?: object,
    key?: string,
  ): Promise<HttpResponse> {
    if (key !== undefined && !/^[\x21-\x7e]{1,128}$/.test(key))
      throw new Error("Invalid mutation key.");
    const response = await this.transport({
      url,
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status < 200 || response.status >= 300)
      throw new MicropubError(response.status, header(response, "Retry-After"));
    return response;
  }

  async config(): Promise<{
    mediaEndpoint: string;
    imageOptions?: { sizes: number[]; minQuality: number; maxQuality: number };
  }> {
    const response = await this.send(`${this.endpoint}?q=config`);
    const data = parseObject(response.text);
    if (typeof data["media-endpoint"] !== "string")
      throw new Error(
        "The endpoint did not provide OnceMarked media configuration.",
      );
    const media = new URL(data["media-endpoint"], this.endpoint);
    if (
      media.origin !== new URL(this.endpoint).origin ||
      media.pathname !== "/micropub/media" ||
      media.username ||
      media.password ||
      media.search ||
      media.hash
    ) {
      throw new Error("OnceMarked returned an unexpected media endpoint.");
    }
    const extension = data.oncemarked;
    const options = object(extension) ? extension.imageOptions : undefined;
    return {
      mediaEndpoint: media.href,
      ...(object(options) &&
      Array.isArray(options.sizes) &&
      options.sizes.every((size) => typeof size === "number") &&
      typeof options.minQuality === "number" &&
      typeof options.maxQuality === "number"
        ? {
            imageOptions: {
              sizes: options.sizes,
              minQuality: options.minQuality,
              maxQuality: options.maxQuality,
            },
          }
        : {}),
    };
  }

  async variables(): Promise<Variable[]> {
    const response = await this.send(`${this.endpoint}?q=oncemarked-variables`);
    const data = parseObject(response.text);
    if (
      !Array.isArray(data.variables) ||
      !data.variables.every(
        (item) =>
          object(item) &&
          typeof item.name === "string" &&
          /^[a-z][a-z_]{0,47}$/.test(item.name) &&
          typeof item.description === "string" &&
          typeof item.source === "string" &&
          typeof item.block === "boolean",
      )
    )
      throw new Error("OnceMarked returned an invalid variable catalogue.");
    return data.variables as Variable[];
  }

  async source(url: string): Promise<Properties> {
    const query = new URLSearchParams({ q: "source", url });
    const response = await this.send(`${this.endpoint}?${query}`);
    const data = parseObject(response.text);
    if (
      !object(data.properties) ||
      !Object.values(data.properties).every(Array.isArray)
    )
      throw new Error("OnceMarked returned invalid post properties.");
    const properties = data.properties as Properties;
    if (object(data.oncemarked)) {
      for (const field of ["sourceUrl", "url", "mediaBase"] as const) {
        const value = data.oncemarked[field];
        if (typeof value !== "string") continue;
        const address = new URL(value);
        if (
          address.protocol !== "https:" ||
          address.username ||
          address.password
        )
          throw new Error("OnceMarked returned an invalid source address.");
        if (
          field === "sourceUrl" &&
          (address.origin !== new URL(this.endpoint).origin ||
            !/^\/blogs\/entries\/[a-f0-9-]{36}$/.test(address.pathname))
        )
          throw new Error("OnceMarked returned an invalid stable address.");
        if (
          field === "mediaBase" &&
          (address.pathname !== "/" || address.search || address.hash)
        )
          throw new Error("OnceMarked returned an invalid media address.");
        properties[`oncemarked-${field}`] = [address.href];
      }
    }
    if (object(data.oncemarked) && typeof data.oncemarked.revision === "string")
      properties["oncemarked-revision"] = [data.oncemarked.revision];
    return properties;
  }

  async create(properties: Properties, key: string): Promise<string> {
    if (
      !["draft", "published"].includes(String(properties["post-status"]?.[0]))
    )
      throw new Error("Choose draft or published explicitly.");
    const response = await this.send(
      this.endpoint,
      { type: ["h-entry"], properties },
      key,
    );
    if (response.status !== 201)
      throw new Error(
        "Unexpected create response. Check OnceMarked before retrying.",
      );
    return this.location(response);
  }

  async update(
    url: string,
    replace: Properties,
    key: string,
    revision?: string,
  ): Promise<string> {
    const response = await this.send(
      this.endpoint,
      {
        action: "update",
        url,
        replace,
        ...(revision ? { "oncemarked-if-unmodified": revision } : {}),
      },
      key,
    );
    if (response.status === 201) return this.location(response);
    if (response.status !== 204)
      throw new Error(
        "Unexpected update response. Check OnceMarked before retrying.",
      );
    return header(response, "Location") ? this.location(response) : url;
  }

  private assertImageOptions(
    options: { maxEdge: number; quality: number } | undefined,
    imageOptions:
      { sizes: number[]; minQuality: number; maxQuality: number } | undefined,
  ): void {
    if (options && !imageOptions)
      throw new Error("Update OnceMarked before uploading with image options.");
    if (
      options &&
      imageOptions &&
      (!imageOptions.sizes.includes(options.maxEdge) ||
        options.quality < imageOptions.minQuality ||
        options.quality > imageOptions.maxQuality)
    )
      throw new Error(
        "These image settings require OnceMarked Pro. For a Free blog choose at most 1600 pixels and quality 80 in global settings.",
      );
  }
  async checkImageOptions(options: {
    maxEdge: number;
    quality: number;
  }): Promise<void> {
    this.assertImageOptions(options, (await this.config()).imageOptions);
  }

  async upload(
    bytes: ArrayBuffer,
    mime: string,
    key: string,
    options?: { maxEdge: number; quality: number },
  ): Promise<string> {
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
      throw new Error("Unsupported image format.");
    if (!/^[\x21-\x7e]{1,128}$/.test(key))
      throw new Error("Invalid mutation key.");
    const { mediaEndpoint, imageOptions } = await this.config();
    this.assertImageOptions(options, imageOptions);
    // A stable boundary makes a recovered request byte-for-byte reproducible.
    const boundary = "om-" + key.replace(/[^a-zA-Z0-9-]/g, "");
    const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const fields = options
      ? Object.entries(options)
          .map(
            ([name, value]) =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
          )
          .join("")
      : "";
    const head = new TextEncoder().encode(
      fields +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.${extension}"\r\nContent-Type: ${mime}\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + bytes.byteLength + tail.length);
    body.set(head);
    body.set(new Uint8Array(bytes), head.length);
    body.set(tail, head.length + bytes.byteLength);
    const response = await this.transport({
      url: mediaEndpoint,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Idempotency-Key": key,
      },
      body: body.buffer,
    });
    if (response.status < 200 || response.status >= 300)
      throw new MicropubError(response.status, header(response, "Retry-After"));
    if (response.status !== 201)
      throw new Error(
        "Unexpected upload response. Check the image library before retrying.",
      );
    return this.location(response);
  }

  private location(response: HttpResponse): string {
    const value = header(response, "Location");
    if (!value)
      throw new Error(
        "The post may have been saved, but its address is missing. Check OnceMarked before retrying.",
      );
    const url = new URL(value, this.endpoint);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("OnceMarked returned an invalid post address.");
    return url.href;
  }
}
