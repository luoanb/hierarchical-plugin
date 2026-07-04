import type { AgentHarnessAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";

type ResolvedProviderAuth = {
  apiKey?: string;
};

export type HierarchicalAuthResolver = (params: {
  provider: string;
  cfg?: AgentHarnessAttemptParams["config"];
  profileId?: string;
  agentDir?: string;
  workspaceDir?: string;
  modelApi?: string;
}) => Promise<ResolvedProviderAuth>;

type AuthStorageLike = AgentHarnessAttemptParams["authStorage"] & {
  getApiKey?: (provider: string, options?: unknown) => Promise<string | undefined>;
  setRuntimeApiKey?: (provider: string, apiKey: string) => void;
};

async function defaultResolveApiKeyForProvider(
  params: Parameters<HierarchicalAuthResolver>[0],
): Promise<ResolvedProviderAuth> {
  const mod = (await import("openclaw/plugin-sdk/provider-auth-runtime")) as {
    resolveApiKeyForProvider?: HierarchicalAuthResolver;
  };
  if (!mod.resolveApiKeyForProvider) {
    return {};
  }
  return mod.resolveApiKeyForProvider(params);
}

export function createDelegateAuthStorageBridge(
  params: AgentHarnessAttemptParams,
  deps: { resolveApiKeyForProvider?: HierarchicalAuthResolver } = {},
): AgentHarnessAttemptParams["authStorage"] {
  const authStorage = params.authStorage as AuthStorageLike;
  if (
    !authStorage ||
    typeof authStorage.getApiKey !== "function" ||
    typeof authStorage.setRuntimeApiKey !== "function"
  ) {
    return params.authStorage;
  }

  const originalGetApiKey = authStorage.getApiKey.bind(authStorage);
  const setRuntimeApiKey = authStorage.setRuntimeApiKey.bind(authStorage);
  const resolveApiKeyForProvider = deps.resolveApiKeyForProvider ?? defaultResolveApiKeyForProvider;
  const fallbackCache = new Map<string, Promise<string | undefined>>();

  const resolveFallbackApiKey = (provider: string): Promise<string | undefined> => {
    const normalizedProvider = provider.trim();
    if (!normalizedProvider) {
      return Promise.resolve(undefined);
    }
    const cached = fallbackCache.get(normalizedProvider);
    if (cached) {
      return cached;
    }
    const pending = (async () => {
      const resolved = await resolveApiKeyForProvider({
        provider: normalizedProvider,
        cfg: params.config,
        profileId: params.authProfileId,
        agentDir: params.agentDir,
        workspaceDir: params.workspaceDir,
        modelApi: params.model.api,
      });
      const apiKey = resolved.apiKey?.trim();
      if (!apiKey) {
        return undefined;
      }
      setRuntimeApiKey(normalizedProvider, apiKey);
      return apiKey;
    })();
    fallbackCache.set(normalizedProvider, pending);
    return pending;
  };

  return new Proxy(authStorage, {
    get(target, prop, receiver) {
      if (prop === "getApiKey") {
        return async (provider: string, options?: unknown) => {
          const existing = await originalGetApiKey(provider, options);
          if (existing?.trim()) {
            return existing;
          }
          return resolveFallbackApiKey(provider);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as AgentHarnessAttemptParams["authStorage"];
}
