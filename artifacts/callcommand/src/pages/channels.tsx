import { useState } from "react";
import {
  useListChannels,
  useCreateChannel,
  useUpdateChannel,
  useDeleteChannel,
  useListFlows,
  useListReceptionistProfiles,
  type CreateChannelBody,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  Pencil,
} from "lucide-react";

const CHANNEL_TYPES = [
  { value: "phone", label: "Phone line" },
  { value: "sip", label: "SIP trunk" },
  { value: "twilio", label: "Twilio number" },
  { value: "webhook", label: "Webhook ingest" },
  { value: "demo", label: "Demo / sandbox" },
];

const AFTER_HOURS_BEHAVIORS = [
  { value: "voicemail", label: "Send to voicemail" },
  { value: "forward", label: "Forward to number" },
  { value: "hangup", label: "Polite hang-up" },
  { value: "none", label: "No special handling" },
];

const LIVE_BEHAVIORS = [
  { value: "record_only", label: "Record-only (no live AI)" },
  { value: "forward_only", label: "Forward without AI" },
  { value: "voicemail_only", label: "Straight to voicemail" },
  { value: "ai_receptionist", label: "AI receptionist (multi-turn intake)" },
  { value: "ai_screen_then_transfer", label: "AI screen, then transfer" },
  { value: "ai_after_hours_intake", label: "AI after-hours only" },
];

const NONE = "__none__";

interface ChannelFormState {
  name: string;
  phoneNumber: string;
  type: string;
  defaultRoute: string;
  greetingText: string;
  recordCalls: boolean;
  allowVoicemail: boolean;
  forwardNumber: string;
  afterHoursBehavior: string;
  recordingConsentText: string;
  maxCallDurationSeconds: string;
  assignedFlowId: string;
  liveBehavior: string;
  receptionistProfileId: string;
  requireRecordingConsent: boolean;
  consentScript: string;
  consentRequiredBeforeRecording: boolean;
}

const EMPTY_FORM: ChannelFormState = {
  name: "",
  phoneNumber: "",
  type: "twilio",
  defaultRoute: "",
  greetingText: "",
  recordCalls: true,
  allowVoicemail: true,
  forwardNumber: "",
  afterHoursBehavior: "voicemail",
  recordingConsentText:
    "This call may be recorded for quality and training purposes.",
  maxCallDurationSeconds: "",
  assignedFlowId: "",
  liveBehavior: "record_only",
  receptionistProfileId: "",
  requireRecordingConsent: false,
  consentScript:
    "This call may be recorded and processed by an AI assistant. Press 1 or say yes to continue.",
  consentRequiredBeforeRecording: false,
};

function formToBody(form: ChannelFormState): CreateChannelBody {
  return {
    name: form.name.trim(),
    phoneNumber: form.phoneNumber.trim() || null,
    type: form.type,
    defaultRoute: form.defaultRoute.trim() || null,
    greetingText: form.greetingText.trim() || null,
    recordCalls: form.recordCalls,
    allowVoicemail: form.allowVoicemail,
    forwardNumber: form.forwardNumber.trim() || null,
    afterHoursBehavior: form.afterHoursBehavior || null,
    recordingConsentText: form.recordingConsentText.trim() || null,
    maxCallDurationSeconds: form.maxCallDurationSeconds.trim()
      ? Number(form.maxCallDurationSeconds.trim())
      : null,
    assignedFlowId: form.assignedFlowId || null,
    isActive: true,
    liveBehavior: form.liveBehavior || null,
    receptionistProfileId: form.receptionistProfileId || null,
    requireRecordingConsent: form.requireRecordingConsent,
    consentScript: form.consentScript.trim() || null,
    consentRequiredBeforeRecording: form.consentRequiredBeforeRecording,
  };
}

