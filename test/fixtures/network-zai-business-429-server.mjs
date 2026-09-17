import { createServer } from "node:http";

function streamChunk(id, content, finishReason = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model: "glm-5.2",
    choices: [{
      index: 0,
      delta: content ? { role: "assistant", content } : {},
      finish_reason: finishReason
    }]
  })}\n\n`;
}

// zai/GLM's real structured business-error shape for HTTP 429 "Rate limit
// reached for requests" (documented at https://docs.z.ai/api-reference/api-code
// as error code 1302). The runtime's shared fetch layer recognizes this shape
// and wraps it into a `ProviderBusinessError`, which is a plain `Error`
// subclass that (before the provider-business-error-retry-classification
// patch) carries none of the AI SDK's own `APICallError` retry machinery, so
// it never reached the SDK-level exponential-backoff retry loop that already
// parses `retry-after`/`retry-after-ms` response headers for every other
// provider.
const failuresBeforeSuccess = Number(process.env.ZCODE_TEST_429_FAILURES ?? 2);
let requestCount = 0;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  const parsed = body ? JSON.parse(body) : {};
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  requestCount += 1;
  process.stdout.write(`REQUEST ${requestCount}\n`);

  if (requestCount <= failuresBeforeSuccess) {
    response.writeHead(429, {
      "content-type": "application/json",
      "retry-after-ms": "20"
    });
    response.end(JSON.stringify({
      error: {
        code: "1302",
        message: "Rate limit reached for requests"
      }
    }));
    return;
  }

  if (parsed.stream !== true) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "chatcmpl-non-stream",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model: "glm-5.2",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "RECOVERED_FINAL" },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
    return;
  }

  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(streamChunk("chatcmpl-recovered", "RECOVERED_FINAL"));
  response.write(streamChunk("chatcmpl-recovered", "", "stop"));
  response.end("data: [DONE]\n\n");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no TCP port.");
  process.stdout.write(`READY ${address.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
