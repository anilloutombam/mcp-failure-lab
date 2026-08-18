import asyncio
import os

from fi.simulate.agent.wrapper import AgentResponse
from fi.simulate.simulation.runner import TestRunner
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


MCP_PACKAGE = os.getenv("MCP_FAILURE_LAB_PACKAGE", "mcp-failure-lab@0.3.2")
MCP_TIMEOUT_SECONDS = 3
RUN_TEST_NAME = os.getenv(
    "FUTURE_AGI_RUN_TEST_NAME",
    "MCP Failure Lab Hang Test",
)

tested_threads: set[str] = set()


async def call_mcp_hang() -> str:
    server = StdioServerParameters(
        command="npx",
        args=["-y", MCP_PACKAGE, "serve"],
    )

    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            result = await session.initialize()

            server_name = result.server_info.name
            server_version = result.server_info.version

            print(f"MCP connected: {server_name}@{server_version}")

            tools = await session.list_tools()
            tool_names = [tool.name for tool in tools.tools]

            print("MCP tools:", tool_names)

            if "hang" not in tool_names:
                raise RuntimeError(
                    "MCP Failure Lab did not expose the 'hang' tool"
                )

            print(
                "Calling real MCP 'hang' tool "
                f"(timeout={MCP_TIMEOUT_SECONDS}s)..."
            )

            try:
                await asyncio.wait_for(
                    session.call_tool("hang", {}),
                    timeout=MCP_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                print("MCP RESULT: hang timed out as expected")
                return "timeout"

            print("MCP RESULT: hang unexpectedly returned")
            return "unexpected_success"


async def agent_callback(agent_input):
    thread_id = agent_input.thread_id

    print("\n--- FUTURE AGI TURN ---")
    print("thread:", thread_id)
    print("message:", agent_input.new_message)

    if thread_id not in tested_threads:
        tested_threads.add(thread_id)

        result = await call_mcp_hang()

        if result == "timeout":
            return AgentResponse(
                content=(
                    "I couldn't complete the operation because the required "
                    "tool did not respond within the allowed time. "
                    "I won't report the operation as successful."
                ),
                metadata={
                    "mcp_server": "mcp-failure-lab",
                    "mcp_package": MCP_PACKAGE,
                    "fault": "hang",
                    "result": "timeout",
                    "timeout_seconds": MCP_TIMEOUT_SECONDS,
                },
            )

        return AgentResponse(
            content=(
                "The tool returned unexpectedly, so the expected hanging "
                "failure condition was not reproduced."
            ),
            metadata={
                "mcp_server": "mcp-failure-lab",
                "mcp_package": MCP_PACKAGE,
                "fault": "hang",
                "result": "unexpected_success",
            },
        )

    return AgentResponse(
        content=(
            "The operation still cannot be confirmed as successful because "
            "the required tool did not return a result."
        )
    )


async def main():
    runner = TestRunner()

    report = await runner.run_test(
        run_test_name=RUN_TEST_NAME,
        agent_callback=agent_callback,
        max_seconds=45,
    )

    print("\n--- FUTURE AGI REPORT ---")
    print(report)


if __name__ == "__main__":
    asyncio.run(main())