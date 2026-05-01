import { useState } from "react";
import {
  useListTransferTargets,
  useCreateTransferTarget,
  useUpdateTransferTarget,
  useDeleteTransferTarget,
  type TransferTarget,
  type CreateTransferTargetBody,
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
  ArrowRightLeft,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

const TYPES = [
  { value: "external_number", label: "External phone number" },
  { value: "user", label: "Internal user (placeholder)" },
  { value: "queue", label: "Queue (placeholder)" },
  { value: "voicemail", label: "Voicemail" },
];

interface FormState {
  name: string;
  type: string;
  phoneNumber: string;
  queueName: string;
  priority: string;
  enabled: boolean;
}

const EMPTY: FormState = {
  name: "",
  type: "external_number",
  phoneNumber: "",
  queueName: "",
  priority: "100",
  enabled: true,
};

function formToBody(form: FormState): CreateTransferTargetBody {
  return {
    name: form.name.trim(),
    type: form.type,
    phoneNumber:
      form.type === "external_number" ? form.phoneNumber.trim() || null : null,
    queueName: form.type === "queue" ? form.queueName.trim() || null : null,
    priority: Number(form.priority) || 100,
    enabled: form.enabled,
  };
}

export default function TransferTargetsPage() {
  const { data: targets, isLoading, refetch } = useListTransferTargets();
  const create = useCreateTransferTarget();
  const update = useUpdateTransferTarget();
  const remove = useDeleteTransferTarget();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (t: TransferTarget) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      type: t.type,
      phoneNumber: t.phoneNumber ?? "",
      queueName: t.queueName ?? "",
      priority: String(t.priority ?? 100),
      enabled: t.enabled,
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      const body = formToBody(form);
      if (editingId) {
        await update.mutateAsync({ id: editingId, data: body });
        toast({ title: "Target updated", description: form.name });
      } else {
        await create.mutateAsync({ data: body });
        toast({ title: "Target created", description: form.name });
      }
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this transfer target?")) return;
    try {
      await remove.mutateAsync({ id });
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-transfer-targets">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ArrowRightLeft className="h-7 w-7 text-primary" />
            Transfer targets
          </h1>
          <p className="text-muted-foreground">
            Where the AI receptionist can hand off a live call. Operators can
            also pick a target manually from the live switchboard.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-new-target">
              <Plus className="mr-2 h-4 w-4" /> New target
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit target" : "Create target"}
              </DialogTitle>
              <DialogDescription>
                External numbers must be E.164 formatted (+15551234567). Other
                target types are placeholders for upcoming releases.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tt-name">Name</Label>
                <Input
                  id="tt-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Front desk after-hours"
                  required
                  data-testid="input-target-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm({ ...form, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tt-prio">Priority</Label>
                  <Input
                    id="tt-prio"
                    type="number"
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value })
                    }
                  />
                </div>
              </div>

              {form.type === "external_number" && (
                <div className="space-y-2">
                  <Label htmlFor="tt-phone">Phone number (E.164)</Label>
                  <Input
                    id="tt-phone"
                    value={form.phoneNumber}
                    onChange={(e) =>
                      setForm({ ...form, phoneNumber: e.target.value })
                    }
                    placeholder="+15555550199"
                  />
                </div>
              )}
              {form.type === "queue" && (
                <div className="space-y-2">
                  <Label htmlFor="tt-queue">Queue name</Label>
                  <Input
                    id="tt-queue"
                    value={form.queueName}
                    onChange={(e) =>
                      setForm({ ...form, queueName: e.target.value })
                    }
                    placeholder="sales"
                  />
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border border-border p-2">
                <Label className="text-sm cursor-pointer">Enabled</Label>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
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
                <Button
                  type="submit"
                  disabled={create.isPending || update.isPending}
                >
                  {editingId ? "Save changes" : "Create"}
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
      ) : (targets ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <ArrowRightLeft className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No transfer targets</h3>
            <p className="text-muted-foreground max-w-md">
              Apply a product mode or add one manually so the AI has somewhere
              to escalate calls.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {targets!.map((t) => (
            <Card
              key={t.id}
              className={`bg-card ${t.enabled ? "" : "opacity-60"}`}
              data-testid={`target-${t.id}`}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowRightLeft className="h-4 w-4 text-primary" />
                  {t.name}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t.type} · priority {t.priority}
                  {!t.enabled && " · paused"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {t.phoneNumber && (
                  <div>
                    <Badge variant="outline" className="text-[10px]">
                      → {t.phoneNumber}
                    </Badge>
                  </div>
                )}
                {t.queueName && (
                  <div>
                    <Badge variant="outline" className="text-[10px]">
                      queue: {t.queueName}
                    </Badge>
                  </div>
                )}
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-3 justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(t)}
                  data-testid={`button-edit-target-${t.id}`}
                >
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(t.id)}
                  data-testid={`button-delete-target-${t.id}`}
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
