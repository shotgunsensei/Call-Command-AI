import { useState } from "react";
import { Link } from "wouter";
import {
  useListFlows,
  useListChannels,
  useCreateFlow,
  useUpdateFlow,
  useDeleteFlow,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  Plus,
  Trash2,
  GitBranch,
  ArrowRight,
} from "lucide-react";

const NONE_VALUE = "__none__";

export default function FlowsPage() {
  const { data: flows, isLoading, refetch } = useListFlows();
  const { data: channels } = useListChannels();
  const createFlow = useCreateFlow();
  const updateFlow = useUpdateFlow();
  const deleteFlow = useDeleteFlow();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelId, setChannelId] = useState<string>(NONE_VALUE);

  const reset = () => {
    setName("");
    setDescription("");
    setChannelId(NONE_VALUE);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await createFlow.mutateAsync({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          channelId: channelId === NONE_VALUE ? null : channelId,
          isActive: true,
          nodes: [
            {
              ref: "entry",
              type: "ai_decision",
              label: "Classify call",
              config: { copyAnalysis: true },
              nextNodeRef: "route",
            },
            {
              ref: "route",
              type: "route",
              label: "Default route",
              config: { mode: "queue", queue: "general" },
            },
          ],
        },
      });
      toast({ title: "Flow created", description: created.name });
      reset();
      setOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await updateFlow.mutateAsync({ id, data: { isActive } });
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this flow and all of its nodes?")) return;
    await deleteFlow.mutateAsync({ id });
    refetch();
  };

  const channelName = (cid: string | null | undefined) =>
    channels?.find((c) => c.id === cid)?.name ?? "Any channel";

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-flows">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Call Flows</h1>
          <p className="text-muted-foreground">
            Per-channel orchestration. After a call is analyzed and rules fire,
            the active flow walks its node graph (conditions, AI decisions,
            actions, routes).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-flow">
              <Plus className="mr-2 h-4 w-4" /> New flow
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>Create flow</DialogTitle>
              <DialogDescription>
                We start you with a 2-node skeleton: an AI decision feeding
                into a default route. Open the flow to add condition / action
                nodes.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="flow-name">Name</Label>
                <Input
                  id="flow-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sales triage"
                  required
                  data-testid="input-flow-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="flow-desc">Description</Label>
                <Input
                  id="flow-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Triage inbound sales calls by intent"
                />
              </div>
              <div className="space-y-2">
                <Label>Channel binding</Label>
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>
                      Any channel (global)
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createFlow.isPending}>
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Activity className="h-6 w-6 animate-pulse text-primary" />
        </div>
      ) : (flows ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No flows yet</h3>
            <p className="text-muted-foreground max-w-md">
              Create your first flow to orchestrate calls per channel. Flows
              run after the rules engine.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {flows!.map((f) => (
            <Card
              key={f.id}
              className={`bg-card ${f.isActive ? "" : "opacity-60"}`}
              data-testid={`flow-${f.id}`}
            >
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <GitBranch className="h-4 w-4 text-primary" />
                    {f.name}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {channelName(f.channelId)} · {f.nodes.length} node(s)
                  </CardDescription>
                </div>
                <Switch
                  checked={f.isActive}
                  onCheckedChange={(v) => handleToggle(f.id, v)}
                />
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                {f.description && (
                  <p className="text-muted-foreground">{f.description}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {f.nodes.slice(0, 8).map((n) => (
                    <Badge
                      key={n.id}
                      variant="secondary"
                      className="text-[10px]"
                    >
                      {n.type}
                      {n.label ? `: ${n.label}` : ""}
                    </Badge>
                  ))}
                  {f.nodes.length > 8 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{f.nodes.length - 8} more
                    </Badge>
                  )}
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-3 justify-between">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/flows/${f.id}`}>
                    Open <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(f.id)}
                  data-testid={`button-delete-${f.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
