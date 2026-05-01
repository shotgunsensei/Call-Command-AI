import { useGetSwitchboard } from "@workspace/api-client-react";
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
import {
  Activity,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Radio,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  statusBadgeClass,
  statusLabel,
  toDisplayStatus,
} from "@/lib/callStatus";

// Polled live view of every channel and its last-24h call traffic. The
// 7-second refetch is intentionally aggressive — this page is meant to
// sit on a wallboard or second monitor.
const SWITCHBOARD_POLL_MS = 7_000;

export default function SwitchboardPage() {
  const { data, isLoading, refetch, isFetching } = useGetSwitchboard({
    query: {
      queryKey: ["switchboard"],
      refetchInterval: SWITCHBOARD_POLL_MS,
    },
  });

  const entries = data?.entries ?? [];
  const totalLast24h = entries.reduce(
    (sum, e) => sum + (e.callsLast24h ?? 0),
    0,
  );
  const liveCount = entries.reduce(
    (sum, e) =>
      sum +
      (e.recentCalls ?? []).filter(
        (c) => toDisplayStatus(c.status) === "pending",
      ).length,
    0,
  );

  return (
    <div className="space-y-6" data-testid="page-switchboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Radio className="h-7 w-7 text-primary" />
            Switchboard
          </h1>
          <p className="text-muted-foreground">
            Live view across every channel · auto-refreshes every 7s · last 24h
            of calls
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
        <StatCard
          label="Calls (24h)"
          value={totalLast24h}
          icon={PhoneCall}
        />
        <StatCard label="Live / pending" value={liveCount} icon={Activity} />
      </div>

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
                            className={`${statusBadgeClass(c.status)} text-[10px] shrink-0`}
                          >
                            {statusLabel(c.status)}
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
