import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import callsRouter from "./calls";
import actionItemsRouter from "./actionItems";
import integrationsRouter from "./integrations";
import statsRouter from "./stats";
import billingRouter from "./billing";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(callsRouter);
router.use(actionItemsRouter);
router.use(integrationsRouter);
router.use(statsRouter);
router.use(billingRouter);
router.use(storageRouter);

export default router;
