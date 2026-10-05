# frozen_string_literal: true

require "json"
require "mcp"
require "net/http"
require "timeout"
require "fileutils"
require "time"

FAILURE_LAB_VERSION = "0.12.0"
RUBY_SDK_VERSION = "1.6.1"
HTTP_PORT = 43_123
RESULTS = []

def client_for(transport, timeout_seconds)
  adapter = if transport == "stdio"
    MCP::Client::Stdio.new(
      command: "npx",
      args: ["-y", "mcp-failure-lab@#{FAILURE_LAB_VERSION}", "serve"],
      read_timeout: timeout_seconds,
    )
  else
    MCP::Client::HTTP.new(url: "http://127.0.0.1:#{HTTP_PORT}/mcp") do |connection|
      connection.options.timeout = timeout_seconds
      connection.options.open_timeout = timeout_seconds
    end
  end
  [MCP::Client.new(transport: adapter), adapter]
end

def call(client, name, arguments = {})
  client.call_tool(name: name, arguments: arguments)
end

def cancel_call(client, name)
  cancellation = MCP::Cancellation.new
  canceller = Thread.new do
    sleep 0.25
    cancellation.cancel(reason: "compatibility recovery check")
  end
  begin
    client.call_tool(name: name, arguments: {}, cancellation: cancellation)
    raise "Cancelled call unexpectedly returned"
  rescue MCP::CancelledError
    # Cancellation must surface as the SDK's cancellation error.
  ensure
    canceller.join
  end
end

def execute(run, transport, scenario, timeout_seconds: 5)
  started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  client = nil
  adapter = nil
  passed = false
  observation = nil
  begin
    client, adapter = client_for(transport, timeout_seconds)
    client.connect(
      client_info: { name: "mcp-failure-lab-ruby", version: "1.0.0" },
      protocol_version: "2025-11-25",
      mode: :legacy,
    )
    protocol_version = client.protocol_version
    observation = yield(client)
    observation = "#{observation} Negotiated protocol #{protocol_version}."
    passed = true
  rescue StandardError => error
    observation = "#{error.class}: #{error.message}"
  ensure
    begin
      adapter&.close
    rescue StandardError
      # The scenario result already captures connection behavior.
    end
  end
  duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
  RESULTS << { run:, transport:, scenario:, passed:, durationMs: duration_ms, observation: }
  puts format("%s run %d %-38s %s (%d ms): %s", transport, run, scenario,
    passed ? "PASS" : "FAIL", duration_ms, observation)
end

def run_matrix(run, transport)
  execute(run, transport, "baseline") do |client|
    tool_count = client.tools.length
    call(client, "ping")
    "Initialized, listed #{tool_count} tools, and completed ping."
  end

  execute(run, transport, "bounded-delay") do |client|
    call(client, "delay", { delayMs: 250 })
    call(client, "ping")
    "A 250 ms delay and same-client ping completed."
  end

  execute(run, transport, "duplicate-response-recovery") do |client|
    call(client, "duplicate_response")
    sleep 0.1
    call(client, "ping")
    "The primary response was accepted and the same client completed ping."
  end

  execute(run, transport, "hang-cancellation-recovery") do |client|
    cancel_call(client, "hang")
    call(client, "ping")
    "The hanging call was cancelled and the same client completed ping."
  end

  if transport == "stdio"
    execute(run, transport, "response-after-cancellation-recovery") do |client|
      cancel_call(client, "response_after_cancellation")
      sleep 1
      call(client, "ping")
      "Cancellation raised CancelledError; after the late response, the same client completed ping."
    end
  end

  execute(run, transport, "protocol-ping-liveness") do |client|
    response = call(client, "protocol_ping_liveness", {
      pingAfterMs: 100, livenessTimeoutMs: 1000, completionDelayMs: 100,
      closeOnFailure: false,
    })
    diagnostic = JSON.parse(response.dig("result", "content", 0, "text"))
    outcome = diagnostic.dig("protocolPing", "outcome")
    raise "Protocol ping outcome: #{outcome}" unless outcome == "success"

    call(client, "ping")
    "The server's protocol ping succeeded and the same client completed tool ping."
  end

  if transport == "streamable-http"
    execute(run, transport, "session-loss-after-response") do |client|
      call(client, "session_loss", { activation: "after_response" })
      rejected = false
      begin
        call(client, "ping")
      rescue StandardError
        rejected = true
      end
      raise "Lost session unexpectedly accepted ping" unless rejected

      fresh_client, fresh_adapter = client_for(transport, 5)
      begin
        fresh_client.connect(
          client_info: { name: "mcp-failure-lab-ruby", version: "1.0.0" },
          protocol_version: "2025-11-25", mode: :legacy,
        )
        call(fresh_client, "ping")
      ensure
        fresh_adapter.close
      end
      "The lost session rejected ping and a fresh client completed ping."
    end
  end

  %w[missing-jsonrpc invalid-jsonrpc-version result-with-error].each do |variant|
    execute(run, transport, "#{variant}-recovery", timeout_seconds: 2) do |client|
      rejected = false
      begin
        call(client, "malformed_message", { variant: })
      rescue StandardError
        rejected = true
      end
      raise "Malformed response was accepted" unless rejected

      call(client, "ping")
      "The malformed response was rejected and the same client completed ping."
    end
  end

  execute(run, transport, "disconnect-reconnect", timeout_seconds: 2) do |client|
    disconnected = false
    begin
      call(client, "disconnect")
    rescue StandardError
      disconnected = true
    end
    raise "Disconnect call unexpectedly returned" unless disconnected

    fresh_client, fresh_adapter = client_for(transport, 5)
    begin
      fresh_client.connect(
        client_info: { name: "mcp-failure-lab-ruby", version: "1.0.0" },
        protocol_version: "2025-11-25",
        mode: :legacy,
      )
      call(fresh_client, "ping")
    ensure
      fresh_adapter.close
    end
    "The forced disconnect was observed and a fresh client completed ping."
  end
end

puts "Ruby #{RUBY_VERSION}; MCP Ruby SDK #{RUBY_SDK_VERSION}; mcp-failure-lab@#{FAILURE_LAB_VERSION}"
system("npx", "-y", "mcp-failure-lab@#{FAILURE_LAB_VERSION}", "--version", exception: true)

3.times { |index| run_matrix(index + 1, "stdio") }

http_pid = Process.spawn(
  "npx", "-y", "mcp-failure-lab@#{FAILURE_LAB_VERSION}", "serve",
  "--transport", "http", "--host", "127.0.0.1", "--port", HTTP_PORT.to_s,
  "--path", "/mcp",
)
begin
  Timeout.timeout(15) do
    loop do
      begin
        Net::HTTP.get_response(URI("http://127.0.0.1:#{HTTP_PORT}/mcp"))
        break
      rescue Errno::ECONNREFUSED
        sleep 0.1
      end
    end
  end
  3.times { |index| run_matrix(index + 1, "streamable-http") }
ensure
  Process.kill("TERM", http_pid)
  Process.wait(http_pid)
end

output = "/results/ruby-sdk-#{RUBY_SDK_VERSION}-results.json"
FileUtils.mkdir_p(File.dirname(output))
File.write(output, JSON.pretty_generate({
  generatedAt: Time.now.utc.iso8601,
  failureLabVersion: FAILURE_LAB_VERSION,
  rubySdkVersion: RUBY_SDK_VERSION,
  runs: RESULTS,
}) + "\n")
failures = RESULTS.count { |result| !result[:passed] }
puts "Wrote #{RESULTS.length} results (#{failures} failed) to #{output}"
