import { describe, expect, it, vi } from "vitest";
import {
  MicropubClient,
  validateEndpoint,
  type HttpRequest,
  type HttpResponse,
} from "../src/micropub";
const endpoint = "https://oncemarked.com/micropub";
const response = (
  status: number,
  headers: Record<string, string> = {},
  body: unknown = {},
) => ({ status, headers, text: JSON.stringify(body) });
const setup = (value: HttpResponse) => {
  const transport = vi
    .fn<(request: HttpRequest) => Promise<HttpResponse>>()
    .mockResolvedValue(value);
  return {
    transport,
    client: new MicropubClient(endpoint, "test-token", transport),
  };
};

describe("Micropub boundary", () => {
  it.each([
    "http://oncemarked.com/micropub",
    "https://user:secret@oncemarked.com/micropub",
    `${endpoint}?token=secret`,
    `${endpoint}#token`,
    "https://oncemarked.com/other",
  ])("rejects unsafe endpoint %s", (input) => {
    expect(() => validateEndpoint(input)).toThrow();
  });
  it("tests configuration using a header token, without publishing", async () => {
    const { client, transport } = setup(
      response(200, {}, { "media-endpoint": "/micropub/media" }),
    );
    expect(await client.config()).toEqual({
      mediaEndpoint: `${endpoint}/media`,
    });
    expect(transport).toHaveBeenCalledWith({
      url: `${endpoint}?q=config`,
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
    });
  });
  it("rejects a media endpoint on an unrelated origin", async () => {
    const { client } = setup(
      response(
        200,
        {},
        { "media-endpoint": "https://other.example/micropub/media" },
      ),
    );
    await expect(client.config()).rejects.toThrow("unexpected media endpoint");
  });
  it("requires an explicit publication state before creating", async () => {
    const { client, transport } = setup(response(201));
    await expect(client.create({ content: ["hello"] }, "key")).rejects.toThrow(
      "explicitly",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it("sends the exact mutation key and reads case-insensitive Location", async () => {
    const { client, transport } = setup(
      response(201, { location: "/blogs/entries/post?blog=blog" }),
    );
    expect(
      await client.create(
        { content: ["hello"], "post-status": ["draft"] },
        "durable-key",
      ),
    ).toBe("https://oncemarked.com/blogs/entries/post?blog=blog");
    expect(transport.mock.calls[0]?.[0].headers["Idempotency-Key"]).toBe(
      "durable-key",
    );
  });
  it("retains the new URL when a draft becomes public", async () => {
    const { client } = setup(
      response(201, { Location: "https://writer.example/hello" }),
    );
    expect(
      await client.update(
        "https://oncemarked.com/blogs/entries/a",
        { "post-status": ["published"] },
        "key",
      ),
    ).toBe("https://writer.example/hello");
  });
  it("retains the existing URL for a normal update", async () => {
    const { client } = setup(response(204));
    expect(
      await client.update(
        "https://writer.example/hello",
        { content: ["edited"] },
        "key",
      ),
    ).toBe("https://writer.example/hello");
  });
  it("does not retry uncertain writes or surface server-supplied secrets", async () => {
    const { client, transport } = setup(
      response(409, {}, { error_description: "test-token" }),
    );
    await expect(
      client.create({ "post-status": ["draft"] }, "key"),
    ).rejects.toThrow("reconciliation");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("treats missing Location as uncertain rather than creating again", async () => {
    const { client, transport } = setup(response(201));
    await expect(
      client.create({ "post-status": ["draft"] }, "key"),
    ).rejects.toThrow("may have been saved");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("preserves Retry-After without automatically resending", async () => {
    const { client, transport } = setup(
      response(429, { "retry-after": "120" }),
    );
    await expect(client.config()).rejects.toMatchObject({
      status: 429,
      retryAfter: "120",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("validates source properties", async () => {
    const { client } = setup(
      response(200, {}, { properties: { content: "not-an-array" } }),
    );
    await expect(client.source("https://writer.example/post")).rejects.toThrow(
      "invalid post properties",
    );
  });
});

it("sends image options in multipart and rejects unavailable settings before upload", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      response(
        200,
        {},
        {
          "media-endpoint": "/micropub/media",
          oncemarked: {
            imageOptions: {
              sizes: [640, 960, 1600],
              minQuality: 80,
              maxQuality: 80,
            },
          },
        },
      ),
    )
    .mockResolvedValueOnce(
      response(201, { Location: "https://writer.example/__media/test.webp" }),
    );
  const client = new MicropubClient(endpoint, "test-token", transport);
  await client.upload(
    new Uint8Array([1, 2, 3]).buffer,
    "image/png",
    "image-options",
    { maxEdge: 1600, quality: 80 },
  );
  const body = new TextDecoder().decode(transport.mock.calls[1]![0].body);
  expect(body).toContain('name="quality"\r\n\r\n80');
  expect(body).toContain('name="maxEdge"\r\n\r\n1600');
  transport.mockResolvedValue(
    response(
      200,
      {},
      {
        "media-endpoint": "/micropub/media",
        oncemarked: {
          imageOptions: {
            sizes: [640, 960, 1600],
            minQuality: 80,
            maxQuality: 80,
          },
        },
      },
    ),
  );
  await expect(
    client.upload(new ArrayBuffer(1), "image/png", "pro", {
      maxEdge: 1920,
      quality: 80,
    }),
  ).rejects.toThrow("Pro");
  expect(transport).toHaveBeenCalledTimes(3);
});
it("retains stable source identity and sends the reviewed revision", async () => {
  const stable =
    "https://oncemarked.com/blogs/entries/12345678-1234-4123-8123-123456789012";
  const revision = "2026-09-06T12:00:00.000Z";
  const { client, transport } = setup(
    response(
      200,
      {},
      {
        properties: { content: ["post"] },
        oncemarked: {
          sourceUrl: stable,
          url: "https://writer.example/new-slug",
          mediaBase: "https://writer.example/",
          revision,
        },
      },
    ),
  );
  expect(await client.source("https://writer.example/old-slug")).toMatchObject({
    "oncemarked-sourceUrl": [stable],
    "oncemarked-url": ["https://writer.example/new-slug"],
    "oncemarked-mediaBase": ["https://writer.example/"],
    "oncemarked-revision": [revision],
  });
  transport.mockResolvedValue(
    response(204, { Location: "https://writer.example/new-slug" }),
  );
  expect(
    await client.update(stable, { content: ["edited"] }, "edit", revision),
  ).toBe("https://writer.example/new-slug");
  expect(
    JSON.parse(transport.mock.calls[1]![0].body as string)[
      "oncemarked-if-unmodified"
    ],
  ).toBe(revision);
});

it("loads literal custom suggestions and rejects malformed catalogues", async () => {
  const variables = [
    {
      name: "greeting",
      description: "greeting",
      source: "{{ greeting }}",
      block: false,
    },
  ];
  const { client, transport } = setup(response(200, {}, { variables }));
  expect(await client.variables()).toEqual(variables);
  transport.mockResolvedValue(
    response(200, {}, { variables: [{ name: "bad name" }] }),
  );
  await expect(client.variables()).rejects.toThrow(
    "invalid variable catalogue",
  );
});
