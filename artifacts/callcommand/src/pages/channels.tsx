import { useState } from "react";
import {
  useListChannels,
  useCreateChannel,
  useUpdateChannel,
  useDeleteChannel,
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
  PhoneCall,
  Star,
  Radio,
} from "lucide-react";

const CHANNEL_TYPES = [
  { value: "phone", label: "Phone line" },
  { value: "sip", label: "SIP trunk" },
  { value: "twilio", label: "Twilio number" },
  { value: "webhook", label: "Webhook ingest" },
  { value: "demo", label: "Demo / sandbox" },
];

export default function ChannelsPage() {
  const { data: channels, isLoading, refetch } = useListChannels();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [type, setType] = useState("phone");
  const [defaultRoute, setDefaultRoute] = useState("");

  const reset = () => {
    setName("");
    setPhoneNumber("");
    setType("phone");
    setDefaultRoute("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createChannel.mutateAsync({
        data: {
          name: name.trim(),
          phoneNumber: phoneNumber.trim() || null,
          type,
          defaultRoute: defaultRoute.trim() || null,
          isActive: true,
        },
      });
      toast({ title: "Channel created", description: name });
      reset();
      setOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await updateChannel.mutateAsync({ id, data: { isActive } });
    refetch();
  };

  const handleDelete = async (id: string, isDefault: boolean) => {
    if (isDefault) {
      toast({
        title: "Cannot delete",
        description: "The default channel is required for ingestion fallback.",
        variant: "destructive",
      });
      return;
    }
    if (!confirm("Delete this channel?")) return;
    try {
      await deleteChannel.mutateAsync({ id });
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-channels">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Channels</h1>
          <p className="text-muted-foreground">
            Each inbound phone line, SIP trunk, or webhook source is its own
            channel. Bind a flow to a channel to orchestrate that line.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-channel">
              <Plus className="mr-2 h-4 w-4" /> New channel
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>Create channel</DialogTitle>
              <DialogDescription>
                Phone numbers should be in E.164 (+15551234567). Inbound calls
                whose <code>callerPhone</code> matches a channel will route to
                that channel; everything else falls back to the default.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ch-name">Name</Label>
                <Input
                  id="ch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sales inbound"
                  required
                  data-testid="input-channel-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ch-phone">Phone number</Label>
                  <Input
                    id="ch-phone"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+15551234567"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNEL_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-route">Default route (optional)</Label>
                <Input
                  id="ch-route"
                  value={defaultRoute}
                  onChange={(e) => setDefaultRoute(e.target.value)}
                  placeholder="user-id, queue name, or webhook URL"
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
                <Button type="submit" disabled={createChannel.isPending}>
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
      ) : (channels ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No channels yet</h3>
            <p className="text-muted-foreground max-w-md">
              A default channel is auto-seeded the first time a call is
              ingested. You can also create channels manually.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels!.map((c) => (
            <Card
              key={c.id}
              className={`bg-card ${c.isActive ? "" : "opacity-60"}`}
              data-testid={`channel-${c.id}`}
            >
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <PhoneCall className="h-4 w-4 text-primary" />
                    {c.name}
                    {c.isDefault && (
                      <Badge variant="secondary" className="text-xs">
                        <Star className="h-3 w-3 mr-1" /> default
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {c.type} · {c.phoneNumber || "no number"}
                  </CardDescription>
                </div>
                <Switch
                  checked={c.isActive}
                  onCheckedChange={(v) => handleToggle(c.id, v)}
                />
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {c.defaultRoute ? (
                  <div>
                    Default route:{" "}
                    <code className="text-foreground">{c.defaultRoute}</code>
                  </div>
                ) : (
                  <div>No default route configured.</div>
                )}
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-3 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(c.id, c.isDefault)}
                  data-testid={`button-delete-${c.id}`}
                  disabled={c.isDefault}
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
