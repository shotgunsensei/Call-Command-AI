import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import callsRouter from "./calls";
import actionItemsRouter from "./actionItems";
import integrationsRouter from "./integrations";
import statsRouter from "./stats";
import billingRouter from "./billing";
import storageRouter from "./storage";
import ingestionTokenRouter from "./ingestionToken";
import automationRulesRouter from "./automationRules";
import ticketsRouter from "./tickets";
import leadsRouter from "./leads";
import tasksRouter from "./tasks";
import followupsRouter from "./followups";
import ingestRouter from "./ingest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(callsRouter);
router.use(actionItemsRouter);
router.use(integrationsRouter);
router.use(statsRouter);
router.use(billingRouter);
router.use(storageRouter);
router.use(ingestionTokenRouter);
router.use(automationRulesRouter);
router.use(ticketsRouter);
router.use(leadsRouter);
router.use(tasksRouter);
router.use(followupsRouter);
router.use(ingestRouter);

export default router;
