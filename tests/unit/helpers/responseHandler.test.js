import { describe, expect, it, vi } from "vitest";
import {
  handleErrorResponse,
  setGeneralResponse
} from "../../../src/api/helpers/responseHandler.helpers.js";

function mockReply(requestId = "rq1") {
  const reply = { request: { id: requestId } };
  reply.status = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  return reply;
}

function mockRequest(requestId = "rq1") {
  return { id: requestId, log: { error: vi.fn(), warn: vi.fn() } };
}

describe("setGeneralResponse", () => {
  it("wraps the success payload in the standard envelope", () => {
    const reply = mockReply("rq42");
    setGeneralResponse(reply, 200, "Success", "All good", { foo: "bar" });
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      traceId: "rq42",
      code: 200,
      title: "Success",
      message: "All good",
      data: { foo: "bar" },
      errors: []
    });
  });
});

describe("handleErrorResponse", () => {
  it("returns 500 for unknown errors and logs at error level", () => {
    const reply = mockReply();
    const request = mockRequest();
    const err = new Error("boom");
    handleErrorResponse(reply, err, request);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(request.log.error).toHaveBeenCalled();
  });

  it("respects an explicit statusCode and logs at warn level for 4xx", () => {
    const reply = mockReply();
    const request = mockRequest();
    const err = new Error("nope");
    err.statusCode = 401;
    err.title = "Unauthorized";
    handleErrorResponse(reply, err, request);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(request.log.warn).toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 401, title: "Unauthorized", message: "nope" })
    );
  });

  it("includes Fastify validation errors as the errors array", () => {
    const reply = mockReply();
    const request = mockRequest();
    const err = new Error("validation failed");
    err.statusCode = 400;
    err.validation = [{ message: "must be string" }, { message: "must be non-empty" }];
    handleErrorResponse(reply, err, request);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: ["must be string", "must be non-empty"]
      })
    );
  });
});
