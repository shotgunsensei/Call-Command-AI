import { useState } from "react";
import { Link } from "wouter";
import {
  useListChannels,
  useSimulateCallWithFlow,
} from "@workspace/api-client-react";
import type { FlowExecutionResult } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Activity,
} from "lucide-react";

const ANY_CHANNEL = "__any__";

const SAMPLE_TRANSCRIPT = `Hi, this is Maria from Acme Corp. We need an urgent quote for 50 enterprise seats by end of week — the previous vendor had reliability issues, so this is high priority. Can someone from sales call me back today?`;

export default function SimulatePage() {
  const { data: channels } = useListChannels();
  const simulate = useSimulateCallWithFlow();
  const { toast } = useToast();

  const [channelId, setChannelId] = useState<string>(ANY_CHANNEL);
  const [customerName, setCustomerName] = useState("Maria Rodriguez");
  const [callerPhone, setCallerPhone] = useState("+15555550123");
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPT);
  const [intent, setIntent] = useState("");
  const [priority, setPriority] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [result, setResult] = useState<FlowExecutionResult | null>(null);

  const handleRun = async () => {
    try {
      const res = await simulate.mutateAsync({
        data: {
          channelId: channelId === ANY_CHANNEL ? null : channelId,
          customerName: customerName || null,
          callerPhone: callerPhone || null,
          transcript: transcript || null,
          intent: intent || null,
          priority: priority || null,
          sentiment: sentiment || null,
        },
      });
      setResult(res);
      toast({
        title: "Simulation complete",
        description: `${res.nodesExecuted} node(s), ${res.actionsExecuted} action(s).`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({
        title: "Simulation failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-simulate">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Flow Simulator
        </h1>
        <p className="text-muted-foreground">
          Drop in a transcript, pick a channel, and execute the bound flow
          end-to-end. The call is persisted with <code>isDemo=true</code>.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">Inbound call</CardTitle>
            <CardDescription>
              Required: a channel (or leave as Any to use the default). Leaving
              the transcript blank uses the demo analysis fallback.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger data-testid="select-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_CHANNEL}>
                    Any (resolve to default)
                  </SelectItem>
                  {(channels ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sim-name">Customer name</Label>
                <Input
                  id="sim-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sim-phone">Caller phone</Label>
                <Input
                  id="sim-phone"
                  value={callerPhone}
                  onChange={(e) => setCallerPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-transcript">Transcript</Label>
              <Textarea
                id="sim-transcript"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                data-testid="input-transcript"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Intent override</Label>
                <Input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="e.g. sales"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority override</Label>
                <Input
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  placeholder="low/medium/high"
                />
              </div>
              <div className="space-y-2">
                <Label>Sentiment override</Label>
                <Input
                  value={sentiment}
                  onChange={(e) => setSentiment(e.target.value)}
                  placeholder="positive/neutral/negative"
                />
              </div>
            </div>
            <Button
              onClick={handleRun}
              disabled={simulate.isPending}
              className="w-full"
              data-testid="button-run-simulation"
            >
              {simulate.isPending ? (
                <>
                  <Activity className="mr-2 h-4 w-4 animate-pulse" /> Running...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Run simulation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">Execution trace</CardTitle>
            <CardDescription>
              {result
                ? `Flow: ${result.flowName ?? "(no flow bound)"} · ${result.nodesExecuted} node(s)`
                : "Run a simulation to see node-by-node logs."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!result && (
              <p className="text-sm text-muted-foreground">No trace yet.</p>
            )}
            {result && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs pb-2">
                  <Badge variant="outline">
                    {result.actionsExecuted} action(s)
                  </Badge>
                  {result.flowId && (
                    <Badge variant="secondary">flow {result.flowId.slice(0, 8)}</Badge>
                  )}
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                  >
                    <Link href={`/calls/${result.callId}`}>
                      Open call <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                {result.log.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No nodes executed. The channel may have no flow bound, or
                    the flow has no nodes.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {result.log.map((log, i) => (
                      <li
                        key={log.id}
                        className="border border-border/60 rounded-md bg-secondary/30 p-3 text-xs space-y-1"
                        data-testid={`trace-${i}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            #{i + 1}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {log.nodeType}
                          </Badge>
                          {log.branch && (
                            <Badge className="text-[10px] bg-primary/20 text-primary border-transparent">
                              → {log.branch}
                            </Badge>
                          )}
                          {log.ok ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
                          ) : (
                            <XCircle className="h-3 w-3 text-destructive ml-auto" />
                          )}
                        </div>
                        {log.nodeLabel && (
                          <div className="text-foreground">{log.nodeLabel}</div>
                        )}
                        {log.message && (
                          <div className="text-muted-foreground">
                            {log.message}
                          </div>
                        )}
                        {log.detail && (
                          <pre className="bg-background/50 rounded p-2 overflow-auto max-h-32 text-[10px]">
                            {JSON.stringify(log.detail, null, 2)}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