export default function ChannelsPage() {
  const { data: channels, isLoading, refetch } = useListChannels();
  const { data: flows } = useListFlows();
  const { data: receptionistProfiles } = useListReceptionistProfiles();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (id: string) => {
    const ch = (channels ?? []).find((c) => c.id === id);
    if (!ch) return;
    setEditingId(id);
    setForm({
      name: ch.name,
      phoneNumber: ch.phoneNumber ?? "",
      type: ch.type,
      defaultRoute: ch.defaultRoute ?? "",
      greetingText: ch.greetingText ?? "",
      recordCalls: ch.recordCalls,
      allowVoicemail: ch.allowVoicemail,
      forwardNumber: ch.forwardNumber ?? "",
      afterHoursBehavior: ch.afterHoursBehavior ?? "voicemail",
      recordingConsentText:
        ch.recordingConsentText ??
        "This call may be recorded for quality and training purposes.",
      maxCallDurationSeconds:
        ch.maxCallDurationSeconds != null
          ? String(ch.maxCallDurationSeconds)
          : "",
      assignedFlowId: ch.assignedFlowId ?? "",
      liveBehavior: ch.liveBehavior ?? "record_only",
      receptionistProfileId: ch.receptionistProfileId ?? "",
      requireRecordingConsent: ch.requireRecordingConsent ?? false,
      consentScript:
        ch.consentScript ??
        "This call may be recorded and processed by an AI assistant. Press 1 or say yes to continue.",
      consentRequiredBeforeRecording:
        ch.consentRequiredBeforeRecording ?? false,
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      const body = formToBody(form);
      if (editingId) {
        await updateChannel.mutateAsync({ id: editingId, data: body });
        toast({ title: "Channel updated", description: form.name });
      } else {
        await createChannel.mutateAsync({ data: body });
        toast({ title: "Channel created", description: form.name });
      }
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
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
            channel. Bind a flow and per-line behavior here.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-channel" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> New channel
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit channel" : "Create channel"}
              </DialogTitle>
              <DialogDescription>
                Phone numbers should be in E.164 (+15551234567). Inbound calls
                whose <code>To</code> matches a channel will route to that
                channel; everything else falls back to the default.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ch-name">Name</Label>
                <Input
                  id="ch-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Sales inbound"
                  required
                  data-testid="input-channel-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ch-phone">Phone number (E.164)</Label>
                  <Input
                    id="ch-phone"
                    value={form.phoneNumber}
                    onChange={(e) =>
                      setForm({ ...form, phoneNumber: e.target.value })
                    }
                    placeholder="+15551234567"
                  />
                </div>
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
                      {CHANNEL_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Accordion
                type="multiple"
                defaultValue={editingId ? ["telephony"] : []}
              >
                <AccordionItem value="telephony">
                  <AccordionTrigger className="text-sm">
                    Telephony behavior
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="ch-greet">Greeting text</Label>
                      <Textarea
                        id="ch-greet"
                        rows={2}
                        value={form.greetingText}
                        onChange={(e) =>
                          setForm({ ...form, greetingText: e.target.value })
                        }
                        placeholder="Thanks for calling Acme Support."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between rounded-md border border-border p-2">
                        <Label
                          htmlFor="ch-record"
                          className="text-sm cursor-pointer"
                        >
                          Record calls
                        </Label>
                        <Switch
                          id="ch-record"
                          checked={form.recordCalls}
                          onCheckedChange={(v) =>
                            setForm({ ...form, recordCalls: v })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border border-border p-2">
                        <Label
                          htmlFor="ch-vm"
                          className="text-sm cursor-pointer"
                        >
                          Allow voicemail
                        </Label>
                        <Switch
                          id="ch-vm"
                          checked={form.allowVoicemail}
                          onCheckedChange={(v) =>
                            setForm({ ...form, allowVoicemail: v })
                          }
                        />
                      </div>
                    </div>
                    {form.recordCalls && (
                      <div className="space-y-2">
                        <Label htmlFor="ch-consent">Recording consent</Label>
                        <Textarea
                          id="ch-consent"
                          rows={2}
                          value={form.recordingConsentText}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              recordingConsentText: e.target.value,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Played before connecting if recording is enabled.
                          You are responsible for compliance with local
                          recording-consent law.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="ch-fwd">Forward to (E.164)</Label>
                        <Input
                          id="ch-fwd"
                          value={form.forwardNumber}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              forwardNumber: e.target.value,
                            })
                          }
                          placeholder="+15555550199"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>After-hours behavior</Label>
                        <Select
                          value={form.afterHoursBehavior}
                          onValueChange={(v) =>
                            setForm({ ...form, afterHoursBehavior: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {AFTER_HOURS_BEHAVIORS.map((b) => (
                              <SelectItem key={b.value} value={b.value}>
                                {b.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="ch-max">Max call seconds</Label>
                        <Input
                          id="ch-max"
                          type="number"
                          value={form.maxCallDurationSeconds}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              maxCallDurationSeconds: e.target.value,
                            })
                          }
                          placeholder="600"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Assigned flow</Label>
                        <Select
                          value={form.assignedFlowId || "__none__"}
                          onValueChange={(v) =>
                            setForm({
                              ...form,
                              assignedFlowId: v === "__none__" ? "" : v,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {(flows ?? []).map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="live">
                  <AccordionTrigger className="text-sm">
                    Live AI receptionist
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label>Live behavior</Label>
                      <Select
                        value={form.liveBehavior}
                        onValueChange={(v) =>
                          setForm({ ...form, liveBehavior: v })
                        }
                      >
                        <SelectTrigger data-testid="select-live-behavior">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LIVE_BEHAVIORS.map((b) => (
                            <SelectItem key={b.value} value={b.value}>
                              {b.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        Controls how Twilio voice webhooks branch the inbound
                        call. AI behaviors run server-side intake then either
                        transfer, take voicemail, or end politely.
                      </p>
                    </div>
                    {(form.liveBehavior === "ai_receptionist" ||
                      form.liveBehavior === "ai_screen_then_transfer" ||
                      form.liveBehavior === "ai_after_hours_intake") && (
                      <div className="space-y-2">
                        <Label>Receptionist profile</Label>
                        <Select
                          value={form.receptionistProfileId || NONE}
                          onValueChange={(v) =>
                            setForm({
                              ...form,
                              receptionistProfileId: v === NONE ? "" : v,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Use workspace default" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>
                              Use workspace default
                            </SelectItem>
                            {(receptionistProfiles ?? []).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                                {p.isDefault ? " (default)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between rounded-md border border-border p-2">
                        <Label className="text-sm cursor-pointer">
                          Require recording consent
                        </Label>
                        <Switch
                          checked={form.requireRecordingConsent}
                          onCheckedChange={(v) =>
                            setForm({ ...form, requireRecordingConsent: v })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border border-border p-2">
                        <Label className="text-sm cursor-pointer">
                          Block recording until consent
                        </Label>
                        <Switch
                          checked={form.consentRequiredBeforeRecording}
                          onCheckedChange={(v) =>
                            setForm({
                              ...form,
                              consentRequiredBeforeRecording: v,
                            })
                          }
                        />
                      </div>
                    </div>
                    {form.requireRecordingConsent && (
                      <div className="space-y-2">
                        <Label htmlFor="ch-consent-script">Consent script</Label>
                        <Textarea
                          id="ch-consent-script"
                          rows={2}
                          value={form.consentScript}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              consentScript: e.target.value,
                            })
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Played at the start of every call when AI/recording
                          is enabled. You are responsible for compliance with
                          local two-party consent law.
                        </p>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="routing">
                  <AccordionTrigger className="text-sm">
                    Routing & integrations
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="ch-route">
                        Default route (optional)
                      </Label>
                      <Input
                        id="ch-route"
                        value={form.defaultRoute}
                        onChange={(e) =>
                          setForm({ ...form, defaultRoute: e.target.value })
                        }
                        placeholder="user-id, queue name, or webhook URL"
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

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
                  disabled={createChannel.isPending || updateChannel.isPending}
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
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <div className="flex flex-wrap gap-2">
                  {c.recordCalls ? (
                    <Badge variant="outline" className="text-[10px]">
                      recording on
                    </Badge>
                  ) : null}
                  {c.allowVoicemail ? (
                    <Badge variant="outline" className="text-[10px]">
                      voicemail
                    </Badge>
                  ) : null}
                  {c.forwardNumber ? (
                    <Badge variant="outline" className="text-[10px]">
                      → {c.forwardNumber}
                    </Badge>
                  ) : null}
                  {c.assignedFlowId ? (
                    <Badge variant="outline" className="text-[10px]">
                      flow bound
                    </Badge>
                  ) : null}
                  {c.liveBehavior && c.liveBehavior !== "record_only" ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-primary/50 text-primary"
                    >
                      {c.liveBehavior.replace(/_/g, " ")}
                    </Badge>
                  ) : null}
                  {c.receptionistProfileId ? (
                    <Badge variant="outline" className="text-[10px]">
                      AI bound
                    </Badge>
                  ) : null}
                </div>
                {c.greetingText && (
                  <div className="line-clamp-2 italic">
                    “{c.greetingText}”
                  </div>
                )}
                {c.defaultRoute && (
                  <div>
                    Route:{" "}
                    <code className="text-foreground">{c.defaultRoute}</code>
                  </div>
                )}
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-3 justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(c.id)}
                  data-testid={`button-edit-${c.id}`}
                >
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
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
