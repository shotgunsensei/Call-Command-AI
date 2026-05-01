import { useState } from "react";
import {
  useListAutomationRules,
  useCreateAutomationRule,
  useUpdateAutomationRule,
  useDeleteAutomationRule,
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
import { Textarea } from "@/components/ui/textarea";
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
  Workflow,
  Zap,
  Star,
} from "lucide-react";

const STARTER_TEMPLATE = JSON.stringify(
  {
    conditions: { callType: "support" },
    actions: [{ type: "create_ticket" }],
  },
  null,
  2,
);

export default function AutomationRulesPage() {
  const { data: rules, isLoading, refetch } = useListAutomationRules();
  const createRule = useCreateAutomationRule();
  const updateRule = useUpdateAutomationRule();
  const deleteRule = useDeleteAutomationRule();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [json, setJson] = useState(STARTER_TEMPLATE);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    let parsed: { conditions?: unknown; actions?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch {
      toast({
        title: "Invalid JSON",
        description: "Could not parse rule definition.",
        variant: "destructive",
      });
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray(parsed.actions) ||
      parsed.actions.length === 0
    ) {
      toast({
        title: "Invalid rule",
        description: "Provide `conditions` and at least one action.",
        variant: "destructive",
      });
      return;
    }
    try {
      await createRule.mutateAsync({
        data: {
          name: name.trim(),
          conditions: (parsed.conditions ?? {}) as Record<string, unknown>,
          actions: parsed.actions as Array<{ [key: string]: unknown }>,
          enabled: true,
        },
      });
      toast({ title: "Rule created", description: name });
      setName("");
      setJson(STARTER_TEMPLATE);
      setOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateRule.mutateAsync({ id, data: { enabled } });
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    await deleteRule.mutateAsync({ id });
    refetch();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-rules">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automation Rules</h1>
          <p className="text-muted-foreground">
            When a call is analyzed, matching rules trigger ticket / lead / task
            creation or fire integration webhooks.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-rule">
              <Plus className="mr-2 h-4 w-4" /> New rule
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create automation rule</DialogTitle>
              <DialogDescription>
                JSON conditions are matched against the analyzed call (callType,
                intent, priority, sentiment, tagIncludes, isDemo). Each action
                must have a <code>type</code> of{" "}
                <code>create_ticket</code>, <code>create_lead</code>,{" "}
                <code>create_task</code>, or <code>send_webhook</code>.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rule-name">Name</Label>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="High-priority support → ticket + Slack"
                  required
                  data-testid="input-rule-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-json">Rule definition (JSON)</Label>
                <Textarea
                  id="rule-json"
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  className="font-mono text-xs h-64"
                  data-testid="input-rule-json"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Activity className="h-6 w-6 animate-pulse text-primary" />
        </div>
      ) : (rules ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Workflow className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No rules yet</h3>
            <p className="text-muted-foreground max-w-md">
              Default starter rules will appear automatically. Create custom ones
              to send Slack alerts, fire CRM webhooks, or generate tasks.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {rules!.map((r) => (
            <Card
              key={r.id}
              className={`bg-card ${r.enabled ? "" : "opacity-60"}`}
              data-testid={`rule-${r.id}`}
            >
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Zap className="h-4 w-4 text-primary" />
                    {r.name}
                    {r.isDefault && (
                      <Badge variant="secondary" className="text-xs">
                        <Star className="h-3 w-3 mr-1" />
                        starter
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Trigger: <code>{r.triggerType}</code> ·{" "}
                    {Array.isArray(r.actions) ? r.actions.length : 0} action(s)
                  </CardDescription>
                </div>
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) => handleToggle(r.id, v)}
                />
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 text-xs">
                <div>
                  <div className="font-medium mb-1 text-muted-foreground">
                    Conditions
                  </div>
                  <pre className="bg-secondary/40 rounded p-2 overflow-auto max-h-40">
                    {JSON.stringify(r.conditions, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="font-medium mb-1 text-muted-foreground">
                    Actions
                  </div>
                  <pre className="bg-secondary/40 rounded p-2 overflow-auto max-h-40">
                    {JSON.stringify(r.actions, null, 2)}
                  </pre>
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-3 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(r.id)}
                  data-testid={`button-delete-${r.id}`}
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
