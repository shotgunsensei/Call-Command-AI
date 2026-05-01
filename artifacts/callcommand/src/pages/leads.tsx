import {
  useListLeads,
  useUpdateLead,
  useDeleteLead,
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
import { Activity, UserPlus, Trash2, ExternalLink, Phone, Building } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

const STATUSES = ["new", "qualified", "contacted", "closed", "lost"];

export default function LeadsPage() {
  const { data: leads, isLoading, refetch } = useListLeads();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();

  const handleStatus = async (id: string, status: string) => {
    await updateLead.mutateAsync({ id, data: { status } });
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    await deleteLead.mutateAsync({ id });
    refetch();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-leads">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Sales prospects identified by automation rules.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Activity className="h-6 w-6 animate-pulse text-primary" />
        </div>
      ) : (leads ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <UserPlus className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No leads captured</h3>
            <p className="text-muted-foreground max-w-md">
              Sales calls matching your "create lead" rules will land here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {leads!.map((l) => (
            <Card key={l.id} className="bg-card" data-testid={`lead-${l.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base truncate">{l.name}</CardTitle>
                    <CardDescription className="text-xs flex items-center gap-3 flex-wrap">
                      {l.company && (
                        <span className="inline-flex items-center gap-1">
                          <Building className="h-3 w-3" /> {l.company}
                        </span>
                      )}
                      {l.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {l.phone}
                        </span>
                      )}
                      <span>
                        {formatDistanceToNow(new Date(l.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {l.linkedCallId && (
                        <Link href={`/calls/${l.linkedCallId}`}>
                          <span className="text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">
                            view call <ExternalLink className="h-3 w-3" />
                          </span>
                        </Link>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={l.status}
                      onValueChange={(v) => handleStatus(l.id, v)}
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
                      onClick={() => handleDelete(l.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {l.intent && (
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    {l.intent}
                  </Badge>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
