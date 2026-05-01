import { useState } from "react";
import {
  useListReceptionistProfiles,
  useCreateReceptionistProfile,
  useUpdateReceptionistProfile,
  useDeleteReceptionistProfile,
  type ReceptionistProfile,
  type CreateReceptionistProfileBody,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  Bot,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "urgent", label: "Urgent" },
  { value: "concise", label: "Concise" },
  { value: "warm", label: "Warm" },
];

interface FormState {
  name: string;
  greetingScript: string;
  fallbackScript: string;
  escalationScript: string;
  voicemailScript: string;
  tone: string;
  intakeFieldsText: string;
  emergencyKeywords: string;
  vipNumbers: string;
  angrySentimentEscalates: boolean;
  enabled: boolean;
  isDefault: boolean;
}

const EMPTY: FormState = {
  name: "",
  greetingScript:
    "Thanks for calling. I'm an AI assistant and can take your details so the right person calls you back.",
  fallbackScript:
    "Sorry, I didn't catch that. Could you say it again?",
  escalationScript:
    "This sounds urgent. Connecting you to someone who can help right now.",
  voicemailScript:
    "I'll take a quick voicemail for you. Please share your name, callback number, and a brief message after the tone.",
  tone: "professional",
  intakeFieldsText: "name|Caller name\nphone|Callback number\nreason|Reason for calling",
  emergencyKeywords: "emergency, urgent, bleeding, fire, ambulance",
  vipNumbers: "",
  angrySentimentEscalates: true,
  enabled: true,
  isDefault: false,
};

function parseIntakeFields(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, label, ...rest] = line.split("|").map((p) => p.trim());
      return {
        key: (key || "").slice(0, 60),
        label: label || key || "",
        required: true,
        prompt: rest.join("|") || undefined,
      };
    })
    .filter((f) => f.key);
}

function intakeFieldsToText(profile: ReceptionistProfile) {
  return (profile.intakeSchema?.fields ?? [])
    .map((f) => [f.key, f.label, f.prompt].filter(Boolean).join("|"))
    .join("\n");
}

function formToBody(form: FormState): CreateReceptionistProfileBody {
  return {
    name: form.name.trim(),
    greetingScript: form.greetingScript.trim(),
    fallbackScript: form.fallbackScript.trim() || null,
    escalationScript: form.escalationScript.trim() || null,
    voicemailScript: form.voicemailScript.trim() || null,
    tone: form.tone || "professional",
    intakeSchema: { fields: parseIntakeFields(form.intakeFieldsText) },
    escalationRules: {
      emergencyKeywords: form.emergencyKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      vipNumbers: form.vipNumbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      angrySentimentEscalates: form.angrySentimentEscalates,
    },
    enabled: form.enabled,
    isDefault: form.isDefault,
  };
}

