import { useState } from "react";
import { 
  useListIntegrations, 
  useCreateIntegration, 
  useUpdateIntegration, 
  useDeleteIntegration, 
  useTestIntegration,
  useGetIngestionToken,
  useRotateIngestionToken
} from "@workspace/api-client-react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cable, Plus, Trash2, Play, KeyRound, RefreshCcw, Copy, Inbox } from "lucide-react";

export default function Integrations() {
  const { data: integrations, isLoading, refetch } = useListIntegrations();
  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const deleteIntegration = useDeleteIntegration();
  const testIntegration = useTestIntegration();
  const { data: tokenData, refetch: refetchToken } = useGetIngestionToken();
  const rotateToken = useRotateIngestionToken();
  const { toast } = useToast();
  // Raw token is only visible once, immediately after rotation. After that
  // the server only retains a SHA-256 hash so we cannot show it again.
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const handleRotate = async () => {
    if (
      tokenData?.hasToken &&
      !confirm(
        "Rotating will revoke your current token immediately. Existing webhooks will need to be updated, and the new token will only be shown once. Continue?",
      )
    )
      return;
    const res = await rotateToken.mutateAsync();
    setRevealedToken(res?.token ?? null);
    refetchToken();
    toast({
      title: "Token generated",
      description: "Copy it now — it won't be shown again.",
    });
  };

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newType, setNewType] = useState("webhook");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const [testingId, setTestingId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newUrl) return;

    try {
      await createIntegration.mutateAsync({
        data: {
          type: newType,
          name: newName,
          webhookUrl: newUrl,
          enabled: true
        }
      });
      toast({ title: "Integration created", description: `${newName} has been connected.` });
      setIsAddOpen(false);
      setNewName("");
      setNewUrl("");
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await updateIntegration.mutateAsync({ id, data: { enabled } });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this integration?")) return;
    try {
      await deleteIntegration.mutateAsync({ id });
      toast({ title: "Deleted", description: "Integration removed." });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleTest = async (id: string) => {
    try {
      setTestingId(id);
      const res = await testIntegration.mutateAsync({ id });
      if (res.ok) {
        toast({ 
          title: "Test Successful", 
          description: `Payload delivered. Server responded with HTTP ${res.status}.` 
        });
      } else {
        toast({ 
          title: "Test Failed", 
          description: `Server responded with HTTP ${res.status || 'unknown'}: ${res.message}`, 
          variant: "destructive" 
        });
      }
    } catch (err: any) {
      toast({ title: "Test Failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground">Route extracted intelligence to external systems.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Integration
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>Configure Integration</DialogTitle>
              <DialogDescription>
                Set up a new webhook endpoint to receive parsed call data.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webhook">Custom Webhook</SelectItem>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="zapier">Zapier</SelectItem>
                    <SelectItem value="make">Make.com</SelectItem>
                    <SelectItem value="crm">CRM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input 
                  id="name" 
                  placeholder="e.g. Sales Slack Channel" 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">Webhook URL</Label>
                <Input 
                  id="url" 
                  type="url"
                  placeholder="https://..." 
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  required
                />
              </div>
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit">Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-card" data-testid="card-ingestion">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Inbox className="h-4 w-4 text-primary" /> Inbound ingestion
          </CardTitle>
          <CardDescription>
            Send call records into CallCommand AI from Twilio, email, or any
            HTTP source. Authenticate with your ingestion token as{" "}
            <code>Authorization: Bearer &lt;token&gt;</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <code
              className="text-xs bg-secondary/40 rounded px-2 py-1 font-mono break-all"
              data-testid="text-ingestion-token"
            >
              {revealedToken
                ? revealedToken
                : tokenData?.hasToken
                  ? "•••••••• (hidden — rotate to reveal a new token)"
                  : "no token yet"}
            </code>
            {revealedToken && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(revealedToken)}
                data-testid="button-copy-token"
              >
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRotate}
              disabled={rotateToken.isPending}
              data-testid="button-rotate-token"
            >
              <RefreshCcw className="h-3 w-3 mr-1" />
              {tokenData?.hasToken ? "Rotate" : "Generate"}
            </Button>
          </div>
          {revealedToken && (
            <p
              className="text-xs text-amber-500"
              data-testid="text-token-warning"
            >
              Save this token now — for security it is only shown once. We
              store a hash and cannot recover the raw value later.
            </p>
          )}
          {tokenData?.endpoints && (
            <div className="grid gap-2 text-xs">
              {(["twilio", "email", "webhook"] as const).map((k) => {
                const url = `${baseUrl}${tokenData.endpoints[k]}`;
                return (
                  <div
                    key={k}
                    className="flex items-center gap-2 bg-secondary/30 rounded px-2 py-1"
                  >
                    <Badge variant="secondary" className="uppercase">
                      {k}
                    </Badge>
                    <code className="font-mono text-[11px] truncate flex-1">
                      POST {url}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copy(url)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xl font-semibold mt-2 mb-3">Outbound webhooks</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Forward analyzed calls to Slack, Zapier, your CRM, or any HTTPS
          endpoint. Reference these from automation rules with the{" "}
          <code>send_webhook</code> action.
        </p>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading configurations...</div>
        ) : integrations?.length === 0 ? (
          <Card className="bg-card border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center">
              <Cable className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">No integrations active</h3>
              <p className="text-muted-foreground max-w-md">
                Connect CallCommand AI to your CRM, Slack, or automation tools to instantly route action items and summaries after every call.
              </p>
            </CardContent>
          </Card>
        ) : (
          integrations?.map(integration => (
            <Card key={integration.id} className={`bg-card transition-colors ${!integration.enabled ? 'opacity-70' : ''}`}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center text-lg">
                    {integration.name}
                    <Badge variant="secondary" className="ml-2 capitalize font-normal text-xs">
                      {integration.type}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="font-mono text-xs truncate max-w-sm md:max-w-md lg:max-w-lg">
                    {integration.webhookUrl}
                  </CardDescription>
                </div>
                <div className="flex items-center space-x-2">
                  <Label htmlFor={`switch-${integration.id}`} className="sr-only">Toggle integration</Label>
                  <Switch 
                    id={`switch-${integration.id}`}
                    checked={integration.enabled} 
                    onCheckedChange={(v) => handleToggle(integration.id, v)} 
                  />
                </div>
              </CardHeader>
              <CardFooter className="pt-3 border-t border-border/50 flex justify-between">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleTest(integration.id)}
                  disabled={testingId === integration.id || !integration.enabled}
                >
                  <Play className={`mr-2 h-3 w-3 ${testingId === integration.id ? 'animate-pulse text-primary' : ''}`} />
                  Test Connection
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(integration.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
