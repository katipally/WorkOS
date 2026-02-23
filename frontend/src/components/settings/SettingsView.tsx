import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, Github, Hash, ExternalLink,
  CheckCircle2, XCircle, Loader2, RefreshCw, Brain, Cpu,
  Eye, EyeOff, Zap, TestTube,
} from "lucide-react";
import { oauthApi, settingsApi, type OAuthProvider, type OAuthProviderStatus } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AISettings, ModelInfo } from "@/types";

interface Integration {
  provider: OAuthProvider;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const INTEGRATIONS: Integration[] = [
  {
    provider: "github",
    label: "GitHub",
    description: "Access repositories, issues, pull requests, commits, and CI/CD workflows.",
    icon: Github,
    color: "text-[#24292f] dark:text-white",
  },
  {
    provider: "slack",
    label: "Slack",
    description: "Browse channels, read messages, post updates, and manage reactions.",
    icon: Hash,
    color: "text-[#4A154B] dark:text-[#E01E5A]",
  },
];

export default function SettingsView() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<OAuthProvider | null>(null);
  const [disconnecting, setDisconnecting] = useState<OAuthProvider | null>(null);
  const [settingsSection, setSettingsSection] = useState<"integrations" | "ai">("integrations");

  const { data: statuses, isLoading, refetch } = useQuery({
    queryKey: ["oauth-status"],
    queryFn: oauthApi.status,
    refetchInterval: connecting ? 2000 : false, // poll while waiting for popup
  });

  // Listen for popup postMessage callback
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.data?.type === "oauth_callback") {
        const { provider, status } = e.data as { provider: OAuthProvider; status: string };
        setConnecting(null);
        if (status === "connected") {
          toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connected!`);
        } else {
          toast.error(`Connection failed: ${status}`);
        }
        refetch();
        // Invalidate integration-specific queries so views refresh
        if (provider === "github") qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("gh-") });
        if (provider === "slack") qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("slack-") });
      }
    },
    [refetch, qc],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const handleConnect = async (provider: OAuthProvider) => {
    try {
      setConnecting(provider);
      const { url } = await oauthApi.authorize(provider);
      const w = 600, h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(url, `oauth_${provider}`, `width=${w},height=${h},left=${left},top=${top}`);
      // If popup blocked, fall back to redirect
      if (!popup) {
        window.location.href = url;
      }
    } catch {
      setConnecting(null);
      toast.error("Failed to start authorization flow");
    }
  };

  const handleDisconnect = async (provider: OAuthProvider) => {
    try {
      setDisconnecting(provider);
      await oauthApi.disconnect(provider);
      toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected`);
      refetch();
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-64 shrink-0 flex flex-col bg-sidebar border-r overflow-hidden">
        <div className="px-3 py-2.5 border-b flex items-center gap-2 shrink-0">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Settings</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1">General</p>
          <button
            className={cn(
              "w-full text-left px-3 py-1.5 rounded-md text-xs font-medium",
              settingsSection === "integrations" ? "bg-accent" : "hover:bg-accent/50"
            )}
            onClick={() => setSettingsSection("integrations")}
          >
            Integrations
          </button>
          <button
            className={cn(
              "w-full text-left px-3 py-1.5 rounded-md text-xs font-medium",
              settingsSection === "ai" ? "bg-accent" : "hover:bg-accent/50"
            )}
            onClick={() => setSettingsSection("ai")}
          >
            AI Configuration
          </button>
        </nav>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {settingsSection === "integrations" ? (
          <IntegrationsSection
            statuses={statuses}
            isLoading={isLoading}
            refetch={refetch}
            connecting={connecting}
            disconnecting={disconnecting}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        ) : (
          <AIConfigSection />
        )}
      </div>
    </div>
  );
}

// ─── AI Configuration Section ─────────────────────────────────────────────

