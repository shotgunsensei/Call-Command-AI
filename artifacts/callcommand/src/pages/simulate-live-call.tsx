import { useState } from "react";
import {
  useListChannels,
  useListReceptionistProfiles,
  useStartSimulatedLiveCall,
  useSimulateLiveCallSay,
  useEndSimulatedLiveCall,
  type LiveCallSession,
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Bot,
  PhoneCall,
  PhoneOff,
  Sparkles,
  User,
} from "lucide-react";

const ANY = "__any__";

interface Turn {
  who: "caller" | "ai";
  text: string;
  decision?: unknown;
}

export default function SimulateLiveCallPage() {
  const { data: channels } = useListChannels();
  const { data: profiles } = useListReceptionistProfiles();
  const start = useStartSimulatedLiveCall();
  const say = useSimulateLiveCallSay();
  const end = useEndSimulatedLiveCall();
  const { toast } = useToast();

  const [channelId, setChannelId] = useState<string>(ANY);
  const [profileId, setProfileId] = useState<string>(ANY);
  const [callerPhone, setCallerPhone] = useState("+15555550123");
  const [customerName, setCustomerName] = useState("Maria Rodriguez");
  const [text, setText] = useState("");
  const [session, setSession] = useState<LiveCallSession | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  const handleStart = async () => {
    try {
      const created = await start.mutateAsync({
        data: {
          channelId: channelId === ANY ? null : channelId,
          receptionistProfileId: profileId === ANY ? null : profileId,
          callerPhone: callerPhone || null,
          customerName: customerName || null,
        },
      });
      setSession(created);
      const greet = (created.transcriptLive ?? "")
        .split("\n")
        .filter((l) => l.startsWith("AI:"))
        .pop();
      setTurns(
        greet
          ? [{ who: "ai", text: greet.replace(/^AI:\s*/, "") }]
          : [],
      );
      toast({
        title: "Simulated call started",
        description: created.isDemo === "true" ? "Demo session" : "Live session",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleSay = async () => {
    if (!session || !text.trim()) return;
    const utterance = text.trim();
    setTurns((prev) => [...prev, { who: "caller", text: utterance }]);
    setText("");
    try {
      const turn = await say.mutateAsync({
        id: session.id,
        data: { text: utterance },
      });
      setSession(turn.session);
      const lastAi = (turn.session.transcriptLive ?? "")
        .split("\n")
        .filter((l) => l.startsWith("AI:"))
        .pop();
      if (lastAi) {
        setTurns((prev) => [
          ...prev,
          {
            who: "ai",
            text: lastAi.replace(/^AI:\s*/, ""),
            decision: turn.decision,
          },
        ]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleEnd = async () => {
    if (!session) return;
    try {
      const ended = await end.mutateAsync({ id: session.id });
      setSession(ended);
      toast({ title: "Call ended", description: ended.sessionStatus });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const reset = () => {
    setSession(null);
    setTurns([]);
  };

  const completed =
    session?.sessionStatus === "completed" ||
    session?.sessionStatus === "transferring" ||
    session?.sessionStatus === "voicemail";

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-simulate-live-call">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-primary" />
          Live receptionist simulator
        </h1>
        <p className="text-muted-foreground">
          Have a multi-turn conversation with the AI receptionist without
          burning real Twilio minutes. Sessions are flagged{" "}
          <code>isDemo</code> so they don't pollute production analytics.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">Setup</CardTitle>
            <CardDescription>
              Pick the channel + receptionist profile to test, or leave on
              defaults.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Default channel</SelectItem>
                  {(channels ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Receptionist profile</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Default profile</SelectItem>
                  {(profiles ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sim-name">Caller name</Label>
                <Input
                  id="sim-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sim-phone">Caller phone</Label>
                <Input
                  id="sim-phone"
                  value={callerPhone}
                  onChange={(e) => setCallerPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleStart}
                disabled={start.isPending || !!session}
                data-testid="button-start-call"
              >
                <PhoneCall className="mr-2 h-4 w-4" /> Start call
              </Button>
              {session && !completed && (
                <Button
                  variant="outline"
                  onClick={handleEnd}
                  disabled={end.isPending}
                  data-testid="button-end-call"
                >
                  <PhoneOff className="mr-2 h-4 w-4" /> End
                </Button>
              )}
              {session && (
                <Button variant="ghost" onClick={reset}>
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">Live state</CardTitle>
            <CardDescription>
              Server-side decision after each caller turn.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            {!session ? (
              <div className="text-muted-foreground italic">
                No session yet.
              </div>
            ) : (
              <div className="space-y-1">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant="outline">{session.sessionStatus}</Badge>{" "}
                  {session.currentStep && (
                    <Badge variant="outline" className="text-[10px]">
                      step: {session.currentStep}
                    </Badge>
                  )}
                </div>
                {session.intent && (
                  <div>
                    <span className="text-muted-foreground">Intent:</span>{" "}
                    {session.intent}
                  </div>
                )}
                {session.priority && (
                  <div>
                    <span className="text-muted-foreground">Priority:</span>{" "}
                    {session.priority}
                  </div>
                )}
                {session.sentiment && (
                  <div>
                    <span className="text-muted-foreground">Sentiment:</span>{" "}
                    {session.sentiment}
                  </div>
                )}
                {session.transferTarget && (
                  <div>
                    <span className="text-muted-foreground">Transfer →</span>{" "}
                    {session.transferTarget}
                  </div>
                )}
                {session.escalationReason && (
                  <div className="text-destructive">
                    {session.escalationReason}
                  </div>
                )}
                {session.collectedData &&
                  Object.keys(session.collectedData).length > 0 && (
                    <div className="rounded border border-border p-2 mt-2">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">
                        Collected
                      </div>
                      <pre className="text-[11px] whitespace-pre-wrap">
                        {JSON.stringify(session.collectedData, null, 2)}
                      </pre>
                    </div>
                  )}
                {session.aiSummaryLive && (
                  <div className="rounded border border-border p-2 mt-2">
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">
                      Live summary
                    </div>
                    <div>{session.aiSummaryLive}</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {turns.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              Start the call to begin.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {turns.map((t, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2 ${t.who === "caller" ? "justify-end" : ""}`}
                >
                  {t.who === "ai" && (
                    <Bot className="h-5 w-5 text-primary shrink-0 mt-1" />
                  )}
                  <div
                    className={`max-w-[75%] rounded-md px-3 py-2 text-sm ${
                      t.who === "caller"
                        ? "bg-primary/10 border border-primary/30"
                        : "bg-secondary"
                    }`}
                  >
                    {t.text}
                  </div>
                  {t.who === "caller" && (
                    <User className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                  )}
                </div>
              ))}
            </div>
          )}

          {session && !completed && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSay();
              }}
              className="flex gap-2 pt-2 border-t border-border"
            >
              <Input
                placeholder="Type the caller's next utterance…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={say.isPending}
                data-testid="input-utterance"
              />
              <Button
                type="submit"
                disabled={say.isPending || !text.trim()}
                data-testid="button-say"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
