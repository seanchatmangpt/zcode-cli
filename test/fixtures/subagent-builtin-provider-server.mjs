import { createServer } from "node:http";

function chunk(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-subagent-fixture",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`;
}

function toolNames(body) {
  return (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean);
}

// One OpenAI-compatible endpoint standing in for the configured `zai` provider.
// Parent turn 1 (has the Agent tool, no tool result yet) asks for a subagent;
// the subagent turn (no Agent tool) answers PONG; parent turn 2 (has a tool
// result) reports what the subagent returned.
const server = createServer(async (request, response) => {
  let raw = "";
  for await (const part of request) raw += part.toString();
  const body = raw ? JSON.parse(raw) : {};
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  const messages = body.messages ?? [];
  const hasToolResult = messages.some((message) => message.role === "tool");
  const canSpawn = toolNames(body).includes("Agent");
  const role = hasToolResult ? "parent-final" : canSpawn ? "parent-spawn" : "subagent";
  process.stdout.write(`REQUEST role=${role} model=${body.model}\n`);

  const stream = body.stream === true;
  if (role === "parent-spawn") {
    const args = JSON.stringify({
      description: "Reply PONG",
      prompt: "Your entire task is to reply with the single word PONG.",
      subagent_type: "general-purpose"
    });
    if (!stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "chatcmpl-spawn",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: "fixture",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_agent_1", type: "function", function: { name: "Agent", arguments: args } }]
          },
          finish_reason: "tool_calls"
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk({
      role: "assistant",
      tool_calls: [{ index: 0, id: "call_agent_1", type: "function", function: { name: "Agent", arguments: args } }]
    }));
    response.write(chunk({}, "tool_calls"));
    response.end("data: [DONE]\n\n");
    return;
  }

  const text = role === "subagent" ? "PONG" : "SUBAGENT_RETURNED_PONG";
  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "chatcmpl-text",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model: "fixture",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(chunk({ role: "assistant", content: text }));
  response.write(chunk({}, "stop"));
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
