import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  actionItemsTable,
  ticketsTable,
  leadsTable,
  tasksTable,
} from "@workspace/db";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get(
  "/stats/dashboard",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);

    const [{ totalCalls } = { totalCalls: 0 }] = await db
      .select({ totalCalls: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(eq(callRecordsTable.userId, userId));

    const [{ callsThisMonth } = { callsThisMonth: 0 }] = await db
      .select({ callsThisMonth: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          gte(callRecordsTable.createdAt, monthStart),
        ),
      );

    const [{ openActionItems } = { openActionItems: 0 }] = await db
      .select({ openActionItems: sql<number>`count(*)::int` })
      .from(actionItemsTable)
      .innerJoin(
        callRecordsTable,
        eq(actionItemsTable.callRecordId, callRecordsTable.id),
      )
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          ne(actionItemsTable.status, "done"),
        ),
      );

    const [{ highPriorityCalls } = { highPriorityCalls: 0 }] = await db
      .select({ highPriorityCalls: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          sql`${callRecordsTable.priority} IN ('high','urgent')`,
        ),
      );

    const [{ openTickets } = { openTickets: 0 }] = await db
      .select({ openTickets: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.userId, userId),
          ne(ticketsTable.status, "closed"),
        ),
      );

    const [{ newLeadsThisWeek } = { newLeadsThisWeek: 0 }] = await db
      .select({ newLeadsThisWeek: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.userId, userId),
          gte(leadsTable.createdAt, weekStart),
        ),
      );

    const [{ openTasks } = { openTasks: 0 }] = await db
      .select({ openTasks: sql<number>`count(*)::int` })
      .from(tasksTable)
      .where(
        and(eq(tasksTable.userId, userId), ne(tasksTable.status, "done")),
      );

    const [{ angrySentimentAlerts } = { angrySentimentAlerts: 0 }] = await db
      .select({ angrySentimentAlerts: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          sql`${callRecordsTable.sentiment} IN ('negative','mixed')`,
        ),
      );

    // Conversion funnel: calls (this month) → leads (this month) → closed leads (this month)
    const [{ funnelCalls } = { funnelCalls: 0 }] = await db
      .select({ funnelCalls: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          gte(callRecordsTable.createdAt, monthStart),
        ),
      );
    const [{ funnelLeads } = { funnelLeads: 0 }] = await db
      .select({ funnelLeads: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.userId, userId),
          gte(leadsTable.createdAt, monthStart),
        ),
      );
    const [{ funnelClosed } = { funnelClosed: 0 }] = await db
      .select({ funnelClosed: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.userId, userId),
          gte(leadsTable.createdAt, monthStart),
          eq(leadsTable.status, "closed"),
        ),
      );

    const recent = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.userId, userId))
      .orderBy(desc(callRecordsTable.createdAt))
      .limit(5);

    const ids = recent.map((c) => c.id);
    const items = ids.length
      ? await db
          .select()
          .from(actionItemsTable)
          .where(sql`${actionItemsTable.callRecordId} = ANY(${ids}::uuid[])`)
      : [];
    const byCall = new Map<string, typeof items>();
    for (const it of items) {
      const arr = byCall.get(it.callRecordId) ?? [];
      arr.push(it);
      byCall.set(it.callRecordId, arr);
    }

    const recentCalls = recent.map((c) => ({
      id: c.id,
      userId: c.userId,
      originalFilename: c.originalFilename,
      fileUrl: c.fileUrl,
      transcriptText: c.transcriptText,
      summary: c.summary,
      customerName: c.customerName,
      companyName: c.companyName,
      callerPhone: c.callerPhone,
      callType: c.callType,
      intent: c.intent,
      priority: c.priority,
      sentiment: c.sentiment,
      status: c.status,
      durationSeconds: c.durationSeconds,
      keyPoints: c.keyPoints ?? [],
      followUpMessage: c.followUpMessage,
      internalNotes: c.internalNotes,
      crmJson: c.crmJson,
      suggestedTags: c.suggestedTags ?? [],
      isDemo: c.isDemo ?? "false",
      errorMessage: c.errorMessage,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      actionItems: (byCall.get(c.id) ?? []).map((ai) => ({
        id: ai.id,
        callRecordId: ai.callRecordId,
        title: ai.title,
        description: ai.description,
        dueDate: ai.dueDate ? ai.dueDate.toISOString() : null,
        priority: ai.priority,
        status: ai.status,
        createdAt: ai.createdAt.toISOString(),
        updatedAt: ai.updatedAt.toISOString(),
      })),
    }));

    const sentimentRows = await db
      .select({
        sentiment: callRecordsTable.sentiment,
        count: sql<number>`count(*)::int`,
      })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          sql`${callRecordsTable.sentiment} IS NOT NULL`,
        ),
      )
      .groupBy(callRecordsTable.sentiment);

    const tagRowsRaw = await db.execute<{ tag: string; count: number }>(sql`
      SELECT tag, COUNT(*)::int AS count
      FROM (
        SELECT jsonb_array_elements_text(suggested_tags) AS tag
        FROM call_records
        WHERE user_id = ${userId}
          AND jsonb_typeof(suggested_tags) = 'array'
      ) sub
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      totalCalls: Number(totalCalls) || 0,
      callsThisMonth: Number(callsThisMonth) || 0,
      openActionItems: Number(openActionItems) || 0,
      highPriorityCalls: Number(highPriorityCalls) || 0,
      openTickets: Number(openTickets) || 0,
      newLeadsThisWeek: Number(newLeadsThisWeek) || 0,
      openTasks: Number(openTasks) || 0,
      angrySentimentAlerts: Number(angrySentimentAlerts) || 0,
      conversionFunnel: {
        calls: Number(funnelCalls) || 0,
        leads: Number(funnelLeads) || 0,
        closedLeads: Number(funnelClosed) || 0,
      },
      recentCalls,
      sentimentBreakdown: sentimentRows.map((r) => ({
        sentiment: r.sentiment ?? "unknown",
        count: Number(r.count) || 0,
      })),
      topTags: tagRowsRaw.rows.map((r) => ({
        tag: r.tag,
        count: Number(r.count) || 0,
      })),
    });
  },
);

export default router;
