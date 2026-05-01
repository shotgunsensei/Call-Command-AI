import {
  useListTasks,
  useUpdateTask,
  useDeleteTask,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, ListTodo, Trash2, ExternalLink, Calendar } from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";

const STATUSES = ["open", "in_progress", "done"];

export default function TasksPage() {
  const { data: tasks, isLoading, refetch } = useListTasks();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const handleStatus = async (id: string, status: string) => {
    await updateTask.mutateAsync({ id, data: { status } });
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this task?")) return;
    await deleteTask.mutateAsync({ id });
    refetch();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="page-tasks">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">
          Follow-up tasks generated from your calls.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Activity className="h-6 w-6 animate-pulse text-primary" />
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <ListTodo className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No tasks open</h3>
            <p className="text-muted-foreground max-w-md">
              Scheduling and follow-up calls matching your rules create tasks
              here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tasks!.map((t) => {
            const overdue =
              t.dueDate && t.status !== "done"
                ? new Date(t.dueDate) < new Date()
                : false;
            return (
              <Card
                key={t.id}
                className={`bg-card ${t.status === "done" ? "opacity-60" : ""}`}
                data-testid={`task-${t.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <CardTitle className="text-base truncate">
                        {t.title}
                      </CardTitle>
                      <CardDescription className="text-xs flex items-center gap-3 flex-wrap">
                        {t.dueDate && (
                          <span
                            className={`inline-flex items-center gap-1 ${overdue ? "text-destructive" : ""}`}
                          >
                            <Calendar className="h-3 w-3" />
                            due {format(new Date(t.dueDate), "PP")}
                          </span>
                        )}
                        <span>
                          created{" "}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
