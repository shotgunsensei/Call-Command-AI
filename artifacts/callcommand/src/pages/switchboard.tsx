import { useState } from "react";
import {
  useGetSwitchboard,
  useListTransferTargets,
  useMarkLiveSessionUrgent,
  useTransferLiveSession,
  useEndLiveSession,
  useAddLiveSessionNote,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  Headphones,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Radio,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  statusBadgeClass,
  statusLabel,
  toDisplayStatus,
} from "@/lib/callStatus";

// 4s polling — wallboard refresh cadence for live AI sessions.
const SWITCHBOARD_POLL_MS = 4_000;

export default function SwitchboardPage() {
  const { data, isLoading, refetch, isFetching } = useGetSwitchboard({
    query: {
      queryKey: ["switchboard"],
      refetchInterval: SWITCHBOARD_POLL_MS,
    },
  });
  const { data: transferTargets } = useListTransferTargets();
  const markUrgent = useMarkLiveSessionUrgent();
  const endSession = useEndLiveSession();
  const transferSession = useTransferLiveSession();
  const addNote = useAddLiveSessionNote();
  const { toast } = useToast();

  const [transferOpen, setTransferOpen] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const entries = data?.entries ?? [];
  const liveSessions = data?.liveSessions ?? [];
  const totalLast24h = entries.reduce(
    (sum, e) => sum + (e.callsLast24h ?? 0),
    0,
  );
  const liveCount = liveSessions.length;

  const handleMarkUrgent = async (id: string) => {
    try {
      await markUrgent.mutateAsync({ id });
      toast({ title: "Marked urgent", description: "Caller flagged for ops." });
      refetch();
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    }
  };

  const handleEnd = async (id: string) => {
    if (!confirm("End this live session?")) return;
    try {
      await endSession.mutateAsync({ id });
      toast({ title: "Session ended" });
      refetch();
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    }
  };

  const submitTransfer = async () => {
    if (!transferOpen || !transferTargetId) return;
    try {
      await transferSession.mutateAsync({
        id: transferOpen,
        data: { targetId: transferTargetId },
      });
      toast({ title: "Transfer initiated" });
      setTransferOpen(null);
      setTransferTargetId("");
      refetch();
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    }
  };

  const submitNote = async () => {
    if (!noteOpen || !noteText.trim()) return;
    try {
      await addNote.mutateAsync({ id: noteOpen, data: { body: noteText.trim() } });
      toast({ title: "Note added" });
      setNoteOpen(null);
      setNoteText("");
      refetch();
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6" data-testid="page-switchboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Radio className="h-7 w-7 text-primary" />
            Switchboard
          </h1>
          <p className="text-muted-foreground">
            Live view across every channel · auto-refreshes every 4s · live AI
            receptionist sessions on top
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-switchboard"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Channels" value={entries.length} icon={Radio} />
        <StatCard label="Calls (24h)" value={totalLast24h} icon={PhoneCall} />
        <StatCard
          label="Live AI sessions"
          value={liveCount}
          icon={Headphones}
        />
      </div>

      {liveSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Live AI receptionist
            <Badge variant="outline" className="text-[10px]">
              {liveSessions.length} active
            </Badge>
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {liveSessions.map((s) => (
              <Card
                key={s.id}
                className="bg-card border-primary/30"
                data-testid={`live-session-${s.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Headphones className="h-4 w-4 text-primary" />
                        {s.callerPhone || "Unknown caller"}
                        {s.isDemo && (
                          <Badge variant="outline" className="text-[10px]">
                            demo
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {s.sessionStatus}
                        {s.currentStep ? ` · step: ${s.currentStep}` : ""}
                        {s.priority && s.priority !== "normal"
                          ? ` · ${s.priority}`
                          : ""}
                      </CardDescription>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(s.startedAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  {s.intent && (
                    <div>
                      <span className="text-muted-foreground">Intent:</span>{" "}
                      {s.intent}
                    </div>
                  )}
                  {s.escalationReason && (
                    <div className="text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {s.escalationReason}
                    </div>
                  )}
                  {s.transferTarget && (
                    <div>
                      <span className="text-muted-foreground">Transfer →</span>{" "}
                      {s.transferTarget}
                    </div>
                  )}
                  {s.collectedData &&
                    Object.keys(s.collectedData).length > 0 && (
                      <div className="rounded border border-border p-2">
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">
                          Collected
                        </div>
                        <div className="space-y-0.5">
                          {Object.entries(s.collectedData)
                            .slice(0, 6)
                            .map(([k, v]) => (
                              <div key={k}>
                                <span className="text-muted-foreground">
                                  {k}:
                                </span>{" "}
                                {String(v).slice(0, 80)}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  {s.transcriptLive && (
                    <details>
                      <summary className="text-[11px] text-muted-foreground cursor-pointer">
                        Transcript ({s.transcriptLive.length} chars)
                      </summary>
                      <pre className="text-[11px] whitespace-pre-wrap mt-1 max-h-40 overflow-y-auto bg-secondary rounded p-2">
                        {s.transcriptLive}
                      </pre>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleMarkUrgent(s.id)}
                      disabled={markUrgent.isPending}
                      data-testid={`button-urgent-${s.id}`}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" /> Urgent
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTransferOpen(s.id);
                        setTransferTargetId("");
                      }}
                      data-testid={`button-transfer-${s.id}`}
                    >
                      <ArrowRightLeft className="h-3 w-3 mr-1" /> Transfer
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNoteOpen(s.id);
                        setNoteText("");
                      }}
                      data-testid={`button-note-${s.id}`}
                    >
                      <StickyNote className="h-3 w-3 mr-1" /> Note
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEnd(s.id)}
                      disabled={endSession.isPending}
                      data-testid={`button-end-${s.id}`}
                    >
                      <PhoneOff className="h-3 w-3 mr-1" /> End
                    </Button>
                    {s.callRecordId && (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/calls/${s.callRecordId}`}>Detail</Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Activity className="h-6 w-6 animate-pulse mr-2" /> Tuning in…
        </div>
      ) : entries.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <PhoneOff className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No channels configured</h3>
            <p className="text-muted-foreground max-w-md">
              Create a channel or run the telephony setup wizard to start
              receiving calls.
            </p>
            <div className="flex gap-2 mt-4">
              <Button asChild variant="outline" size="sm">
                <Link href="/channels">Channels</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/setup/telephony">Setup wizard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {entries.map((entry) => (
            <Card
              key={entry.channel.id}
              className="bg-card"
              data-testid={`switchboard-channel-${entry.channel.id}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <PhoneIncoming className="h-4 w-4 text-primary" />
                      {entry.channel.name}
                      {entry.channel.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          default
                        </Badge>
                      )}
                      {!entry.channel.isActive && (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                        >
                          paused
                        </Badge>
                      )}
                      {entry.channel.liveBehavior &&
                        entry.channel.liveBehavior !== "record_only" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-primary/50 text-primary"
                          >
                            {entry.channel.liveBehavior.replace(/_/g, " ")}
                          </Badge>
                        )}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {entry.channel.type} ·{" "}
                      {entry.channel.phoneNumber || "no number"}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      {entry.callsLast24h}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      24h
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {entry.recentCalls.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic py-3">
                    No recent calls.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {entry.recentCalls.slice(0, 6).map((c) => (
                      <Link key={c.id} href={`/calls/${c.id}`}>
                        <div
                          className="flex items-center justify-between gap-3 p-2 rounded-md hover-elevate cursor-pointer text-sm"
                          data-testid={`switchboard-call-${c.id}`}
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate">
                              {c.customerName ||
                                c.callerPhone ||
                                "Unknown caller"}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(c.createdAt), {
                                addSuffix: true,
                              })}
                              {c.callType ? ` · ${c.callType}` : ""}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className={`${statusBadgeClass(toDisplayStatus(c.status))} text-[10px] shrink-0`}
                          >
                            {statusLabel(toDisplayStatus(c.status))}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data?.generatedAt && (
        <div className="text-xs text-muted-foreground text-right">
          Snapshot: {format(new Date(data.generatedAt), "PPpp")}
        </div>
      )}

      <Dialog
        open={transferOpen !== null}
        onOpenChange={(o) => !o && setTransferOpen(null)}
      >
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>Transfer live session</DialogTitle>
            <DialogDescription>
              Pick a target. The AI hand-off is logged and the caller will be
              dialed to the target on the next webhook turn (real Twilio) or
              recorded on the demo session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Transfer target</Label>
            <Select value={transferTargetId} onValueChange={setTransferTargetId}>
              <SelectTrigger data-testid="select-transfer-target">
                <SelectValue placeholder="Pick a target…" />
              </SelectTrigger>
              <SelectContent>
                {(transferTargets ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.type}
                    {t.phoneNumber ? ` · ${t.phoneNumber}` : ""})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitTransfer}
              disabled={!transferTargetId || transferSession.isPending}
              data-testid="button-confirm-transfer"
            >
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={noteOpen !== null}
        onOpenChange={(o) => !o && setNoteOpen(null)}
      >
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>Add internal note</DialogTitle>
            <DialogDescription>
              Visible to operators on this session. Not spoken to the caller.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="note-body">Note</Label>
            <Input
              id="note-body"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Returning customer, prefers callback after 5pm…"
              data-testid="input-note-body"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitNote}
              disabled={!noteText.trim() || addNote.isPending}
              data-testid="button-confirm-note"
            >
              Add note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="text-3xl font-bold">{value}</div>
        </div>
        <Icon className="h-8 w-8 text-primary opacity-60" />
      </CardContent>
    </Card>
  );
}
