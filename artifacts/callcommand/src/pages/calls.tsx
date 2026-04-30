import { useState } from "react";
import { useListCalls, useGetMe } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Search, 
  Phone, 
  Clock, 
  Calendar,
  AlertTriangle,
  Upload,
  ArrowRight
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

export default function Calls() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  
  const { data: me } = useGetMe();
  const { data: calls, isLoading } = useListCalls({
    q: debouncedQ || undefined,
    status: status !== "all" ? status : undefined,
    priority: priority !== "all" ? priority : undefined
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedQ(q);
  };

  const getPriorityColor = (p: string | null | undefined) => {
    if (p === 'high') return 'bg-destructive/20 text-destructive border-transparent';
    if (p === 'medium') return 'bg-yellow-500/20 text-yellow-500 border-transparent';
    return 'bg-secondary text-secondary-foreground border-transparent';
  };

  const getSentimentColor = (s: string | null | undefined) => {
    if (s === 'negative') return 'border-red-500/30 text-red-500';
    if (s === 'positive') return 'border-green-500/30 text-green-500';
    return 'border-border text-muted-foreground';
  };

  const getStatusColor = (s: string) => {
    if (s === 'completed') return 'bg-green-500/20 text-green-500 border-transparent';
    if (s === 'processing') return 'bg-blue-500/20 text-blue-500 border-transparent';
    if (s === 'failed') return 'bg-destructive/20 text-destructive border-transparent';
    return 'bg-secondary text-secondary-foreground border-transparent';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Call Records</h1>
          <p className="text-muted-foreground">Search and analyze past transmissions.</p>
        </div>
        <Link href="/calls/new">
          <Button>
            <Upload className="mr-2 h-4 w-4" />
            Upload Call
          </Button>
        </Link>
      </div>

      <Card className="bg-card">
        <CardContent className="p-4">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search transcripts, companies, phone numbers..."
                className="pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="flex gap-4">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" variant="secondary">Filter</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Scanning records...</div>
        ) : calls?.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-xl border border-border">
            <Phone className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No records found</h3>
            <p className="text-muted-foreground mb-4">No calls match your current filters.</p>
            <Link href="/calls/new">
              <Button variant="outline">Upload your first call</Button>
            </Link>
          </div>
        ) : (
          calls?.map((call) => (
            <Link key={call.id} href={`/calls/${call.id}`}>
              <Card className="bg-card hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-lg flex items-center gap-2 group-hover:text-primary transition-colors">
                          {call.customerName || call.originalFilename}
                          {(call.isDemo === "true" || me?.demoMode) && (
                            <Badge variant="outline" className="ml-2 text-xs py-0 h-5 text-primary border-primary">DEMO</Badge>
                          )}
                        </h3>
                        <Badge className={getStatusColor(call.status)}>
                          {call.status}
                        </Badge>
                        {call.priority && (
                          <Badge className={getPriorityColor(call.priority)}>
                            {call.priority} Priority
                          </Badge>
                        )}
                        {call.sentiment && (
                          <Badge variant="outline" className={getSentimentColor(call.sentiment)}>
                            {call.sentiment}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                        {call.companyName && (
                          <span className="flex items-center">
                            <ArrowRight className="mr-1 h-3 w-3" /> {call.companyName}
                          </span>
                        )}
                        {call.callerPhone && (
                          <span className="flex items-center">
                            <Phone className="mr-1 h-3 w-3" /> {call.callerPhone}
                          </span>
                        )}
                        <span className="flex items-center">
                          <Calendar className="mr-1 h-3 w-3" /> {format(new Date(call.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                        {call.durationSeconds && (
                          <span className="flex items-center">
                            <Clock className="mr-1 h-3 w-3" /> {Math.floor(call.durationSeconds / 60)}:{(call.durationSeconds % 60).toString().padStart(2, '0')}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="flex -space-x-2">
                        {call.suggestedTags?.slice(0, 3).map((tag, i) => (
                          <div key={i} className="inline-flex h-8 items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold z-10 transition-transform hover:z-20 hover:-translate-y-1">
                            {tag}
                          </div>
                        ))}
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                  
                  {call.summary && (
                    <div className="mt-4 pt-4 border-t border-border/50 text-sm text-muted-foreground line-clamp-2">
                      <span className="font-medium text-foreground mr-2">Summary:</span>
                      {call.summary}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
