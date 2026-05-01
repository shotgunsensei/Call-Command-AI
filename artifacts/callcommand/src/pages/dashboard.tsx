import {
  useGetDashboardStats,
  useGetMe,
  useSimulateInboundCall,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  CheckCircle,
  AlertTriangle,
  Activity,
  ArrowRight,
  Play,
  Ticket as TicketIcon,
  UserPlus,
  ListTodo,
  HeartCrack,
  Sparkles,
  Radio,
  PhoneOff,
  AlertOctagon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, refetch } =
    useGetDashboardStats();
  const { data: me } = useGetMe();
  const simulate = useSimulateInboundCall();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  if (statsLoading || !stats) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Activity className="h-8 w-8 text-primary animate-pulse" />
      </div>
    );
  }

  const sentimentData = stats.sentimentBreakdown.map((s) => ({
    name: s.sentiment || "Unknown",
    count: s.count,
  }));

  const funnel = stats.conversionFunnel ?? {
    calls: 0,
    leads: 0,
    closedLeads: 0,
  };
  const conversionPct =
    funnel.calls > 0 ? Math.round((funnel.leads / funnel.calls) * 100) : 0;
  const closeRatePct =
    funnel.leads > 0
      ? Math.round((funnel.closedLeads / funnel.leads) * 100)
      : 0;

  const handleSimulate = async () => {
    try {
      const call = await simulate.mutateAsync();
      toast({
        title: "Inbound call simulated",
        description: "Routed through analysis + automation rules.",
      });
      refetch();
      setLocation(`/calls/${call.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Simulation failed", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Real-time view of calls, automation outcomes, and follow-ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {me?.demoMode && (
            <Badge variant="outline" className="border-primary text-primary">
              DEMO MODE
            </Badge>
          )}
          <Button
            variant="outline"
            onClick={handleSimulate}
            disabled={simulate.isPending}
            data-testid="button-simulate-call"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {simulate.isPending ? "Simulating..." : "Simulate inbound call"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Calls"
          value={stats.totalCalls}
          icon={<Phone className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Calls This Month"
          value={stats.callsThisMonth}
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Open Action Items"
          value={stats.openActionItems}
          icon={<CheckCircle className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="High Priority"
          value={stats.highPriorityCalls}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open Tickets"
          value={stats.openTickets ?? 0}
          icon={<TicketIcon className="h-4 w-4 text-muted-foreground" />}
          href="/tickets"
        />
        <StatCard
          label="New Leads (7d)"
          value={stats.newLeadsThisWeek ?? 0}
          icon={<UserPlus className="h-4 w-4 text-muted-foreground" />}
          href="/leads"
        />
        <StatCard
          label="Open Tasks"
          value={stats.openTasks ?? 0}
          icon={<ListTodo className="h-4 w-4 text-muted-foreground" />}
          href="/tasks"
        />
        <StatCard
          label="Angry Sentiment"
          value={stats.angrySentimentAlerts ?? 0}
          icon={<HeartCrack className="h-4 w-4 text-destructive" />}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Channels"
          value={stats.activeChannels ?? 0}
          icon={<Radio className="h-4 w-4 text-muted-foreground" />}
          href="/channels"
        />
        <StatCard
          label="Missed / Errored"
          value={stats.missedCalls ?? 0}
          icon={<PhoneOff className="h-4 w-4 text-destructive" />}
        />
        <StatCard
          label="Escalations (30d)"
          value={stats.escalations ?? 0}
          icon={<AlertOctagon className="h-4 w-4 text-yellow-500" />}
          href="/flows"
        />
        <StatCard
          label="Total Calls"
          value={stats.totalCalls}
          icon={<Phone className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {(stats.callsByChannel?.length ?? 0) > 0 && (
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-primary" /> Calls by channel
            </CardTitle>
            <CardDescription>
              Volume per inbound line. Bind a flow to a channel from the Flows
              page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.callsByChannel!.map((c) => {
                const max = Math.max(
                  ...stats.callsByChannel!.map((x) => x.count),
                );
                const pct = max > 0 ? Math.round((c.count / max) * 100) : 0;
                return (
                  <div key={c.channelId ?? "unassigned"} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground">
                        {c.count} call(s)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Conversion Funnel (this month)</CardTitle>
          <CardDescription>Calls → Leads → Closed leads</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <FunnelStep label="Calls" value={funnel.calls} pct={100} />
            <FunnelStep label="Leads" value={funnel.leads} pct={conversionPct} />
            <FunnelStep
              label="Closed"
              value={funnel.closedLeads}
              pct={closeRatePct}
              note="of leads"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card">
          <CardHeader>
            <CardTitle>Recent Transmissions</CardTitle>
            <CardDescription>Latest processed call data.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentCalls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg border border-border/50"
                >
                  <div className="flex items-center space-x-4">
                    <div className="bg-background border border-border p-2 rounded-full">
                      <Play className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none mb-1">
                        {call.customerName || call.originalFilename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(call.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {call.priority === "high" && (
                      <Badge
                        variant="destructive"
                        className="bg-destructive/20 text-destructive border-transparent hover:bg-destructive/30"
                      >
                        High Priority
                      </Badge>
                    )}
                    {call.sentiment === "negative" && (
                      <Badge
                        variant="outline"
                        className="border-red-500/30 text-red-500"
                      >
                        Negative
                      </Badge>
                    )}
                    <Link href={`/calls/${call.id}`}>
                      <Button variant="ghost" size="sm" className="ml-2">
                        View <ArrowRight className="ml-1 h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
              {stats.recentCalls.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No recent calls found.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3 bg-card">
          <CardHeader>
            <CardTitle>Sentiment Radar</CardTitle>
            <CardDescription>Breakdown of caller sentiment.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sentimentData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#333"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    stroke="#888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    contentStyle={{
                      backgroundColor: "#0f0f12",
                      borderColor: "#1c1c20",
                      color: "#fff",
                    }}
                    itemStyle={{ color: "#fff" }}
                  />
                  <Bar
                    dataKey="count"
                    fill="hsl(0, 84%, 50%)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-sm font-medium mb-3">Top Tags</h4>
              <div className="flex flex-wrap gap-2">
                {stats.topTags.map((tag) => (
                  <Badge
                    key={tag.tag}
                    variant="secondary"
                    className="text-xs px-2 py-0.5"
                  >
                    {tag.tag} ({tag.count})
                  </Badge>
                ))}
                {stats.topTags.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No tags detected yet.
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <Card
      className={`bg-card ${href ? "hover:border-primary/50 cursor-pointer transition-colors" : ""}`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function FunnelStep({
  label,
  value,
  pct,
  note,
}: {
  label: string;
  value: number;
  pct: number;
  note?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-3xl font-bold">{value}</div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {pct}% {note ?? ""}
      </div>
    </div>
  );
}
