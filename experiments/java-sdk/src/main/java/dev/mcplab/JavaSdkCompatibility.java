package dev.mcplab;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.client.transport.ServerParameters;
import io.modelcontextprotocol.client.transport.StdioClientTransport;
import io.modelcontextprotocol.json.McpJsonDefaults;
import io.modelcontextprotocol.spec.McpClientTransport;
import io.modelcontextprotocol.spec.McpSchema;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class JavaSdkCompatibility {
    private static final String FAILURE_LAB_VERSION = "0.11.0";
    private static final String JAVA_SDK_VERSION = "2.0.1";
    private static final int HTTP_PORT = 43123;
    private static final List<Result> RESULTS = new ArrayList<>();

    private record Result(int run, String transport, String scenario, boolean passed,
                          long durationMs, String observation) {}

    @FunctionalInterface
    private interface Check {
        String run(McpSyncClient client) throws Exception;
    }

    public static void main(String[] args) throws Exception {
        System.out.printf("Java %s; MCP Java SDK %s; mcp-failure-lab@%s%n",
                System.getProperty("java.version"), JAVA_SDK_VERSION, FAILURE_LAB_VERSION);
        prewarmPublishedPackage();

        for (int run = 1; run <= 3; run++) {
            runTransportMatrix(run, "stdio");
        }

        Process httpServer = startHttpServer();
        try {
            waitForHttpServer();
            for (int run = 1; run <= 3; run++) {
                runTransportMatrix(run, "streamable-http");
            }
        } finally {
            httpServer.destroy();
            if (!httpServer.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                httpServer.destroyForcibly();
            }
        }

        Path output = Path.of("/results/java-sdk-2.0.1-results.json");
        Files.createDirectories(output.getParent());
        Files.writeString(output, toJson(), StandardCharsets.UTF_8);
        long failures = RESULTS.stream().filter(result -> !result.passed()).count();
        System.out.printf("Wrote %d results (%d failed) to %s%n", RESULTS.size(), failures, output);
    }

    private static void runTransportMatrix(int run, String transport) {
        execute(run, transport, "baseline", Duration.ofSeconds(5), client -> {
            int toolCount = client.listTools().tools().size();
            call(client, "ping", Map.of());
            return "Initialized, listed " + toolCount + " tools, and completed ping.";
        });

        execute(run, transport, "bounded-delay", Duration.ofSeconds(5), client -> {
            call(client, "delay", Map.of("delayMs", 250));
            return "A 250 ms delay completed successfully.";
        });

        execute(run, transport, "timeout-recovery", Duration.ofSeconds(1), client -> {
            boolean timedOut = fails(() -> call(client, "delay", Map.of("delayMs", 2_000)));
            call(client, "ping", Map.of());
            if (!timedOut) throw new AssertionError("The delayed call did not time out");
            return "The delayed call timed out and the same client completed ping.";
        });

        execute(run, transport, "duplicate-response-recovery", Duration.ofSeconds(5), client -> {
            call(client, "duplicate_response", Map.of());
            Thread.sleep(100);
            call(client, "ping", Map.of());
            return "The first duplicate response result was accepted and the same client completed ping.";
        });

        for (String variant : List.of("missing-jsonrpc", "invalid-jsonrpc-version", "result-with-error")) {
            execute(run, transport, variant + "-recovery", Duration.ofSeconds(2), client -> {
                boolean rejected = fails(() -> call(client, "malformed_message", Map.of("variant", variant)));
                boolean recovered = !fails(() -> call(client, "ping", Map.of()));
                if (!rejected) throw new AssertionError("Malformed response was accepted");
                if (!recovered) throw new AssertionError("Same-client ping failed after malformed response");
                return "The malformed response was rejected and the same client completed ping.";
            });
        }

        execute(run, transport, "disconnect-reconnect", Duration.ofSeconds(2), client -> {
            boolean disconnected = fails(() -> call(client, "disconnect", Map.of()));
            if (!disconnected) throw new AssertionError("Disconnect call unexpectedly returned a result");
            boolean sameClientRecovered = !fails(() -> call(client, "ping", Map.of()));
            McpSyncClient freshClient = newClient(transport, Duration.ofSeconds(5));
            boolean freshClientRecovered;
            try {
                freshClient.initialize();
                freshClientRecovered = !fails(() -> call(freshClient, "ping", Map.of()));
            } finally {
                try {
                    freshClient.closeGracefully();
                } catch (Throwable ignored) {
                    // The result records whether the fresh call itself recovered.
                }
            }
            if (!freshClientRecovered) throw new AssertionError("A fresh client did not reconnect");
            if (transport.equals("streamable-http") && !sameClientRecovered) {
                throw new AssertionError("The same HTTP client did not recover");
            }
            return "The forced disconnect was observed; same-client recovery was "
                    + (sameClientRecovered ? "successful" : "unavailable")
                    + " and a fresh client completed ping.";
        });

        if (transport.equals("stdio")) {
            execute(run, transport, "response-after-cancellation-recovery", Duration.ofSeconds(1), client -> {
                boolean cancelled = fails(() -> call(client, "response_after_cancellation", Map.of()));
                Thread.sleep(1_200);
                call(client, "ping", Map.of());
                if (!cancelled) throw new AssertionError("The request was not cancelled");
                return "The request was cancelled, the late response settled, and the same client completed ping.";
            });
        }
    }

    private static void execute(int run, String transport, String scenario,
                                Duration timeout, Check check) {
        long started = System.nanoTime();
        McpSyncClient client = null;
        boolean passed = false;
        String observation;
        try {
            client = newClient(transport, timeout);
            String protocol = client.initialize().protocolVersion();
            observation = check.run(client) + " Negotiated protocol " + protocol + ".";
            passed = true;
        } catch (Throwable error) {
            observation = error.getClass().getSimpleName() + ": " + rootMessage(error);
        } finally {
            if (client != null) {
                try {
                    client.closeGracefully();
                } catch (Throwable ignored) {
                    // Cleanup behavior is captured indirectly by the bounded container run.
                }
            }
        }
        long durationMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
        RESULTS.add(new Result(run, transport, scenario, passed, durationMs, observation));
        System.out.printf("%s run %d %-38s %s (%d ms): %s%n",
                transport, run, scenario, passed ? "PASS" : "FAIL", durationMs, observation);
    }

    private static McpSyncClient newClient(String transport, Duration timeout) {
        McpClientTransport clientTransport;
        if (transport.equals("stdio")) {
            ServerParameters parameters = ServerParameters.builder("npx")
                    .args("-y", "mcp-failure-lab@" + FAILURE_LAB_VERSION, "serve")
                    .build();
            clientTransport = new StdioClientTransport(parameters, McpJsonDefaults.getMapper());
        } else {
            clientTransport = HttpClientStreamableHttpTransport
                    .builder("http://127.0.0.1:" + HTTP_PORT)
                    .endpoint("/mcp")
                    .build();
        }
        return McpClient.sync(clientTransport)
                .initializationTimeout(Duration.ofSeconds(10))
                .requestTimeout(timeout)
                .build();
    }

    private static void call(McpSyncClient client, String tool, Map<String, Object> arguments) {
        client.callTool(McpSchema.CallToolRequest.builder(tool).arguments(arguments).build());
    }

    @FunctionalInterface
    private interface ThrowingAction { void run() throws Exception; }

    private static boolean fails(ThrowingAction action) {
        try {
            action.run();
            return false;
        } catch (Throwable ignored) {
            return true;
        }
    }

    private static Process startHttpServer() throws IOException {
        return new ProcessBuilder("npx", "-y", "mcp-failure-lab@" + FAILURE_LAB_VERSION,
                "serve", "--transport", "http", "--host", "127.0.0.1",
                "--port", Integer.toString(HTTP_PORT), "--path", "/mcp")
                .inheritIO()
                .start();
    }

    private static void prewarmPublishedPackage() throws Exception {
        Process process = new ProcessBuilder("npx", "-y", "mcp-failure-lab@" + FAILURE_LAB_VERSION, "--version")
                .inheritIO()
                .start();
        if (!process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS) || process.exitValue() != 0) {
            throw new IllegalStateException("Could not prewarm the published Failure Lab package");
        }
    }

    private static void waitForHttpServer() throws Exception {
        URI uri = URI.create("http://127.0.0.1:" + HTTP_PORT + "/mcp");
        for (int attempt = 0; attempt < 100; attempt++) {
            try {
                HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
                connection.setConnectTimeout(100);
                connection.setReadTimeout(100);
                connection.getResponseCode();
                return;
            } catch (IOException ignored) {
                Thread.sleep(100);
            }
        }
        throw new IllegalStateException("HTTP Failure Lab server did not become ready");
    }

    private static String rootMessage(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) current = current.getCause();
        String message = current.getMessage();
        return message == null ? current.toString() : message;
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String toJson() {
        StringBuilder json = new StringBuilder();
        json.append("{\n  \"generatedAt\": \"").append(Instant.now()).append("\",\n")
                .append("  \"failureLabVersion\": \"").append(FAILURE_LAB_VERSION).append("\",\n")
                .append("  \"javaSdkVersion\": \"").append(JAVA_SDK_VERSION).append("\",\n")
                .append("  \"runs\": [\n");
        for (int index = 0; index < RESULTS.size(); index++) {
            Result result = RESULTS.get(index);
            json.append("    {\"run\": ").append(result.run())
                    .append(", \"transport\": \"").append(result.transport())
                    .append("\", \"scenario\": \"").append(result.scenario())
                    .append("\", \"passed\": ").append(result.passed())
                    .append(", \"durationMs\": ").append(result.durationMs())
                    .append(", \"observation\": \"").append(escape(result.observation())).append("\"}");
            if (index + 1 < RESULTS.size()) json.append(',');
            json.append('\n');
        }
        return json.append("  ]\n}\n").toString();
    }
}
