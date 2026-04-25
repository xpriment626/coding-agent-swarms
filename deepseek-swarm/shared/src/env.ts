import { existsSync, readFileSync } from 'node:fs';

/**
 * Coral runtime injects per-session env vars (CORAL_*) and the per-agent
 * options declared in coral-agent.toml. In standalone dev mode we instead
 * read coral-agent.dev.env from the agent's cwd. process.env always wins
 * over the file so the user can override on the CLI.
 */

export interface CoralSettings {
  agentId: string;
  agentSecret: string;
  apiUrl: string;
  connectionUrl: string;
  runtimeId: string;
  sessionId: string;
  sendClaims: number;
}

export interface ResolvedAgentSettings {
  // Model
  modelApiKey: string;
  modelProvider: 'OPENROUTER';
  modelId: string;
  modelProviderUrlOverride: string | null;

  // Prompts
  systemPrompt: string;
  extraSystemPrompt: string;
  extraInitialUserPrompt: string;
  followUpUserPrompt: string;

  // Loop control
  maxIterations: number;
  maxTokens: number;
  iterationDelayMs: number;
  maxStepsPerIteration: number;

  // Research
  exaApiKey: string;

  // Daytona
  daytonaApiKey: string;
  daytonaSandboxId: string;

  // Coral (only populated when running under Coral)
  coral: CoralSettings | null;
}

interface LoadOptions {
  /** When true, look for coral-agent.dev.env alongside the agent and merge with process.env. */
  useDevEnv?: boolean;
  /** Required when running under Coral. Skip Coral checks when false. */
  requireCoral?: boolean;
  /**
   * When true (default when requireCoral is true), Exa and Daytona keys are required.
   * Standalone dev mode (runSwarmAgentDev) sets this false so the wire test can run
   * with just MODEL_API_KEY + MODEL_ID.
   */
  requireDaytonaExa?: boolean;
}

function readDevEnv(): Record<string, string> {
  const path = 'coral-agent.dev.env';
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf-8');
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

class EnvSource {
  private dev: Record<string, string>;

  constructor(useDevEnv: boolean) {
    this.dev = useDevEnv ? readDevEnv() : {};
    if (useDevEnv && Object.keys(this.dev).length > 0) {
      console.log(`Informing: Reading from coral-agent.dev.env`);
    }
  }

  get(name: string): string {
    const v = this.getOptional(name);
    if (v === undefined) {
      throw new Error(`Environment variable ${name} is required but not set`);
    }
    return v;
  }

  getOptional(name: string): string | undefined {
    const sys = process.env[name];
    const dev = this.dev[name];
    if (sys !== undefined && sys !== '') {
      if (dev !== undefined && dev !== sys) {
        console.warn(`Warning: ${name} from process.env overrides coral-agent.dev.env`);
      }
      return sys;
    }
    return dev;
  }
}

export function loadAgentSettings(opts: LoadOptions = {}): ResolvedAgentSettings {
  const env = new EnvSource(opts.useDevEnv ?? false);

  const provider = env.get('MODEL_PROVIDER').toUpperCase();
  if (provider !== 'OPENROUTER') {
    throw new Error(`Only MODEL_PROVIDER=OPENROUTER supported in this swarm; got ${provider}`);
  }

  const coral: CoralSettings | null = opts.requireCoral
    ? {
        agentId: env.get('CORAL_AGENT_ID'),
        agentSecret: env.get('CORAL_AGENT_SECRET'),
        apiUrl: env.get('CORAL_API_URL'),
        connectionUrl: env.get('CORAL_CONNECTION_URL'),
        runtimeId: env.get('CORAL_RUNTIME_ID'),
        sessionId: env.get('CORAL_SESSION_ID'),
        sendClaims: Number(env.getOptional('CORAL_SEND_CLAIMS') ?? '0'),
      }
    : null;

  const urlOverride = env.getOptional('MODEL_PROVIDER_URL_OVERRIDE');
  const requireDaytonaExa = opts.requireDaytonaExa ?? opts.requireCoral ?? false;
  const readEnvOrEmpty = (k: string) => (requireDaytonaExa ? env.get(k) : env.getOptional(k) ?? '');

  return {
    modelApiKey: env.get('MODEL_API_KEY'),
    modelProvider: 'OPENROUTER',
    modelId: env.getOptional('MODEL_ID') ?? 'deepseek/deepseek-v4-flash',
    modelProviderUrlOverride: urlOverride && urlOverride !== '' ? urlOverride : null,

    systemPrompt: env.getOptional('SYSTEM_PROMPT') ?? '',
    extraSystemPrompt: env.getOptional('EXTRA_SYSTEM_PROMPT') ?? '',
    extraInitialUserPrompt: env.getOptional('EXTRA_INITIAL_USER_PROMPT') ?? '',
    followUpUserPrompt: env.getOptional('FOLLOWUP_USER_PROMPT') ?? '',

    maxIterations: Number(env.getOptional('MAX_ITERATIONS') ?? '20'),
    maxTokens: Number(env.getOptional('MAX_TOKENS') ?? '20000'),
    iterationDelayMs: Number(env.getOptional('ITERATION_DELAY_MS') ?? '0'),
    maxStepsPerIteration: Number(env.getOptional('MAX_STEPS_PER_ITERATION') ?? '12'),

    exaApiKey: readEnvOrEmpty('EXA_API_KEY'),
    daytonaApiKey: readEnvOrEmpty('DAYTONA_API_KEY'),
    daytonaSandboxId: readEnvOrEmpty('DAYTONA_SANDBOX_ID'),

    coral,
  };
}
