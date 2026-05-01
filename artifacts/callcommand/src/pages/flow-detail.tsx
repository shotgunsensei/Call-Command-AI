import { useEffect, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetFlow,
  useUpdateFlow,
  useListChannels,
} from "@workspace/api-client-react";
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, GitBranch, Save, Activity } from "lucide-react";

const NONE_VALUE = "__none__";

interface NodeDraft {
  ref: string;
  type: string;
  label: string;
  config: string; // JSON string
  nextNodeRef: string;
  nextNodeFalseRef: string;
}

function nodesToDraft(
  nodes: Array<{
    id: string;
    type: string;
    label?: string | null;
    config: Record<string, unknown>;
    nextNodeId?: string | null;
    nextNodeIdFalse?: string | null;
  }>,
): NodeDraft[] {
  // Use node id as ref so cross-references survive a save round-trip.
  return nodes.map((n) => ({
    ref: n.id,
    type: n.type,
    label: n.label ?? "",
    config: JSON.stringify(n.config ?? {}, null, 2),
    nextNodeRef: n.nextNodeId ?? "",
    nextNodeFalseRef: n.nextNodeIdFalse ?? "",
  }));
}

export default function FlowDetailPage() {
  const [, params] = useRoute("/flows/:id");
  const id = params?.id ?? "";
  const [, setLocation] = useLocation();
  const { data: flow, isLoading, refetch } = useGetFlow(id);
  const { data: channels } = useListChannels();
  const updateFlow = useUpdateFlow();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelId, setChannelId] = useState<string>(NONE_VALUE);
  const [isActive, setIsActive] = useState(true);
  const [nodes, setNodes] = useState<NodeDraft[]>([]);

  useEffect(() => {
    if (!flow) return;
    setName(flow.name);
    setDescription(flow.description ?? "");
    setChannelId(flow.channelId ?? NONE_VALUE);
    setIsActive(flow.isActive);
    setNodes(nodesToDraft(flow.nodes));
  }, [flow]);

  if (isLoading || !flow) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Activity className="h-6 w-6 animate-pulse text-primary" />
      </div>
    );
  }

  const updateNode = (idx: number, patch: Partial<NodeDraft>) => {
    setNodes((prev) =>
      prev.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
    );
  };

  const addNode = (type: string) => {
    const ref = `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const defaults: Record<string, Record<string, unknown>> = {
      condition: { field: "priority", operator: "eq", value: "high" },
      action: { actions: [{ type: "create_ticket" }] },
      ai_decision: { copyAnalysis: true },
      route: { mode: "queue", queue: "general" },
    };
    setNodes((prev) => [
      ...prev,
      {
        ref,
        type,
        label: "",
        config: JSON.stringify(defaults[type] ?? {}, null, 2),
        nextNodeRef: "",
        nextNodeFalseRef: "",
      },
    ]);
  };

  const removeNode = (idx: number) => {
    setNodes((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    // Validate JSON for each node
    const parsed: Array<{
      ref: string;
      type: string;
      label: string | null;
      config: Record<string, unknown>;
      nextNodeRef: string | null;
      nextNodeFalseRef: string | null;
    }> = [];
    for (const [idx, n] of nodes.entries()) {
      let cfg: Record<string, unknown>;
      try {
        cfg = JSON.parse(n.config || "{}");
      } catch {
        toast({
          title: "Invalid JSON",
          description: `Node ${idx + 1} has invalid JSON config.`,
          variant: "destructive",
        });
        return;
      }
      parsed.push({
        ref: n.ref,
        type: n.type,
        label: n.label.trim() || null,
        config: cfg,
        nextNodeRef: n.nextNodeRef.trim() || null,
        nextNodeFalseRef: n.nextNodeFalseRef.trim() || null,
      });
    }

    try {
      await updateFlow.mutateAsync({
        id,
        data: {
          name: name.trim() || flow.name,
          description: description.trim() || null,
          channelId: channelId === NONE_VALUE ? null : channelId,
          isActive,
          nodes: parsed,
        },
      });
      toast({ title: "Flow saved" });
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    }
  };

  const refOptions = nodes.map((n) => ({
    value: n.ref,
    label: `${n.type}${n.label ? ` · ${n.label}` : ""}`,
  }));

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-flow-detail">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/flows")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Flows
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            {flow.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            data-testid="button-simulate-flow"
          >
            <Link href="/simulate">Try in simulator</Link>
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateFlow.isPending}
            data-testid="button-save-flow"
          >
            <Save className="mr-2 h-4 w-4" />
            {updateFlow.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
          <CardDescription>
            A flow runs after the rules engine. The first node by{" "}
            <code>orderIndex</code> is the entry point.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="flow-name">Name</Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Any channel (global)</SelectItem>
                {(channels ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="flow-desc">Description</Label>
            <Textarea
              id="flow-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              id="flow-active"
            />
            <Label htmlFor="flow-active">Active</Label>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Nodes</CardTitle>
            <CardDescription>
              Use <code>ref</code> values in the next-pointer dropdowns to wire
              nodes together. The first node in the list is the entry.
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(["condition", "action", "ai_decision", "route"] as const).map(
              (t) => (
                <Button
                  key={t}
                  variant="outline"
                  size="sm"
                  onClick={() => addNode(t)}
                  data-testid={`button-add-${t}`}
                >
                  + {t}
                </Button>
              ),
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {nodes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No nodes. Add one above to begin orchestrating.
            </p>
          )}
          {nodes.map((n, idx) => (
            <Card
              key={n.ref}
              className="bg-secondary/30 border-border"
              data-testid={`node-${idx}`}
            >
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    #{idx + 1}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {n.type}
                  </Badge>
                  <code className="text-[11px] text-muted-foreground">
                    {n.ref}
                  </code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removeNode(idx)}
                >
                  Remove
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Label</Label>
                    <Input
                      value={n.label}
                      onChange={(e) =>
                        updateNode(idx, { label: e.target.value })
                      }
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Type</Label>
                    <Select
                      value={n.type}
                      onValueChange={(v) => updateNode(idx, { type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="condition">condition</SelectItem>
                        <SelectItem value="action">action</SelectItem>
                        <SelectItem value="ai_decision">ai_decision</SelectItem>
                        <SelectItem value="route">route</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Config (JSON)</Label>
                  <Textarea
                    value={n.config}
                    onChange={(e) =>
                      updateNode(idx, { config: e.target.value })
                    }
                    className="font-mono text-[11px] h-32"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">
                      Next node {n.type === "condition" && "(true branch)"}
                    </Label>
                    <Select
                      value={n.nextNodeRef || NONE_VALUE}
                      onValueChange={(v) =>
                        updateNode(idx, {
                          nextNodeRef: v === NONE_VALUE ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="(end)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>(end)</SelectItem>
                        {refOptions
                          .filter((o) => o.value !== n.ref)
                          .map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {n.type === "condition" && (
                    <div className="space-y-1">
                      <Label className="text-[11px]">
                        Next node (false branch)
                      </Label>
                      <Select
                        value={n.nextNodeFalseRef || NONE_VALUE}
                        onValueChange={(v) =>
                          updateNode(idx, {
                            nextNodeFalseRef: v === NONE_VALUE ? "" : v,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="(end)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>(end)</SelectItem>
                          {refOptions
                            .filter((o) => o.value !== n.ref)
                            .map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