export default function ReceptionistProfilesPage() {
  const { data: profiles, isLoading, refetch } = useListReceptionistProfiles();
  const create = useCreateReceptionistProfile();
  const update = useUpdateReceptionistProfile();
  const remove = useDeleteReceptionistProfile();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (p: ReceptionistProfile) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      greetingScript: p.greetingScript,
      fallbackScript: p.fallbackScript ?? "",
      escalationScript: p.escalationScript ?? "",
      voicemailScript: p.voicemailScript ?? "",
      tone: p.tone,
      intakeFieldsText: intakeFieldsToText(p),
      emergencyKeywords: (p.escalationRules?.emergencyKeywords ?? []).join(", "),
      vipNumbers: (p.escalationRules?.vipNumbers ?? []).join(", "),
      angrySentimentEscalates:
        p.escalationRules?.angrySentimentEscalates ?? true,
      enabled: p.enabled,
      isDefault: p.isDefault,
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.greetingScript.trim()) return;
    try {
      const body = formToBody(form);
      if (editingId) {
        await update.mutateAsync({ id: editingId, data: body });
        toast({ title: "Receptionist updated", description: form.name });
      } else {
        await create.mutateAsync({ data: body });
        toast({ title: "Receptionist created", description: form.name });
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
    if (!confirm("Delete this receptionist profile?")) return;
    try {
      await remove.mutateAsync({ id });
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-receptionist-profiles">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Bot className="h-7 w-7 text-primary" />
            Receptionist profiles
          </h1>
          <p className="text-muted-foreground">
            Reusable scripts for the live AI receptionist. A profile defines the
            greeting, intake fields, escalation rules, voicemail prompt, and
            fallback behavior. Bind a profile to a channel from the Channels
            page.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-new-profile">
              <Plus className="mr-2 h-4 w-4" /> New profile
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit profile" : "Create profile"}
              </DialogTitle>
              <DialogDescription>
                Scripts run server-side through the AI decision service. The
                receptionist <strong>never gives medical or automotive
                diagnoses</strong> — keep prompts administrative (intake +
                routing only).
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="rp-name">Name</Label>
                  <Input
                    id="rp-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder="Front desk"
                    required
                    data-testid="input-profile-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <Select
                    value={form.tone}
                    onValueChange={(v) => setForm({ ...form, tone: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rp-greet">Greeting</Label>
                <Textarea
                  id="rp-greet"
                  rows={2}
                  value={form.greetingScript}
                  onChange={(e) =>
                    setForm({ ...form, greetingScript: e.target.value })
                  }
                  required
                />
              </div>

              <Accordion type="multiple" defaultValue={["intake", "scripts"]}>
                <AccordionItem value="intake">
                  <AccordionTrigger className="text-sm">
                    Intake fields
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pt-2">
                    <Label htmlFor="rp-intake">
                      One per line. Format:{" "}
                      <code>key|Label|Optional prompt</code>
                    </Label>
                    <Textarea
                      id="rp-intake"
                      rows={5}
                      className="font-mono text-xs"
                      value={form.intakeFieldsText}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          intakeFieldsText: e.target.value,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      The receptionist will ask each missing field one at a
                      time before transferring or ending the call.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="scripts">
                  <AccordionTrigger className="text-sm">
                    Fallback / escalation / voicemail scripts
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="rp-fb">Fallback (didn't catch that)</Label>
                      <Textarea
                        id="rp-fb"
                        rows={2}
                        value={form.fallbackScript}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            fallbackScript: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rp-esc">Escalation</Label>
                      <Textarea
                        id="rp-esc"
                        rows={2}
                        value={form.escalationScript}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            escalationScript: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rp-vm">Voicemail prompt</Label>
                      <Textarea
                        id="rp-vm"
                        rows={2}
                        value={form.voicemailScript}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            voicemailScript: e.target.value,
                          })
                        }
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="escalation">
                  <AccordionTrigger className="text-sm">
                    Escalation rules
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="rp-keywords">
                        Emergency keywords (comma-separated)
                      </Label>
                      <Input
                        id="rp-keywords"
                        value={form.emergencyKeywords}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            emergencyKeywords: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rp-vip">
                        VIP caller numbers (E.164, comma-separated)
                      </Label>
                      <Input
                        id="rp-vip"
                        value={form.vipNumbers}
                        onChange={(e) =>
                          setForm({ ...form, vipNumbers: e.target.value })
                        }
                        placeholder="+15555550100, +15555550101"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border p-2">
                      <Label className="text-sm cursor-pointer">
                        Angry sentiment triggers escalation
                      </Label>
                      <Switch
                        checked={form.angrySentimentEscalates}
                        onCheckedChange={(v) =>
                          setForm({
                            ...form,
                            angrySentimentEscalates: v,
                          })
                        }
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-md border border-border p-2">
                  <Label className="text-sm cursor-pointer">Enabled</Label>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-2">
                  <Label className="text-sm cursor-pointer">Default</Label>
                  <Switch
                    checked={form.isDefault}
                    onCheckedChange={(v) =>
                      setForm({ ...form, isDefault: v })
                    }
                  />
                </div>
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
      ) : (profiles ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No receptionist profiles yet</h3>
            <p className="text-muted-foreground max-w-md">
              Profiles are seeded automatically when you apply a product mode,
              or you can create one from scratch.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles!.map((p) => (
            <Card
              key={p.id}
              className={`bg-card ${p.enabled ? "" : "opacity-60"}`}
              data-testid={`profile-${p.id}`}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Bot className="h-4 w-4 text-primary" />
                  {p.name}
                  {p.isDefault && (
                    <Badge variant="secondary" className="text-xs">
                      <Star className="h-3 w-3 mr-1" /> default
                    </Badge>
                  )}
                  {!p.enabled && (
                    <Badge variant="outline" className="text-xs">
                      paused
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  {p.tone} · {p.voiceProvider}
                  {p.productMode ? ` · ${p.productMode}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="line-clamp-2 italic text-muted-foreground">
                  “{p.greetingScript}”
                </div>
                <div className="flex flex-wrap gap-1">
                  {(p.intakeSchema?.fields ?? []).slice(0, 6).map((f) => (
                    <Badge key={f.key} variant="outline" className="text-[10px]">
                      {f.label}
                    </Badge>
                  ))}
                </div>
                {(p.escalationRules?.emergencyKeywords ?? []).length > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Escalates on:{" "}
                    {(p.escalationRules?.emergencyKeywords ?? [])
                      .slice(0, 6)
                      .join(", ")}
                  </div>
                )}
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-3 justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(p)}
                  data-testid={`button-edit-profile-${p.id}`}
                >
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(p.id)}
                  data-testid={`button-delete-profile-${p.id}`}
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
