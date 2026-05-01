import { useState } from "react";
import { 
  useGetCall, 
  useProcessCall, 
  useUpdateActionItem, 
  useSendCallWebhook,
  useListIntegrations,
  useDeleteCall,
  useGetMe,
  useSendFollowup,
  useRunRulesForCall,
  useGetFlowLogsForCall,
  useListChannels,
  useListTelephonyEvents,
  useRetryCallProcessing
} from "@workspace/api-client-react";
import { statusBadgeClass, statusLabel, toDisplayStatus } from "@/lib/callStatus";
import { useRoute, useLocation } from "wouter";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { 
  Clock, 
  Calendar,
  AlertTriangle,
  Download,
  Share,
  RefreshCw,
  Trash2,
  Phone,
  User,
  Building,
  Tag,
  MessageSquare,
  FileText,
  Send,
  Zap,
  GitBranch,
  CheckCircle2,
  XCircle,
  Radio
} from "lucide-react";
import { format } from "date-fns";

export default function CallDetail() {
  const [, params] = useRoute("/calls/:id");
  const id = params?.id || "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: call, isLoading, refetch } = useGetCall(id);
  const { data: me } = useGetMe();
  const { data: integrations } = useListIntegrations();
  const { data: flowLogs } = useGetFlowLogsForCall(id);
  const { data: channels } = useListChannels();
  const { data: telephonyEvents } = useListTelephonyEvents(
    { callId: id },
    {
      query: {
        // Poll while the call is still moving through the pipeline so the
        // operator sees Twilio status callbacks land in near-real-time.
        queryKey: ["telephony-events", id],
        refetchInterval: 5000,
      },
    },
  );
  const retryProcessing = useRetryCallProcessing();

  const processCall = useProcessCall();
  const updateActionItem = useUpdateActionItem();
  const sendWebhook = useSendCallWebhook();
  const deleteCall = useDeleteCall();
  const sendFollowup = useSendFollowup();
  const runRules = useRunRulesForCall();

  const [isProcessing, setIsProcessing] = useState(false);

  if (isLoading || !call) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Loading intelligence...</div>
      </div>
    );
  }

  const handleReprocess = async () => {
    try {
      setIsProcessing(true);
      // For Twilio-sourced calls we route through retry-processing so the
      // recording is re-downloaded with auth; everything else (uploaded
      // audio, simulator) goes through the original processCall path.
      if (call.provider === "twilio") {
        await retryProcessing.mutateAsync({ id });
      } else {
        await processCall.mutateAsync({ id });
      }
      toast({ title: "Analysis initiated", description: "Call is being reprocessed." });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this call record?")) return;
    try {
      await deleteCall.mutateAsync({ id });
      toast({ title: "Deleted", description: "Call record removed." });
      setLocation("/calls");
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleAction = async (itemId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "done" ? "open" : "done";
      await updateActionItem.mutateAsync({ 
        id: itemId, 
        data: { status: newStatus } 
      });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSendFollowup = async () => {
    try {
      await sendFollowup.mutateAsync({ id, data: {} });
      toast({
        title: "Follow-up logged",
        description: "Saved to follow-up history. Wire a webhook integration to deliver via email/SMS.",
      });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleRunRules = async () => {
    try {
      const res = await runRules.mutateAsync({ id });
      toast({
        title: "Rules evaluated",
        description: `${res?.rulesMatched ?? 0} matched · ${res?.actionsExecuted ?? 0} action(s) executed.`,
      });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSendWebhook = async (integrationId: string) => {
    try {
      const res = await sendWebhook.mutateAsync({ id, data: { integrationId } });
      if (res.ok) {
        toast({ title: "Sent", description: "Payload delivered successfully." });
      } else {
        toast({ title: "Failed", description: res.message || "Unknown error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const getPriorityColor = (p: string | null | undefined) => {
    if (p === 'high') return 'bg-destructive/20 text-destructive border-transparent';
    if (p === 'medium') return 'bg-yellow-500/20 text-yellow-500 border-transparent';
    return 'bg-secondary text-secondary-foreground border-transparent';
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {call.customerName || call.originalFilename}
          </h1>
          {(call.isDemo === "true" || me?.demoMode) && (
            <Badge variant="outline" className="border-primary text-primary">DEMO</Badge>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={handleReprocess} disabled={isProcessing || call.status === "processing"}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`} />
            Reprocess
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunRules}
            disabled={runRules.isPending || call.status !== "ready"}
            data-testid="button-run-rules"
          >
            <Zap className={`mr-2 h-4 w-4 ${runRules.isPending ? 'animate-pulse text-primary' : ''}`} />
            Run rules
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendFollowup}
            disabled={sendFollowup.isPending || !call.followUpMessage}
            data-testid="button-send-followup"
          >
            <Send className={`mr-2 h-4 w-4 ${sendFollowup.isPending ? 'animate-pulse text-primary' : ''}`} />
            Send follow-up
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/calls/${id}/pdf`} download>
              <Download className="mr-2 h-4 w-4" />
              PDF
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Share className="mr-2 h-4 w-4" />
                Send To...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {integrations?.length === 0 ? (
                <DropdownMenuItem disabled>No integrations configured</DropdownMenuItem>
              ) : (
                integrations?.filter(i => i.enabled).map(i => (
                  <DropdownMenuItem key={i.id} onClick={() => handleSendWebhook(i.id)}>
                    {i.name} ({i.type})
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status Banner — uses the shared mapper so Phase 2 telephony
          statuses (recording_ready, transcribing, analyzing, flow_running,
          completed, busy, no_answer, …) collapse into the right bucket. */}
      {(() => {
        const display = toDisplayStatus(call.status);
        if (display === "pending") {
          return (
            <div
              className="bg-blue-500/10 border border-blue-500/20 text-blue-400 p-4 rounded-lg flex items-center"
              data-testid="status-banner-pending"
            >
              <RefreshCw className="h-5 w-5 mr-3 animate-spin" />
              <span>{statusLabel(call.status)} — refreshing automatically.</span>
            </div>
          );
        }
        if (display === "error") {
          return (
            <div
              className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex items-center"
              data-testid="status-banner-error"
            >
              <AlertTriangle className="h-5 w-5 mr-3" />
              <span>
                {statusLabel(call.status)}
                {call.errorMessage ? `: ${call.errorMessage}` : ""}
              </span>
            </div>
          );
        }
        return null;
      })()}

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Status
        </span>
        <Badge
          variant="outline"
          className={statusBadgeClass(call.status)}
          data-testid="badge-call-status"
        >
          {statusLabel(call.status)}
        </Badge>
        {call.provider && (
          <Badge variant="outline" className="text-xs">
            via {call.provider}
          </Badge>
        )}
      </div>

      {/* Meta Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col justify-center">
            <span className="text-muted-foreground text-sm flex items-center mb-1">
              <Calendar className="h-3 w-3 mr-1" /> Recorded
            </span>
            <span className="font-medium">{format(new Date(call.createdAt), "PPp")}</span>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col justify-center">
            <span className="text-muted-foreground text-sm flex items-center mb-1">
              <Clock className="h-3 w-3 mr-1" /> Duration
            </span>
            <span className="font-medium">
              {call.durationSeconds ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : '--'}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col justify-center">
            <span className="text-muted-foreground text-sm flex items-center mb-1">
              <AlertTriangle className="h-3 w-3 mr-1" /> Priority
            </span>
            <span>
              {call.priority ? <Badge className={getPriorityColor(call.priority)}>{call.priority}</Badge> : '--'}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col justify-center">
            <span className="text-muted-foreground text-sm flex items-center mb-1">
              <MessageSquare className="h-3 w-3 mr-1" /> Sentiment
            </span>
            <span>
              {call.sentiment ? <Badge variant="outline" className="capitalize">{call.sentiment}</Badge> : '--'}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="h-5 w-5 mr-2 text-primary" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                {call.summary || "No summary available."}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader>
              <CardTitle>Key Points</CardTitle>
            </CardHeader>
            <CardContent>
              {call.keyPoints && call.keyPoints.length > 0 ? (
                <ul className="space-y-2">
                  {call.keyPoints.map((pt, i) => (
                    <li key={i} className="flex items-start">
                      <span className="text-primary mr-2 mt-1">•</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No key points extracted.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-secondary/30 p-4 rounded-md max-h-[400px] overflow-y-auto border border-border/50 text-sm whitespace-pre-wrap font-mono">
                {call.transcriptText || "No transcript available."}
              </div>
            </CardContent>
          </Card>

          {/* Telephony events timeline — populated by Twilio status,
              recording, and transcription webhooks. Empty for non-telephony
              calls (uploads, simulator). */}
          {(telephonyEvents?.length ?? 0) > 0 && (
            <Card className="bg-card" data-testid="card-telephony-events">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Radio className="h-5 w-5 mr-2 text-primary" />
                  Telephony Events
                </CardTitle>
                <CardDescription>
                  {telephonyEvents!.length} event(s) from{" "}
                  {call.provider ?? "provider"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {telephonyEvents!.map((ev, i) => (
                    <li
                      key={ev.id}
                      className="border border-border/60 rounded-md bg-secondary/30 p-3 text-xs"
                      data-testid={`telephony-event-${i}`}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {ev.provider}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {ev.eventType}
                        </Badge>
                        <span className="ml-auto text-muted-foreground">
                          {format(new Date(ev.createdAt), "PPpp")}
                        </span>
                      </div>
                      {ev.message && (
                        <div className="mt-1 text-muted-foreground">
                          {ev.message}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card" data-testid="card-flow-trace">
            <CardHeader>
              <CardTitle className="flex items-center">
                <GitBranch className="h-5 w-5 mr-2 text-primary" />
                Flow Execution Trace
              </CardTitle>
              <CardDescription>
                Channel:{" "}
                <span className="text-foreground">
                  {channels?.find((c) => c.id === call.channelId)?.name ??
                    "Unassigned"}
                </span>
                {(flowLogs?.length ?? 0) > 0 && (
                  <> · {flowLogs!.length} step(s) executed</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(flowLogs?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Radio className="h-4 w-4" />
                  No flow ran for this call. Bind a flow to this call's channel
                  on the Flows page, then reprocess.
                </p>
              ) : (
                <ol className="space-y-2">
                  {flowLogs!.map((log, i) => (
                    <li
                      key={log.id}
                      className="border border-border/60 rounded-md bg-secondary/30 p-3 text-xs space-y-1"
                      data-testid={`flow-log-${i}`}
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
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-primary/20 shadow-[0_0_15px_rgba(255,0,0,0.05)]">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-lg">Action Items</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {call.actionItems && call.actionItems.length > 0 ? (
                <div className="space-y-4">
                  {call.actionItems.map(item => (
                    <div key={item.id} className={`flex items-start space-x-3 p-3 rounded-lg border ${item.status === 'done' ? 'border-border/50 bg-secondary/20 opacity-60' : 'border-border bg-background'}`}>
                      <Checkbox 
                        checked={item.status === "done"} 
                        onCheckedChange={() => handleToggleAction(item.id, item.status)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <p className={`text-sm font-medium leading-none ${item.status === 'done' ? 'line-through' : ''}`}>
                          {item.title}
                        </p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        )}
                        <div className="flex gap-2 mt-2">
                          {item.priority === 'high' && <Badge variant="destructive" className="h-4 text-[10px] px-1 py-0">High</Badge>}
                          {item.dueDate && <span className="text-[10px] text-muted-foreground flex items-center"><Calendar className="h-3 w-3 mr-1"/> {format(new Date(item.dueDate), "MMM d")}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No action items identified.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-lg">Extracted Entities</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center"><User className="h-4 w-4 mr-2"/> Contact</span>
                <span className="font-medium text-right">{call.customerName || '--'}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center"><Building className="h-4 w-4 mr-2"/> Company</span>
                <span className="font-medium text-right">{call.companyName || '--'}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center"><Phone className="h-4 w-4 mr-2"/> Phone</span>
                <span className="font-medium text-right">{call.callerPhone || '--'}</span>
              </div>
              <Separator />
              <div className="space-y-2">
                <span className="text-muted-foreground flex items-center"><Tag className="h-4 w-4 mr-2"/> Tags</span>
                <div className="flex flex-wrap gap-1">
                  {call.suggestedTags && call.suggestedTags.length > 0 ? call.suggestedTags.map(t => (
                    <Badge key={t} variant="secondary" className="font-normal text-xs">{t}</Badge>
                  )) : <span className="text-xs">--</span>}
                </div>
              </div>
            </CardContent>
          </Card>

          {call.followUpMessage && (
            <Card className="bg-card">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-lg">Suggested Follow-up</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="bg-muted/50 p-3 rounded text-sm italic border border-border">
                  "{call.followUpMessage}"
                </div>
                <Button variant="outline" size="sm" className="w-full mt-3" onClick={() => {
                  navigator.clipboard.writeText(call.followUpMessage || "");
                  toast({ title: "Copied to clipboard" });
                }}>Copy Message</Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
