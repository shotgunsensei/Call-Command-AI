import {
  useListTickets,
  useUpdateTicket,
  useDeleteTicket,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Ticket as TicketIcon, Trash2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

const STATUSES = ["open", "in_progress", "closed"];

function priorityVariant(p: string): "default" | "destructive" | "secondary" {
  if (p === "urgent" || p === "high") return "destructive";
  if (p === "low") return "secondary";
  return "default";
}

export default function TicketsPage() {
  const { data: tickets, isLoading, refetch } = useListTickets();
  const updateTicket = useUpdateTicket();
  const deleteTicket = useDeleteTicket();

  const handleStatus = async (id: string, status: string) => {
    await updateTicket.mutateAsync({ id, data: { status } });
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this ticket?")) return;
    await deleteTicket.mutateAsync({ id });
    refetch();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-tickets">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground">
          Support / issue tickets created automatically from analyzed calls.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Activity className="h-6 w-6 animate-pulse text-primary" />
        </div>
      ) : (tickets ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <TicketIcon className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No tickets yet</h3>
            <p className="text-muted-foreground max-w-md">
              When a call is analyzed and matches a "create ticket" rule, it
              will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tickets!.map((t) => (
            <Card
              key={t.id}
              className="bg-card"
              data-testid={`ticket-${t.id}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base truncate">
                      {t.title}
                    </CardTitle>
                    <CardDescription className="text-xs flex items-center gap-2 flex-wrap">
                      <Badge variant={priorityVariant(t.priority)} className="text-[10px]">
                        {t.priority}
                      </Badge>
                      <span>
                        {formatDistanceToNow(new Date(t.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {t.linkedCallId && (
                        <Link href={`/calls/${t.linkedCallId}`}>
                          <span className="text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">
                            view call <ExternalLink className="h-3 w-3" />
                          </span>
                        </Link>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={t.status}
                      onValueChange={(v) => handleStatus(t.id, v)}
                    >
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {t.description && (
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  {t.description}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
