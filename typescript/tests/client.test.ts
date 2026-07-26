import { describe, expect, it } from "vitest";
import { Client, defaultClientConfig } from "../src/client.js";

describe("Client", () => {
  it("uses the default endpoint", () => {
    const client = new Client();
    expect(client.config.endpoint).toBe("https://rpc.openfiat.org");
  });

  it("accepts a custom config", () => {
    const config = { ...defaultClientConfig(), endpoint: "http://localhost:8899" };
    const client = new Client(config);
    expect(client.config.endpoint).toBe("http://localhost:8899");
  });
});
