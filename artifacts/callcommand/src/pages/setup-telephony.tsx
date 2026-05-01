import { useState } from "react";
import {
  useGetSetupState,
  useListProductModes,
  useApplyProductMode,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  PhoneIncoming,
  Sparkles,
  Workflow,
} from "lucide-react";

const MODE_BLURB: Record<string, string> = {
  msp: "IT/MSP support intake — ticket-first.",
  sales: "Inbound sales — lead-first.",
  field_service: "Dispatch + job scheduling.",
  medical:
    "Medical / dental office intake — administrative only, never diagnostic.",
  general: "Neutral starter for any inbound call workflow.",
};

export default function SetupTelephonyPage() {
  const { toast } = useToast();
  const { data: state, isLoading: loadingState, refetch: refetchState } =
    useGetSetupState();
  const { data: modes, isLoading: loadingModes } = useListProductModes();
  const applyMode = useApplyProductMode();

  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const handleApply = async (modeId: string) => {
    try {
      const res = await applyMode.mutateAsync({ data: { modeId } });
      toast({
        title: "Mode applied",
        description: `Created ${res.channelsCreated} channel(s), ${res.flowsCreated} flow(s), ${res.rulesCreated} rule(s).`,
      });
      setSelectedMode(modeId);
      refetchState();
      setStep(2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const copy = (val: string) => {
    navigator.clipboard.writeText(val);
    toast({ title: "Copied", description: val });
  };

  if (loadingState || loadingModes) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Loading setup…
      </div>
    );
  }

  return (
    <div
      className="space-y-6 max-w-4xl mx-auto"
      data-testid="page-setup-telephony"
    >
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Telephony setup
        </h1>
        <p className="text-muted-foreground">
          Pick a product mode, wire up your provider, and verify your first
          live call.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <StepDot active={step >= 1} done={step > 1} label="1 · Product mode" />
        <Separator className="flex-1" />
        <StepDot
          active={step >= 2}
          done={step > 2}
          label="2 · Wire your provider"
        />
        <Separator className="flex-1" />
        <StepDot active={step >= 3} done={false} label="3 · Verify" />
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Pick a product mode
              </CardTitle>
              <CardDescription>
                Each mode seeds default channels, flows, and rules. Re-applying
                is safe — only empty slots are filled.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(modes ?? []).map((mode) => {
                const isCurrent = state?.productMode === mode.id;
                return (
                  <Card
                    key={mode.id}
                    className={`bg-background border-border ${
                      isCurrent ? "ring-1 ring-primary" : ""
                    }`}
                    data-testid={`mode-${mode.id}`}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        {mode.label}
                        {isCurrent && (
                          <Badge variant="secondary" className="text-xs">
                            current
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {MODE_BLURB[mode.id] ?? mode.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground space-y-2">
                      <div>
                        Default lines: {mode.defaultChannels.length}
                      </div>
                      <Button
                        size="sm"
                        variant={isCurrent ? "outline" : "default"}
                        disabled={applyMode.isPending}
                        onClick={() => handleApply(mode.id)}
                        data-testid={`button-apply-${mode.id}`}
                      >
                        {isCurrent ? "Re-seed defaults" : "Apply mode"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              onClick={() => setStep(2)}
              data-testid="button-skip-mode"
            >
              Skip — I'll configure manually →
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PhoneIncoming className="h-5 w-5 text-primary" />
              Wire your provider
            </CardTitle>
            <CardDescription>
              CallCommand currently ships with first-class Twilio support. SIP,
              Asterisk, and FreePBX adapters are scaffolded for future
              releases.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">Twilio status:</span>
              {state?.twilio.configured ? (
                <Badge className="bg-green-500/15 text-green-400 border-green-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-400">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Not configured
                </Badge>
              )}
            </div>

            {!state?.twilio.configured && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 text-xs">
                Set <code>TWILIO_ACCOUNT_SID</code> and{" "}
                <code>TWILIO_AUTH_TOKEN</code> as environment secrets to enable
                signature validation and recording downloads. Until then,
                CallCommand will reject inbound webhooks.
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Webhook URLs (paste into Twilio console → Phone Numbers → your
                line)
              </div>
              {(
                [
                  ["Voice URL (Incoming)", state?.twilio.webhooks.incoming],
                  ["Status callback", state?.twilio.webhooks.status],
                  ["Recording callback", state?.twilio.webhooks.recording],
                  [
                    "Transcription callback (optional)",
                    state?.twilio.webhooks.transcription,
                  ],
                ] as const
              ).map(([label, url]) => (
                <div
                  key={label}
                  className="flex items-center gap-2 bg-background border border-border rounded-md p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </div>
                    <code className="text-xs break-all">{url ?? "—"}</code>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => url && copy(url)}
                    disabled={!url}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">
                Recording consent
              </div>
              <p>
                If you enable recording, CallCommand will play a configurable
                consent message before connecting. Update each channel's
                consent text under Channels → edit. You are responsible for
                complying with local recording-consent law.
              </p>
            </div>
          </CardContent>
          <CardContent className="flex justify-between pt-0">
            <Button variant="outline" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <Button onClick={() => setStep(3)}>Next →</Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-primary" />
              Verify
            </CardTitle>
            <CardDescription>
              Place a test call to your Twilio number, then watch it land on
              the switchboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ChecklistRow
              done={!!state?.productMode || !!selectedMode}
              label="Product mode chosen"
            />
            <ChecklistRow
              done={!!state?.twilio.configured}
              label="Twilio credentials present"
            />
            <ChecklistRow
              done={(state?.channelCount ?? 0) > 0}
              label={`At least one channel configured (${state?.channelCount ?? 0})`}
            />
            <ChecklistRow
              done={(state?.flowCount ?? 0) > 0}
              label={`At least one call flow defined (${state?.flowCount ?? 0})`}
            />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/switchboard">Open Switchboard</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/channels">Edit channels</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/flows">Edit flows</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-md ${
        active
          ? done
            ? "bg-green-500/15 text-green-400"
            : "bg-primary/15 text-primary"
          : "text-muted-foreground"
      }`}
    >
      {done ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <span
          className={`h-2 w-2 rounded-full ${
            active ? "bg-current" : "bg-muted-foreground/40"
          }`}
        />
      )}
      <span>{label}</span>
    </div>
  );
}

function ChecklistRow({ done, label }: { done: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-2 ${
        done ? "text-green-400" : "text-muted-foreground"
      }`}
    >
      {done ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <span className="h-2 w-2 rounded-full border border-current" />
      )}
      <span>{label}</span>
    </div>
  );
}
