import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Scenario, ScenarioResult } from "./scenario.js";

export interface ResolvedTargetClient {
  readonly name: string;
  run(scenario: Scenario): Promise<ScenarioResult>;
}

export interface TargetClientAdapterProvider {
  readonly name: string;
  resolve(config: unknown): ResolvedTargetClient;
}

const targetFileSchema = z.object({ adapter: z.string().min(1), config: z.unknown() }).strict();

export class TargetClientAdapterRegistry {
  private readonly providers = new Map<string, TargetClientAdapterProvider>();

  constructor(providers: readonly TargetClientAdapterProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: TargetClientAdapterProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`target-client adapter is already registered: ${provider.name}`);
    }
    this.providers.set(provider.name, provider);
  }

  resolve(value: unknown): ResolvedTargetClient {
    const target = targetFileSchema.parse(value);
    const provider = this.providers.get(target.adapter);
    if (provider === undefined) throw new Error(`unknown target-client adapter: ${target.adapter}`);
    return provider.resolve(target.config);
  }
}

export async function loadTargetClient(
  path: string,
  registry: TargetClientAdapterRegistry,
): Promise<ResolvedTargetClient> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read target file ${path}: ${errorMessage(error)}`, { cause: error });
  }
  try {
    return registry.resolve(JSON.parse(source) as unknown);
  } catch (error) {
    throw new Error(`target file ${path} is invalid: ${errorMessage(error)}`, { cause: error });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
