import { useGetDashboardStats, useGetMe } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, CheckCircle, AlertTriangle, Activity, ArrowRight, Play } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: me } = useGetMe();

  if (statsLoading || !stats) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Activity className="h-8 w-8 text-primary animate-pulse" />
      </div>
    );
  }

  const sentimentData = stats.sentimentBreakdown.map(s => ({
    name: s.sentiment || 'Unknown',
    count: s.count
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">System overview and recent activity.</p>
        </div>
        {me?.demoMode && (
          <Badge variant="outline" className="border-primary text-primary">DEMO MODE</Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCalls}</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Calls This Month</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.callsThisMonth}</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Action Items</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.openActionItems}</div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Priority</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.highPriorityCalls}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card">
          <CardHeader>
            <CardTitle>Recent Transmissions</CardTitle>
            <CardDescription>Latest processed call data.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentCalls.map(call => (
                <div key={call.id} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg border border-border/50">
                  <div className="flex items-center space-x-4">
                    <div className="bg-background border border-border p-2 rounded-full">
                      <Play className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none mb-1">
                        {call.customerName || call.originalFilename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(call.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {call.priority === 'high' && <Badge variant="destructive" className="bg-destructive/20 text-destructive border-transparent hover:bg-destructive/30">High Priority</Badge>}
                    {call.sentiment === 'negative' && <Badge variant="outline" className="border-red-500/30 text-red-500">Negative</Badge>}
                    <Link href={`/calls/${call.id}`}>
                      <Button variant="ghost" size="sm" className="ml-2">
                        View <ArrowRight className="ml-1 h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
              {stats.recentCalls.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">No recent calls found.</div>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="name" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{ backgroundColor: '#0f0f12', borderColor: '#1c1c20', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="count" fill="hsl(0, 84%, 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-sm font-medium mb-3">Top Tags</h4>
              <div className="flex flex-wrap gap-2">
                {stats.topTags.map(tag => (
                  <Badge key={tag.tag} variant="secondary" className="text-xs px-2 py-0.5">
                    {tag.tag} ({tag.count})
                  </Badge>
                ))}
                {stats.topTags.length === 0 && (
                  <span className="text-xs text-muted-foreground">No tags detected yet.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}