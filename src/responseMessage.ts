import {
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type RequestId,
} from "@modelcontextprotocol/server";

export function responseId(message: JSONRPCMessage): RequestId | undefined {
  return isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)
    ? message.id
    : undefined;
}