function AIConfigSection() {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  // Track whether the user has typed a new API key (vs. the masked placeholder returned by the server)
  const [apiKeyDirty, setApiKeyDirty] = useState(false);

  const { data: aiSettings, isLoading } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: settingsApi.getAI,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<AISettings>) => settingsApi.updateAI(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      qc.invalidateQueries({ queryKey: ["ai-models", "openai"] });
      qc.invalidateQueries({ queryKey: ["ai-models", "ollama"] });
      setApiKeyDirty(false);
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
  });

  const testMutation = useMutation({
    mutationFn: (provider: string) => settingsApi.testConnection(provider),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(result.message);
        // Re-fetch models after successful test
        qc.invalidateQueries({ queryKey: ["ai-models", "openai"] });
        qc.invalidateQueries({ queryKey: ["ai-models", "ollama"] });
      } else {
        toast.error(result.message);
      }
    },
  });

  // OpenAI models: only fetch when server has a saved API key (masked key is non-empty)
  const openaiKeyConfigured = !!(aiSettings?.openai_api_key);
  const { data: openaiModels = [], refetch: refetchOpenAI, isFetching: fetchingOpenAI } = useQuery({
    queryKey: ["ai-models", "openai"],
    queryFn: () => settingsApi.listModels("openai", "chat"),
    enabled: openaiKeyConfigured,
    staleTime: 5 * 60_000,
  });

  // OpenAI embedding models (separate list)
  const { data: openaiEmbeddingModels = [] } = useQuery({
    queryKey: ["ai-models", "openai", "embedding"],
    queryFn: () => settingsApi.listModels("openai", "embedding"),
    enabled: openaiKeyConfigured,
    staleTime: 5 * 60_000,
  });

  // Ollama models: only fetch when URL is configured
  const ollamaUrlConfigured = !!(aiSettings?.ollama_base_url);
  const { data: ollamaModels = [], refetch: refetchOllama, isFetching: fetchingOllama } = useQuery({
    queryKey: ["ai-models", "ollama"],
    queryFn: () => settingsApi.listModels("ollama", "chat"),
    enabled: ollamaUrlConfigured,
    staleTime: 60_000,
  });

  const [localSettings, setLocalSettings] = useState<Partial<AISettings>>({});

  useEffect(() => {
    if (aiSettings) {
      setLocalSettings(aiSettings);
    }
  }, [aiSettings]);

  const handleSave = () => {
    const payload = { ...localSettings };
    // If the user hasn't typed a new key, strip it from the payload so we don't
    // overwrite the real key with the masked placeholder "sk-...xxxx"
    if (!apiKeyDirty) {
      delete payload.openai_api_key;
    }
    updateMutation.mutate(payload);
  };

  const updateField = (key: keyof AISettings, value: string) => {
    if (key === "openai_api_key") setApiKeyDirty(true);
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const getModelsForProvider = (provider: string, isEmbedding: boolean = false): ModelInfo[] => {
    if (isEmbedding && provider === "openai") return openaiEmbeddingModels;
    return provider === "openai" ? openaiModels : ollamaModels;
  };

  const isProviderReady = (provider: string): boolean => {
    if (provider === "openai") return openaiKeyConfigured;
    if (provider === "ollama") return ollamaUrlConfigured;
    return false;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="px-6 py-3 border-b flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold">AI Configuration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Configure LLM providers and models for AI features.</p>
        </div>
        <Button size="sm" className="text-xs h-8 gap-1.5" onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          Save Changes
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 space-y-6 max-w-2xl">
          {/* Provider Credentials */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Cpu className="w-4 h-4 text-indigo-400" /> Provider Credentials
            </h3>

            <div className="space-y-5">
              {/* OpenAI */}
              <div>
                <Label className="text-xs font-medium">OpenAI API Key</Label>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Required for OpenAI models. Models load automatically after key is saved.
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={localSettings.openai_api_key || ""}
                      onChange={(e) => updateField("openai_api_key", e.target.value)}
                      placeholder="sk-proj-..."
                      className="bg-zinc-900 border-zinc-700 pr-10 text-sm"
                    />
                    <Button
                      variant="ghost" size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                  </div>
                  <Button
                    size="sm" variant="outline" className="text-xs gap-1"
                    onClick={() => testMutation.mutate("openai")}
                    disabled={testMutation.isPending || !openaiKeyConfigured}
                  >
                    {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
                    Test
                  </Button>
                  <Button
                    size="sm" variant="outline" className="text-xs gap-1"
                    onClick={() => refetchOpenAI()}
                    disabled={!openaiKeyConfigured || fetchingOpenAI}
                  >
                    {fetchingOpenAI ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Models
                  </Button>
                </div>
                {openaiKeyConfigured && openaiModels.length > 0 && (
                  <p className="text-[10px] text-emerald-500 mt-1">{openaiModels.length} models available</p>
                )}
                {!openaiKeyConfigured && (
                  <p className="text-[10px] text-muted-foreground mt-1">Enter and save your API key to unlock model selection.</p>
                )}
              </div>

              {/* Ollama */}
              <div>
                <Label className="text-xs font-medium">Ollama Endpoint</Label>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Local Ollama instance. Default: <code className="bg-muted px-1 rounded text-[10px]">http://localhost:11434</code>
                </p>
                <div className="flex gap-2">
                  <Input
                    value={localSettings.ollama_base_url || ""}
                    onChange={(e) => updateField("ollama_base_url", e.target.value)}
                    placeholder="http://localhost:11434"
                    className="bg-zinc-900 border-zinc-700 text-sm flex-1"
                  />
                  <Button
                    size="sm" variant="outline" className="text-xs gap-1"
                    onClick={() => testMutation.mutate("ollama")}
                    disabled={testMutation.isPending || !ollamaUrlConfigured}
                  >
                    {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
                    Test
                  </Button>
                  <Button
                    size="sm" variant="outline" className="text-xs gap-1"
                    onClick={() => refetchOllama()}
                    disabled={!ollamaUrlConfigured || fetchingOllama}
                  >
                    {fetchingOllama ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Models
                  </Button>
                </div>
                {ollamaUrlConfigured && ollamaModels.length > 0 && (
                  <p className="text-[10px] text-emerald-500 mt-1">{ollamaModels.length} local model{ollamaModels.length !== 1 ? "s" : ""} found</p>
                )}
                {!ollamaUrlConfigured && (
                  <p className="text-[10px] text-muted-foreground mt-1">Set the URL and save, then click Models to list installed models.</p>
                )}
              </div>
            </div>
          </Card>

          {/* AI Chat Model */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-purple-400" /> AI Chat Model
            </h3>
            <ModelSelector
              providerKey="ai_provider"
              modelKey="ai_model"
              localSettings={localSettings}
              updateField={updateField}
              getModels={getModelsForProvider}
              isProviderReady={isProviderReady}
            />
          </Card>

          {/* Embedding Model */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Cpu className="w-4 h-4 text-blue-400" /> Embedding Model (RAG)
            </h3>
            <ModelSelector
              providerKey="embedding_provider"
              modelKey="embedding_model"
              localSettings={localSettings}
              updateField={updateField}
              getModels={getModelsForProvider}
              isProviderReady={isProviderReady}
              isEmbedding
            />
          </Card>

          {/* Meeting Summary Model */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-emerald-400" /> Meeting Summary Model
            </h3>
            <ModelSelector
              providerKey="meeting_summary_provider"
              modelKey="meeting_summary_model"
              localSettings={localSettings}
              updateField={updateField}
              getModels={getModelsForProvider}
              isProviderReady={isProviderReady}
            />
          </Card>

          {/* Meeting Actions Model */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-amber-400" /> Meeting Action Items Model
            </h3>
            <ModelSelector
              providerKey="meeting_actions_provider"
              modelKey="meeting_actions_model"
              localSettings={localSettings}
              updateField={updateField}
              getModels={getModelsForProvider}
              isProviderReady={isProviderReady}
            />
          </Card>

          {/* Vision Model */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Eye className="w-4 h-4 text-cyan-400" /> Vision Model (Image Analysis)
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              Used to analyze uploaded images. Requires a vision-capable model (e.g. GPT-4o, LLaVA).
            </p>
            <ModelSelector
              providerKey="vision_provider"
              modelKey="vision_model"
              localSettings={localSettings}
              updateField={updateField}
              getModels={getModelsForProvider}
              isProviderReady={isProviderReady}
            />
          </Card>
        </div>
      </ScrollArea>
    </>
  );
}

function ModelSelector({
  providerKey,
  modelKey,
  localSettings,
  updateField,
  getModels,
  isProviderReady,
  isEmbedding = false,
}: {
  providerKey: keyof AISettings;
  modelKey: keyof AISettings;
  localSettings: Partial<AISettings>;
  updateField: (key: keyof AISettings, value: string) => void;
  getModels: (provider: string, isEmbedding?: boolean) => ModelInfo[];
  isProviderReady: (provider: string) => boolean;
  isEmbedding?: boolean;
}) {
  const provider = (localSettings[providerKey] as string) || "openai";
  const model = (localSettings[modelKey] as string) || "";
  const models = getModels(provider, isEmbedding);
  const ready = isProviderReady(provider);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Provider</Label>
          <Select value={provider} onValueChange={(v) => updateField(providerKey, v)}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-sm mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="ollama">Ollama</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Model</Label>
          {ready && models.length > 0 ? (
            <Select value={model} onValueChange={(v) => updateField(modelKey, v)}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700 text-sm mt-1">
                <SelectValue placeholder="Select model..." />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={ready ? model : ""}
              onChange={(e) => updateField(modelKey, e.target.value)}
              placeholder={ready ? (provider === "openai" ? "e.g. gpt-4o" : "e.g. llama3.2") : `Configure ${provider === "openai" ? "OpenAI key" : "Ollama URL"} first`}
              disabled={!ready}
              className="bg-zinc-900 border-zinc-700 text-sm mt-1 disabled:opacity-50"
            />
          )}
        </div>
      </div>
      {ready && models.length === 0 && (
        <p className="text-[10px] text-muted-foreground">
          No models loaded yet — click the <strong>Models</strong> button in Provider Credentials to fetch the list.
        </p>
      )}
    </div>
  );
}

// ─── Integrations Section (extracted) ─────────────────────────────────────

function IntegrationsSection({
  statuses,
  isLoading,
  refetch,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
}: {
  statuses?: Record<OAuthProvider, OAuthProviderStatus>;
  isLoading: boolean;
  refetch: () => void;
  connecting: OAuthProvider | null;
  disconnecting: OAuthProvider | null;
  onConnect: (provider: OAuthProvider) => void;
  onDisconnect: (provider: OAuthProvider) => void;
}) {
  return (
    <>
      <div className="px-6 py-3 border-b flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold">Integrations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Connect your accounts to enable workspace features.</p>
        </div>
        <Button size="sm" variant="ghost" className="text-xs gap-1.5 h-7" onClick={() => refetch()}>
          <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} /> Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 space-y-4 max-w-2xl">
          {INTEGRATIONS.map((integration) => {
            const status: OAuthProviderStatus | undefined = statuses?.[integration.provider];
            const connected = status?.connected ?? false;
            const isConnecting = connecting === integration.provider;
            const isDisconnecting = disconnecting === integration.provider;
            const Icon = integration.icon;

            return (
              <Card key={integration.provider} className="p-0 overflow-hidden">
                <div className="flex items-start gap-4 p-4">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    connected ? "bg-green-50 dark:bg-green-950/30" : "bg-muted"
                  )}>
                    <Icon className={cn("w-5 h-5", connected ? integration.color : "text-muted-foreground")} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{integration.label}</h3>
                      {connected ? (
                        <Badge variant="secondary" className="text-[10px] gap-1 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0">
                          <CheckCircle2 className="w-3 h-3" /> Connected
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] gap-1 border-0">
                          <XCircle className="w-3 h-3" /> Not connected
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{integration.description}</p>

                    {connected && status && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        {status.meta?.login && <span>User: <code className="font-mono bg-muted px-1 rounded">{status.meta.login}</code></span>}
                        {status.meta?.name && <span>Name: {status.meta.name}</span>}
                        {status.meta?.team_name && <span>Team: {status.meta.team_name}</span>}
                        {status.meta?.cloud_name && <span>Site: {status.meta.cloud_name}</span>}
                        {status.scope && <span>Scopes: <code className="font-mono bg-muted px-1 rounded text-[10px]">{status.scope}</code></span>}
                        {status.updated_at && <span>Connected: {new Date(status.updated_at).toLocaleDateString()}</span>}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    {connected ? (
                      <Button
                        size="sm" variant="outline"
                        className="text-xs h-8 text-destructive hover:text-destructive"
                        disabled={isDisconnecting}
                        onClick={() => onDisconnect(integration.provider)}
                      >
                        {isDisconnecting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="text-xs h-8 gap-1.5"
                        disabled={isConnecting}
                        onClick={() => onConnect(integration.provider)}
                      >
                        {isConnecting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3 h-3" />
                        )}
                        Connect
                      </Button>
                    )}
                  </div>
                </div>

                {!connected && (
                  <>
                    <Separator />
                    <div className="px-4 py-2.5 bg-muted/30">
                      <p className="text-[11px] text-muted-foreground">
                        Click <strong>Connect</strong> to authorize via OAuth 2.0. A popup will open for you to sign in and grant access.
                      </p>
                    </div>
                  </>
                )}
              </Card>
            );
          })}

          <Card className="p-4 bg-muted/20 border-dashed">
            <div className="flex items-start gap-3">
              <Settings className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">How integrations work</p>
                <p>Each integration uses OAuth 2.0 to securely connect your account. Tokens are stored server-side and automatically refreshed when needed.</p>
                <p>Disconnecting revokes the token and removes it from the server. You can reconnect at any time.</p>
              </div>
            </div>
          </Card>
        </div>
      </ScrollArea>
    </>
  );
}
